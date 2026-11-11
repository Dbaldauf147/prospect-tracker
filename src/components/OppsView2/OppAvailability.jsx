// "Availability" - the Opp details subtab that shows when the SE people on
// a deal are free, so a client meeting can be offered at a time that
// works for the team.
//
// The free/busy comes from the user's own Power Automate flow (see
// utils/availability.js for why it can't come from the app directly). This
// tab keeps the list of colleagues for the opp, draws the day from what
// the flow last posted, and carries the flow's setup steps, since without
// the flow there is nothing to draw.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import {
  STATUS_LABELS, availabilityDays, availabilityEmails, availabilityGrid, freeRanges, parseEmailList, normEmail,
} from '../../utils/availability';

const labelStyle = {
  fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--color-text-muted)', fontWeight: 700,
};

const emptyStyle = {
  padding: '0.75rem 0.85rem', border: '1px dashed var(--color-border)', borderRadius: 6,
  fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--color-text-muted)',
};

const btnStyle = {
  padding: '0.3rem 0.65rem', border: '1px solid var(--color-border)', borderRadius: 4,
  background: 'var(--color-surface, #fff)', color: 'var(--color-text)', fontSize: '0.75rem',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

const codeStyle = {
  flex: 1, padding: '0.3rem 0.5rem', background: '#fff', border: '1px solid #93C5FD',
  borderRadius: 4, fontSize: '0.7rem', wordBreak: 'break-all', userSelect: 'all',
};

// Cell colours by status. Free is left white so the busy blocks read.
const CELL = {
  free: { background: '#FFFFFF' },
  tentative: { background: 'repeating-linear-gradient(45deg, #BFDBFE 0 3px, #EFF6FF 3px 6px)' },
  busy: { background: '#3B82F6' },
  oof: { background: '#7C3AED' },
  workingelsewhere: { background: 'repeating-linear-gradient(45deg, #CBD5E1 0 3px, #F8FAFC 3px 6px)' },
  unknown: { background: '#F1F5F9' },
};

const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function CopyRow({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0.2rem 0 0.45rem' }}>
      <code style={codeStyle}>{value}</code>
      <button type="button" style={btnStyle} onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
    </div>
  );
}

function FlowSetup({ token, open, onToggle }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const getUrl = `${origin}/api/availability?token=${token}`;
  const postUrl = `${origin}/api/availability`;
  const postBody = `{"token":"${token}","schedules":@{body('Send_an_HTTP_request')?['value']}}`;
  return (
    <div style={{ border: '1px solid #BFDBFE', background: '#EFF6FF', borderRadius: 6, padding: '0.55rem 0.75rem', fontSize: '0.76rem', lineHeight: 1.55 }}>
      <button type="button" onClick={onToggle} style={{ ...btnStyle, border: 'none', background: 'none', padding: 0, fontWeight: 700, color: '#1D4ED8' }}>
        {open ? '▾' : '▸'} Power Automate setup (one flow covers every opp)
      </button>
      {open && (
        <div style={{ marginTop: '0.45rem' }}>
          <div>
            The flow runs under your own Microsoft account, so it sees the same free/busy Outlook&apos;s
            Scheduling Assistant shows you, and nothing more. It checks everyone on all your opps
            each time it runs.
          </div>
          <ol style={{ margin: '0.4rem 0 0 1.2rem' }}>
            <li>At make.powerautomate.com, <strong>+ Create</strong> a <strong>Scheduled cloud flow</strong> named &quot;Opp availability&quot;, running <strong>every 1 hour</strong>.</li>
            <li>
              Add <strong>HTTP</strong>: Method <strong>GET</strong>, URI:
              <CopyRow value={getUrl} />
            </li>
            <li>
              Add <strong>Office 365 Outlook, Send an HTTP request</strong>: Method <strong>POST</strong>, URI:
              <CopyRow value="https://graph.microsoft.com/v1.0/me/calendar/getSchedule" />
              Content-Type <code>application/json</code>, Body:
              <CopyRow value="@body('HTTP')?['getScheduleBody']" />
            </li>
            <li>
              Add another <strong>HTTP</strong>: Method <strong>POST</strong>, URI:
              <CopyRow value={postUrl} />
              Header <code>Content-Type: application/json</code>, Body:
              <CopyRow value={postBody} />
            </li>
            <li>Save, then <strong>Test</strong> it once. This tab picks the result up when you reopen it.</li>
          </ol>
          <div style={{ color: '#475569' }}>
            The token in the first URL is yours: keep it private, it lets the flow read the colleague list and post free/busy.
            If an action name differs in your flow, change it in the two body(...) expressions to match.
          </div>
        </div>
      )}
    </div>
  );
}

// With an oppId: that opp's team, editable (the opp popup's tab). Without
// one: everyone on any of the user's opps, the same people the flow
// checks (the Opps page's Availability tab). There each person can be
// ticked out of the "Everyone" row, and shows the opps they're on.
export function OppAvailability({ oppId, opps = [] }) {
  const allMode = !oppId;
  const [excluded, setExcluded] = useState(() => new Set());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [dayIdx, setDayIdx] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await apiFetch('/api/availability');
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setData(j);
      if (!j.updatedAt) setSetupOpen(true);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allEmails = useMemo(() => (allMode ? availabilityEmails(data?.people) : (data?.people?.[oppId] || [])), [allMode, data, oppId]);
  const emails = useMemo(() => allEmails.filter(e => !excluded.has(e)), [allEmails, excluded]);
  // Opp names per person, for the all-opps view.
  const oppsOf = useMemo(() => {
    const name = new Map(opps.map(o => [o._id, String(o['Account'] || '').trim() || 'Untitled opp']));
    const out = new Map();
    for (const [id, list] of Object.entries(data?.people || {})) {
      if (!name.has(id)) continue;
      for (const e of list || []) out.set(e, [...(out.get(e) || []), name.get(id)]);
    }
    return out;
  }, [opps, data?.people]);
  const toggleExcluded = (e) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(e)) next.delete(e); else next.add(e);
    return next;
  });

  const save = async (next) => {
    setSaving(true);
    setError('');
    try {
      const r = await apiFetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oppId, emails: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setData(d => ({ ...(d || {}), people: j.people || {} }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const addDraft = () => {
    const { emails: found, invalid } = parseEmailList(draft);
    const max = data?.maxPeople || 20;
    const next = [...emails, ...found.filter(e => !emails.includes(e))].slice(0, max);
    setDraftNote(invalid.length ? `Not an email address: ${invalid.join(', ')}` : '');
    setDraft(invalid.join(', '));
    if (next.length !== emails.length) save(next);
  };

  const days = useMemo(() => availabilityDays(data?.window), [data?.window]);
  const day = days[Math.min(dayIdx, Math.max(0, days.length - 1))] || null;
  const grid = useMemo(() => (day ? availabilityGrid(data?.schedules || [], emails, day) : null), [data?.schedules, emails, day]);
  const ranges = grid ? freeRanges(grid) : [];

  if (loading && !data) return <div style={emptyStyle}>Loading availability...</div>;

  const synced = data?.updatedAt;
  const onFile = new Set((data?.schedules || []).map(s => normEmail(s.email)));
  const waiting = allEmails.filter(e => !onFile.has(e));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {error && (
        <div style={{ ...emptyStyle, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>
          {error} <button type="button" style={{ ...btnStyle, marginLeft: '0.4rem' }} onClick={load}>Retry</button>
        </div>
      )}

      {allMode && (
        <div>
          <div style={labelStyle}>SE people on your opps ({allEmails.length})</div>
          {allEmails.length === 0 ? (
            <div style={{ ...emptyStyle, marginTop: '0.4rem' }}>
              Nobody added yet. Open an opp (the ⓘ on its row), go to its Availability tab and add the SE people on the deal.
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', margin: '0.2rem 0 0.4rem' }}>
                Untick someone to leave them out of the Everyone row. People are added and removed on each opp&apos;s own Availability tab.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {allEmails.map(e => {
                  const on = !excluded.has(e);
                  const onOpps = oppsOf.get(e) || [];
                  return (
                    <label
                      key={e}
                      title={onOpps.length ? `On: ${onOpps.join(', ')}` : undefined}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: 999, background: on ? '#EEF2FF' : '#F8FAFC', border: `1px solid ${on ? '#C7D2FE' : '#E2E8F0'}`, fontSize: '0.75rem', color: on ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleExcluded(e)} style={{ margin: 0 }} />
                      {e}
                      {onOpps.length > 0 && <span style={{ color: 'var(--color-text-muted)' }}>({onOpps.length === 1 ? onOpps[0] : `${onOpps.length} opps`})</span>}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!allMode && <div>
        <div style={labelStyle}>SE team on this opp</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', margin: '0.4rem 0' }}>
          {emails.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Nobody added yet.</span>}
          {emails.map(e => (
            <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.5rem', borderRadius: 999, background: '#EEF2FF', border: '1px solid #C7D2FE', fontSize: '0.75rem' }}>
              {e}
              <button
                type="button"
                title={`Remove ${e}`}
                disabled={saving}
                onClick={() => save(emails.filter(x => x !== e))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', padding: 0, fontSize: '0.8rem' }}
              >×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addDraft(); }}
            placeholder="name@se.com (paste several, separated by ; or ,)"
            style={{ flex: 1, padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'inherit' }}
          />
          <button type="button" style={btnStyle} disabled={saving || !draft.trim()} onClick={addDraft}>{saving ? 'Saving...' : 'Add'}</button>
        </div>
        {draftNote && <div style={{ fontSize: '0.72rem', color: '#B45309', marginTop: '0.25rem' }}>{draftNote}</div>}
      </div>}

      <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
        {synced
          ? <>Free/busy last synced {ago(synced)}.</>
          : <>No free/busy yet: set up the flow below and run it once.</>}
        {synced && waiting.length > 0 && <> {waiting.length === 1 ? `${waiting[0]} was` : `${waiting.length} people were`} added since, and will show after the next run.</>}
        {' '}<button type="button" style={{ ...btnStyle, padding: '0.1rem 0.45rem' }} onClick={load} disabled={loading}>{loading ? 'Refreshing...' : '↻ Refresh'}</button>
      </div>

      {emails.length > 0 && synced && grid && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
            {days.map((d, i) => (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setDayIdx(i)}
                style={{ ...btnStyle, ...(d === day ? { background: '#1D4ED8', color: '#fff', border: '1px solid #1D4ED8' } : {}) }}
              >{fmtDay(d)}</button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%', minWidth: 640, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.2rem 0.4rem', width: 190 }} />
                  {grid.slots.map((sl, i) => (
                    <th key={i} style={{ fontWeight: 500, color: 'var(--color-text-muted)', textAlign: 'left', padding: '0 0 0.2rem', whiteSpace: 'nowrap', overflow: 'visible' }}>
                      {sl.start.getMinutes() === 0 ? sl.start.toLocaleTimeString(undefined, { hour: 'numeric' }) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '0.25rem 0.4rem', fontWeight: 700 }}>Everyone</td>
                  {grid.everyone.map((st, i) => (
                    <td
                      key={i}
                      title={`${fmtTime(grid.slots[i].start)}: ${{ free: 'everyone free', busy: 'someone busy', past: 'already past' }[st] || 'no data yet'}`}
                      style={{ height: 18, border: '1px solid #E2E8F0', background: st === 'free' ? '#22C55E' : st === 'busy' ? '#FEE2E2' : '#F1F5F9' }}
                    />
                  ))}
                </tr>
                {grid.rows.map(r => (
                  <tr key={r.email}>
                    <td style={{ padding: '0.25rem 0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }} title={r.schedule?.error || r.email}>
                      {r.email}
                      {r.schedule?.error && <span style={{ color: '#B45309' }}> (unreadable)</span>}
                    </td>
                    {r.cells.map((c, i) => (
                      <td
                        key={i}
                        title={`${fmtTime(grid.slots[i].start)}: ${STATUS_LABELS[c.status]}${c.item?.subject ? `, ${c.item.subject}` : ''}`}
                        style={{ height: 18, border: '1px solid #E2E8F0', ...CELL[c.status] }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {['busy', 'tentative', 'oof', 'workingelsewhere', 'unknown'].map(s => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: 12, height: 10, border: '1px solid #CBD5E1', ...CELL[s] }} />{STATUS_LABELS[s]}
              </span>
            ))}
            <span>Times in your time zone, {grid.slots[0] && fmtTime(grid.slots[0].start)} to {grid.slots.length > 0 && fmtTime(grid.slots[grid.slots.length - 1].end)}.</span>
          </div>

          <div style={{ marginTop: '0.6rem' }}>
            <div style={labelStyle}>Everyone free on {fmtDay(day)}</div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {grid.knownCount === 0
                ? 'No calendars on file for these people yet.'
                : ranges.length === 0
                  ? 'No shared free time in working hours this day.'
                  : ranges.map(rg => `${fmtTime(rg.start)} - ${fmtTime(rg.end)}`).join(', ')}
              {grid.knownCount > 0 && grid.knownCount < grid.rows.length && (
                <span style={{ color: 'var(--color-text-muted)' }}> (of the {grid.knownCount} with a calendar on file; tentative counts as free)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {data?.token && <FlowSetup token={data.token} open={setupOpen} onToggle={() => setSetupOpen(o => !o)} />}
    </div>
  );
}
