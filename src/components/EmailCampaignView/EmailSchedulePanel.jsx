// The Email Schedule sub-tab of Email Campaigns: the next campaign planned
// for each audience (Clients, Key Contacts, Prospects), from the dates on
// Saved Campaigns' Sent To column, and the earliest day each audience can be
// mailed with most of its people still at or under 3 emails in 3 weeks.
// The rules are in utils/emailSchedule.js; this is the cards and, under
// them, the planned sends as a table (the shared DataTable, so it carries
// Dan's column formatting) or as a month calendar, whichever was last picked.
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { buildEmailSchedule, audienceMembers, localDay, calendarWeeks, addMonths, scheduleCalendarEntries, DEFAULT_MOST_SHARE, OUTREACH_LIMIT, OUTREACH_WINDOW_DAYS } from '../../utils/emailSchedule';
import { makeRosterGates } from '../../utils/contactRosters';
import { useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { userLsGet, userLsSet } from '../../utils/userLs';

const TABLE_ID = 'email-campaign-schedule';
const MOST_KEY = 'email-schedule:most';
const MOST_CHOICES = [0.5, 0.67, 0.75, 0.8, 0.9, 1];
const VIEW_KEY = 'email-schedule:view';
const VIEWS = [['list', 'List'], ['calendar', 'Calendar']];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = (day) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '');
const pct = (share) => `${Math.round(share * 100)}%`;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', fontSize: '0.78rem',
  color: 'var(--color-accent)', cursor: 'pointer', textAlign: 'left', maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const STATUS = {
  ok: { label: 'On track', style: { background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' }, tip: 'Most of this audience is under the cap on the planned day.' },
  early: { label: 'Too soon', style: { background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }, tip: 'Planned before the target date: too many of this audience would go over the cap.' },
  none: { label: 'No target found', style: { background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C' }, tip: 'No day in the next six months gets enough of this audience under the cap.' },
};
const statusOf = (r) => (!r.target ? 'none' : r.early ? 'early' : 'ok');
const Pill = ({ s }) => <span title={STATUS[s].tip} style={{ ...STATUS[s].style, padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{STATUS[s].label}</span>;

function GroupCard({ g, most, onOpenCampaign }) {
  const n = g.next;
  return (
    <div data-schedule-group={g.key} style={{ flex: '1 1 260px', minWidth: 0, border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.75rem 0.9rem', background: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>{g.label}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{g.total} contact{g.total === 1 ? '' : 's'}</span>
      </div>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginTop: 8 }}>Next scheduled</div>
      {n ? (
        <>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: n.overdue ? '#B91C1C' : 'var(--color-text)' }}>
            {n.overdue ? `Overdue (${fmt(n.date)})` : fmt(n.date)}
          </div>
          <button type="button" style={{ ...linkBtn, display: 'block' }} title="Open this campaign" onClick={() => onOpenCampaign?.(n.index)}>{n.title}</button>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {n.readiness.ok} of {n.readiness.total} ({pct(n.readiness.share)}) under the cap that day <Pill s={statusOf(n)} />
          </div>
          {g.planned > 1 && <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{g.planned - 1} more planned after it</div>}
        </>
      ) : (
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Nothing scheduled</div>
      )}
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginTop: 10 }}>
        {n ? 'Target date for this send' : 'Earliest target date'}
      </div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }} title={`The first weekday where at least ${pct(most)} of ${g.label} would have no more than ${OUTREACH_LIMIT} emails in ${OUTREACH_WINDOW_DAYS} days, this one included.`}>
        {(n ? n.target : g.nextTarget) ? fmt(n ? n.target : g.nextTarget) : 'None in the next 6 months'}
      </div>
      {n && (
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
          Next one after everything planned: <strong>{g.nextTarget ? fmt(g.nextTarget) : 'none in 6 months'}</strong>
        </div>
      )}
    </div>
  );
}

const calBtn = {
  font: 'inherit', fontSize: '0.75rem', padding: '2px 9px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)',
};
const chip = {
  display: 'block', width: '100%', boxSizing: 'border-box', margin: '2px 0 0', padding: '1px 6px', borderRadius: 4,
  font: 'inherit', fontSize: '0.7rem', lineHeight: 1.35, textAlign: 'left',
  // Wraps rather than cuts off: a narrow day column would otherwise show
  // the audience and none of the campaign's name.
  whiteSpace: 'normal', overflowWrap: 'anywhere',
};
const dashedChip = { ...chip, background: 'transparent', border: '1px dashed var(--color-border)', color: 'var(--color-text-secondary)' };
const LEGEND = [
  [STATUS.ok.style, 'On track'], [STATUS.early.style, 'Too soon'], [STATUS.none.style, 'No target found'],
  [{ border: '1px dashed #B45309' }, 'Target date of a too-soon send'], [{ border: '1px dashed var(--color-border)' }, 'Next open day'],
];

// The planned sends on a month grid. A send is a filled chip in its status
// colour on the day it goes; a dashed amber chip marks the target date of a
// send planned too soon (the day it would have to move to); a dashed grey one marks the first day
// each audience could take a further send after everything planned.
function ScheduleCalendar({ rows, groups, today, onOpenCampaign }) {
  // null follows the data: the month of the soonest planned send, or this month.
  const [picked, setPicked] = useState(null);
  const month = picked || (rows[0]?.sendDay || today).slice(0, 7);
  const weeks = useMemo(() => calendarWeeks(month), [month]);
  const entries = useMemo(() => scheduleCalendarEntries({ rows, groups }), [rows, groups]);
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const renderEntry = (e, i) => {
    if (e.kind === 'send') {
      const r = e.row;
      const s = statusOf(r);
      return (
        <button key={i} type="button" data-cal-send={r.id} onClick={() => onOpenCampaign?.(r.index)}
          title={`${r.audienceLabel}: ${r.title}\n${r.overdue ? `Overdue, planned for ${fmt(r.date)}\n` : ''}${r.readiness.ok} of ${r.readiness.total} (${pct(r.readiness.share)}) under the cap that day\n${STATUS[s].label}${r.target ? `, target date ${fmt(r.target)}` : ''}\nClick to open this campaign`}
          style={{ ...chip, ...STATUS[s].style, cursor: 'pointer' }}>
          <strong>{r.audienceLabel}</strong> {r.overdue ? 'Overdue: ' : ''}{r.title}
        </button>
      );
    }
    if (e.kind === 'target') {
      const r = e.row;
      return (
        <div key={i} data-cal-target={r.id} style={{ ...dashedChip, borderColor: '#B45309', color: '#92400E' }}
          title={`Target date for ${r.title} to ${r.audienceLabel}. It is planned for ${fmt(r.sendDay)}, which is too soon.`}>
          Target: <strong>{r.audienceLabel}</strong> {r.title}
        </div>
      );
    }
    return (
      <div key={i} data-cal-open={e.group.key} style={dashedChip}
        title={`The first day ${e.group.label} could take another send after everything planned`}>
        Next open: <strong>{e.group.label}</strong>
      </div>
    );
  };

  return (
    <div data-schedule-calendar style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border)' }}>
        <button type="button" style={calBtn} aria-label="Previous month" title="Previous month" onClick={() => setPicked(addMonths(month, -1))}>&lsaquo;</button>
        <button type="button" style={calBtn} aria-label="Next month" title="Next month" onClick={() => setPicked(addMonths(month, 1))}>&rsaquo;</button>
        <button type="button" style={calBtn} onClick={() => setPicked(today.slice(0, 7))}>Today</button>
        <span data-cal-month style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)', marginLeft: 4 }}>{label}</span>
        <span style={{ flex: 1 }} />
        {LEGEND.map(([style, text]) => (
          <span key={text} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
            <span style={{ ...style, width: 12, height: 10, borderRadius: 3, boxSizing: 'border-box' }} />{text}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ padding: '4px 8px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderLeft: i ? '1px solid var(--color-border)' : 'none' }}>{w}</div>
        ))}
        {weeks.flat().map((day, i) => {
          const inMonth = day.slice(0, 7) === month;
          const weekend = i % 7 === 0 || i % 7 === 6;
          const isToday = day === today;
          return (
            <div key={day} data-cal-day={day} style={{
              minHeight: 92, minWidth: 0, padding: '4px 6px 6px',
              borderTop: '1px solid var(--color-border)', borderLeft: i % 7 ? '1px solid var(--color-border)' : 'none',
              background: weekend || !inMonth ? 'var(--color-bg)' : 'transparent',
            }}>
              <span style={{
                display: 'inline-block', minWidth: 20, textAlign: 'center', padding: '0 4px', borderRadius: 999, fontSize: '0.72rem',
                fontWeight: isToday ? 700 : 500,
                color: isToday ? '#fff' : inMonth ? 'var(--color-text)' : 'var(--color-text-muted)',
                background: isToday ? 'var(--color-accent)' : 'transparent',
              }} title={isToday ? 'Today' : undefined}>{Number(day.slice(8))}</span>
              {(entries.get(day) || []).map(renderEntry)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmailSchedulePanel({ campaigns, prospects, cdmName, onOpenCampaign, settings, updateSettings }) {
  const [most, setMostState] = useState(() => {
    const v = Number(userLsGet(MOST_KEY));
    return MOST_CHOICES.includes(v) ? v : DEFAULT_MOST_SHARE;
  });
  const setMost = (v) => { setMostState(v); try { userLsSet(MOST_KEY, String(v)); } catch { /* a convenience */ } };

  const [view, setViewState] = useState(() => (userLsGet(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'));
  const setView = (v) => { setViewState(v); try { userLsSet(VIEW_KEY, v); } catch { /* a convenience */ } };

  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();
  const [contacts, setContacts] = useState(null);
  const [oppsRecords, setOppsRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadOppsFromCache().then(o => { if (!cancelled) setOppsRecords(o?.records || []); }).catch(() => {});
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setContacts(c || []); }).catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  const members = useMemo(() => audienceMembers(contacts || [], gates), [contacts, gates]);
  const today = localDay(new Date());
  const { rows, groups } = useMemo(
    () => buildEmailSchedule({ campaigns, members, today, most }),
    [campaigns, members, today, most],
  );

  const columns = useMemo(() => [
    { key: 'audienceLabel', label: 'Audience', defaultWidth: 115 },
    {
      key: 'title', label: 'Campaign', defaultWidth: 260,
      render: (r) => <button type="button" style={linkBtn} title={r.subject ? `Open this campaign (${r.subject})` : 'Open this campaign'} onClick={(e) => { e.stopPropagation(); onOpenCampaign?.(r.index); }}>{r.title}</button>,
    },
    {
      key: 'date', label: 'Scheduled', defaultWidth: 185, getFilterValue: (r) => fmt(r.date),
      render: (r) => <span style={{ color: r.overdue ? '#B91C1C' : undefined, fontWeight: r.overdue ? 700 : 400 }} title={r.overdue ? 'Overdue: counted as going out today' : ''}>{r.overdue ? `Overdue ${fmt(r.date)}` : fmt(r.date)}</span>,
    },
    {
      key: 'underCap', label: 'Under Cap', defaultWidth: 120,
      getSortValue: (r) => r.readiness.share, getFilterValue: (r) => pct(r.readiness.share),
      render: (r) => <span title={`${r.readiness.ok} of ${r.readiness.total} contacts would have no more than ${OUTREACH_LIMIT} emails in ${OUTREACH_WINDOW_DAYS} days with this one`}>{pct(r.readiness.share)} ({r.readiness.ok}/{r.readiness.total})</span>,
    },
    { key: 'overCap', label: 'Over Cap', defaultWidth: 90, getSortValue: (r) => r.readiness.over, getFilterValue: (r) => String(r.readiness.over), render: (r) => r.readiness.over },
    { key: 'target', label: 'Target Date', defaultWidth: 150, getFilterValue: (r) => fmt(r.target), render: (r) => (r.target ? fmt(r.target) : 'None in 6 months') },
    { key: 'status', label: 'Status', defaultWidth: 115, getSortValue: (r) => statusOf(r), getFilterValue: (r) => STATUS[statusOf(r)].label, render: (r) => <Pill s={statusOf(r)} /> },
  ], [onOpenCampaign]);

  return (
    <div data-email-schedule>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
        <span style={{ flex: '1 1 380px' }}>
          Planned dates come from the Sent To column on Saved Campaigns. A target date is the first weekday where most of the audience would have no more than {OUTREACH_LIMIT} campaign emails in the past {OUTREACH_WINDOW_DAYS} days, counting the new one and the audience&apos;s earlier planned sends.
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          &quot;Most&quot; means
          <select value={most} onChange={e => setMost(Number(e.target.value))} aria-label="Share of the audience that must be under the cap" style={{ font: 'inherit', fontSize: '0.75rem', padding: '1px 4px' }}>
            {MOST_CHOICES.map(v => <option key={v} value={v}>{pct(v)}</option>)}
          </select>
          of contacts
        </label>
      </div>
      {contacts === null && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Loading contacts...</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        {groups.map(g => <GroupCard key={g.key} g={g} most={most} onOpenCampaign={onOpenCampaign} />)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>All planned sends</span>
        <span role="group" aria-label="How to show the planned sends" style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
          {VIEWS.map(([key, text], i) => (
            <button key={key} type="button" data-schedule-view={key} aria-pressed={view === key} onClick={() => setView(key)} style={{
              font: 'inherit', fontSize: '0.72rem', fontWeight: 600, padding: '2px 10px', cursor: 'pointer', border: 'none',
              borderLeft: i ? '1px solid var(--color-border)' : 'none',
              background: view === key ? 'var(--color-accent)' : 'var(--color-surface)',
              color: view === key ? '#fff' : 'var(--color-text-secondary)',
            }}>{text}</button>
          ))}
        </span>
      </div>
      {view === 'calendar' && <ScheduleCalendar rows={rows} groups={groups} today={today} onOpenCampaign={onOpenCampaign} />}
      {view === 'list' && <div style={{ height: `min(60vh, ${140 + Math.max(rows.length, 1) * 40}px)`, display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)' }}>
        <DataTable
          tableId={TABLE_ID}
          exportFileName="Email schedule"
          columns={columns}
          rows={rows}
          alwaysVisible={['title']}
          emptyMessage="No planned sends. Pick a date under Sent To on Saved Campaigns."
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>}
    </div>
  );
}
