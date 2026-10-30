// Yearly schedules on the Email Campaigns tab: campaigns that come round
// every year, created on their day by useCampaignSchedules (App-level).
// The rules - {year} in titles and subjects, last year's roster carried
// forward, never twice in a year - are in utils/campaignSchedules.js.
//
// The list is a DataTable, so it has Dan's column formatting like every
// other table. The form above it adds and edits schedules; they are saved
// in settings.campaignSchedules.
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { primarySubject } from '../../utils/campaignSubjects';
import {
  MONTH_NAMES, SCHEDULES_SETTINGS_KEY, scheduleSubjects, scheduleWhenLabel, nextOccurrence,
  lastCreatedYear, campaignForYear, cannotCreateReason, isScheduleEnabled, localDay,
  newScheduleId, fillYear, hasYearToken, templateFromText, scheduleMonthDay,
} from '../../utils/campaignSchedules';

const TABLE_ID = 'email-campaign-schedules';

const LABEL = { display: 'block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-secondary)', marginBottom: '2px' };
const FIELD = { width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit', background: 'var(--color-surface)', color: 'var(--color-text)' };
const BTN = { padding: '0.4rem 0.9rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };
const LINK_BTN = { background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };

const EMPTY_FORM = { id: null, title: '', subjects: '', eventUrl: '', month: 1, day: 1, carryContacts: true, copyFrom: '' };

function fmtDay(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * savedCampaigns: the tab's saved list. onCreateNow(schedule, year) makes
 * that year's campaign straight away; onOpenCampaign(index) opens one.
 * seed: a saved campaign to start a new schedule from ("Repeat yearly" on
 * its row), cleared through onSeedUsed.
 */
export function CampaignSchedulesPanel({ savedCampaigns, settings, updateSettings, onCreateNow, onOpenCampaign, seed, onSeedUsed }) {
  const schedules = useMemo(
    () => (Array.isArray(settings?.[SCHEDULES_SETTINGS_KEY]) ? settings[SCHEDULES_SETTINGS_KEY] : []),
    [settings],
  );
  const [form, setForm] = useState(null); // null = closed
  const [error, setError] = useState('');
  const today = localDay();
  const year = Number(today.slice(0, 4));

  // "Repeat yearly" on a saved campaign: open the form filled from it, with
  // a year in its title or subject turned into {year}, its roster as the
  // first year's contacts, and today's date as the day it comes round.
  useEffect(() => {
    if (!seed) return;
    const subjects = (Array.isArray(seed.subjects) && seed.subjects.length ? seed.subjects : [seed.subject])
      .filter(Boolean).map(s => templateFromText(s, year));
    const now = new Date();
    setForm({
      ...EMPTY_FORM,
      title: templateFromText(seed.title || '', year),
      subjects: subjects.join('\n'),
      eventUrl: seed.eventUrl || '',
      month: now.getMonth() + 1,
      day: now.getDate(),
      copyFrom: primarySubject(seed),
    });
    setError('');
    onSeedUsed?.();
  }, [seed, year, onSeedUsed]);

  function save(next) {
    updateSettings({ [SCHEDULES_SETTINGS_KEY]: next });
  }

  function submit() {
    const subjects = form.subjects.split('\n').map(s => s.trim()).filter(Boolean);
    if (!subjects.length) { setError('Give the schedule a subject line.'); return; }
    const { month, day } = scheduleMonthDay(form);
    const record = {
      id: form.id || newScheduleId(),
      title: form.title.trim(),
      subjects,
      month, day,
      carryContacts: !!form.carryContacts,
    };
    if (form.eventUrl.trim()) record.eventUrl = form.eventUrl.trim();
    if (form.copyFrom) record.copyFrom = form.copyFrom;
    const prev = schedules.find(s => s.id === form.id);
    record.createdOn = prev?.createdOn || today;
    record.enabled = prev ? isScheduleEnabled(prev) : true;
    save(prev ? schedules.map(s => (s.id === prev.id ? record : s)) : [...schedules, record]);
    setForm(null);
    setError('');
  }

  function edit(s) {
    setForm({
      ...EMPTY_FORM,
      id: s.id,
      title: s.title || '',
      subjects: scheduleSubjects(s).join('\n'),
      eventUrl: s.eventUrl || '',
      ...scheduleMonthDay(s),
      carryContacts: s.carryContacts !== false,
      copyFrom: s.copyFrom || '',
    });
    setError('');
  }

  function remove(s) {
    const label = s.title || scheduleSubjects(s)[0] || 'this schedule';
    if (!window.confirm(`Delete the yearly schedule "${label}"? Campaigns it already made stay on the list.`)) return;
    save(schedules.filter(x => x.id !== s.id));
    if (form?.id === s.id) setForm(null);
  }

  function toggle(s) {
    save(schedules.map(x => (x.id === s.id ? { ...x, enabled: !isScheduleEnabled(x) } : x)));
  }

  function createNow(s) {
    const why = cannotCreateReason(s, year, savedCampaigns);
    if (why) { setError(why); return; }
    setError('');
    onCreateNow(s, year);
  }

  const rows = useMemo(() => schedules.map(s => {
    const subjects = scheduleSubjects(s);
    const last = lastCreatedYear(savedCampaigns, s.id);
    const thisYearIdx = savedCampaigns.indexOf(campaignForYear(savedCampaigns, s.id, year));
    const lastIdx = last == null ? -1 : savedCampaigns.indexOf(campaignForYear(savedCampaigns, s.id, last));
    const enabled = isScheduleEnabled(s);
    const next = nextOccurrence(s, savedCampaigns, today);
    // A due schedule that can't go in (its subject is taken) would otherwise
    // just sit there; say why.
    const blocked = enabled && next <= today ? cannotCreateReason(s, year, savedCampaigns) : '';
    return {
      id: s.id,
      schedule: s,
      title: s.title || subjects[0] || '',
      subjects: subjects.join(' | '),
      when: scheduleWhenLabel(s),
      whenSort: scheduleMonthDay(s).month * 100 + scheduleMonthDay(s).day,
      next: enabled ? next : '',
      nextLabel: enabled ? fmtDay(next) : 'Off',
      contacts: s.carryContacts === false ? 'Start empty' : (s.copyFrom && last == null ? `From "${s.copyFrom}"` : 'Last year’s'),
      last: last == null ? '' : String(last),
      lastIdx,
      thisYearIdx,
      status: enabled ? 'On' : 'Off',
      blocked,
    };
  }), [schedules, savedCampaigns, year, today]);

  const columns = useMemo(() => [
    {
      key: 'title', label: 'Schedule', defaultWidth: 220,
      render: r => (
        <span title={r.blocked || undefined}>
          <span style={{ fontWeight: 600 }}>{r.title}</span>
          {r.blocked && <span style={{ marginLeft: 6, color: '#B45309', fontSize: '0.7rem' }}>⚠ {r.blocked}</span>}
        </span>
      ),
    },
    { key: 'subjects', label: 'Subject lines', defaultWidth: 240 },
    { key: 'when', label: 'Every year on', defaultWidth: 120, getSortValue: r => r.whenSort },
    { key: 'nextLabel', label: 'Next', defaultWidth: 120, getSortValue: r => r.next || '9999' },
    { key: 'contacts', label: 'Contacts', defaultWidth: 150 },
    {
      key: 'last', label: 'Last made', defaultWidth: 100,
      render: r => (r.lastIdx >= 0
        ? <button type="button" style={LINK_BTN} onClick={() => onOpenCampaign(r.lastIdx)} title="Open that campaign">{r.last}</button>
        : <span style={{ color: 'var(--color-text-muted)' }}>-</span>),
    },
    {
      key: 'status', label: 'Status', defaultWidth: 80,
      render: r => (
        <button
          type="button"
          onClick={() => toggle(r.schedule)}
          title={r.status === 'On' ? 'Switch off: no campaign is made until it is back on' : 'Switch on'}
          style={{
            padding: '2px 8px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            border: r.status === 'On' ? '1px solid #86EFAC' : '1px solid var(--color-border)',
            background: r.status === 'On' ? '#DCFCE7' : '#F3F4F6',
            color: r.status === 'On' ? '#15803D' : '#6B7280',
          }}
        >{r.status}</button>
      ),
    },
    {
      key: 'actions', label: 'Actions', defaultWidth: 190,
      getFilterValue: () => '',
      render: r => (
        <span style={{ display: 'inline-flex', gap: '0.6rem' }}>
          {r.thisYearIdx >= 0 ? (
            <button type="button" style={LINK_BTN} onClick={() => onOpenCampaign(r.thisYearIdx)}>Open {year}</button>
          ) : (
            <button type="button" style={LINK_BTN} onClick={() => createNow(r.schedule)} title={`Make the ${year} campaign now instead of waiting for ${r.when}`}>Create {year} now</button>
          )}
          <button type="button" style={LINK_BTN} onClick={() => edit(r.schedule)}>Edit</button>
          <button type="button" style={{ ...LINK_BTN, color: '#DC2626' }} onClick={() => remove(r.schedule)}>Delete</button>
        </span>
      ),
    },
  // The handlers close over the latest schedules through the render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [schedules, savedCampaigns, year]);

  const preview = form ? (() => {
    const subs = form.subjects.split('\n').map(s => s.trim()).filter(Boolean);
    return {
      title: fillYear(form.title.trim() || subs[0] || '', year),
      subject: fillYear(subs[0] || '', year),
      needsToken: subs.length > 0 && !subs.some(hasYearToken),
    };
  })() : null;

  const days = form ? new Date(2028, Number(form.month), 0).getDate() : 31;

  return (
    <div style={{ marginTop: '1.5rem' }} data-campaign-schedules>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Yearly Schedules</div>
        {!form && (
          <button
            type="button"
            onClick={() => { setForm({ ...EMPTY_FORM, title: '', month: new Date().getMonth() + 1, day: new Date().getDate() }); setError(''); }}
            title="Have a campaign made on the same day every year"
            style={{ ...BTN, padding: '0.3rem 0.6rem', fontSize: '0.7rem', border: '1px solid var(--color-accent)', background: 'var(--color-surface)', color: 'var(--color-accent)' }}
          >+ New yearly schedule</button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '0.5rem', padding: '0.4rem 0.7rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.75rem' }}>{error}</div>
      )}

      {form && (
        <div style={{ padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={LABEL}>Title</label>
              <input autoFocus type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Holiday greetings {year}" style={FIELD} />
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <label style={LABEL}>Subject lines</label>
              <textarea
                value={form.subjects}
                rows={Math.min(6, Math.max(2, form.subjects.split('\n').length + 1))}
                onChange={e => setForm({ ...form, subjects: e.target.value })}
                placeholder={'Happy holidays {year}\nAnother line, if it goes out under more than one'}
                style={{ ...FIELD, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={LABEL}>Event link</label>
              <input type="text" value={form.eventUrl} onChange={e => setForm({ ...form, eventUrl: e.target.value })} placeholder="https://… (optional)" style={FIELD} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' }}>
            <div>
              <label style={LABEL}>Every year on</label>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <select
                  value={form.month}
                  onChange={e => setForm({ ...form, month: Number(e.target.value) })}
                  aria-label="Month"
                  style={{ ...FIELD, width: 'auto' }}
                >
                  {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select
                  value={Math.min(form.day, days)}
                  onChange={e => setForm({ ...form, day: Number(e.target.value) })}
                  aria-label="Day"
                  style={{ ...FIELD, width: 'auto' }}
                >
                  {Array.from({ length: days }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
              </div>
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <label style={LABEL}>Contacts</label>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={form.carryContacts ? 'carry' : 'empty'}
                  onChange={e => setForm({ ...form, carryContacts: e.target.value === 'carry' })}
                  aria-label="Contacts"
                  style={{ ...FIELD, width: 'auto' }}
                >
                  <option value="carry">Copy last year&rsquo;s contacts</option>
                  <option value="empty">Start with no contacts</option>
                </select>
                {form.carryContacts && (
                  <select
                    value={form.copyFrom}
                    onChange={e => setForm({ ...form, copyFrom: e.target.value })}
                    aria-label="First year copies from"
                    title="Where the first year's contacts come from, before this schedule has made a campaign of its own"
                    style={{ ...FIELD, width: 'auto', maxWidth: 280 }}
                  >
                    <option value="">First year: no contacts</option>
                    {savedCampaigns.filter(c => primarySubject(c)).map(c => (
                      <option key={primarySubject(c)} value={primarySubject(c)}>First year: copy from {c.title || primarySubject(c)}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <button type="button" onClick={submit} disabled={!form.subjects.trim()} style={{ ...BTN, border: 'none', background: 'var(--color-accent)', color: '#fff', opacity: form.subjects.trim() ? 1 : 0.5 }}>
              {form.id ? 'Save schedule' : 'Add schedule'}
            </button>
            <button type="button" onClick={() => { setForm(null); setError(''); }} style={{ ...BTN, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
            On {MONTH_NAMES[form.month - 1]} {Math.min(form.day, days)} each year the campaign is created on its own (the next time the app is open, if it is closed that day).
            {' '}Write <code>{'{year}'}</code> where the year goes: this year it would be <strong>{preview.title || '-'}</strong>{preview.subject ? <>, subject <strong>{preview.subject}</strong></> : null}.
            {' '}Copied contacts start as Not Sent, with their Avoid and Hold off marks kept.
            {preview.needsToken && (
              <div style={{ color: '#B45309', marginTop: 2 }}>
                No subject line has {'{year}'} in it, so every year&rsquo;s campaign would match the same sent mail. A year that finds its subject already in use is skipped.
              </div>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 ? (
        // DataTable fills a flex parent and scrolls inside it; on this page
        // nothing above it is a flex column, so the box is given a height
        // that fits the schedules (a handful, normally) up to a cap.
        <div style={{ display: 'flex', flexDirection: 'column', height: Math.min(460, 150 + rows.length * 44), border: '1px solid var(--color-border)', borderRadius: '6px', overflow: 'hidden' }}>
        <DataTable
          tableId={TABLE_ID}
          columns={columns}
          rows={rows}
          alwaysVisible={['title']}
          emptyMessage="No schedule matches those filters"
          settings={settings}
          updateSettings={updateSettings}
          showExport={false}
          variableRowHeight
        />
        </div>
      ) : !form && (
        <div style={{ padding: '0.75rem', border: '1px dashed var(--color-border)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
          No yearly schedules yet. Add one, or use &ldquo;Repeat yearly&rdquo; on a saved campaign, to have it created again on the same day every year.
        </div>
      )}
    </div>
  );
}
