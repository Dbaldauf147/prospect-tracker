// Prospecting > History - how far down the ladder each working day got, and
// how many opps were overdue on step 1, charted day by day. The rows are
// written by useProspectingLadder as the day goes on (see
// utils/prospectingHistory.js for what a row holds and why); this page only
// reads them back.
//
// Below them, the Tiered Activity tiles day by day: per tier, the share of
// accounts reached in the window, and how many firms (tiered or not) had any
// activity in the last 120 days. Those rows are written whenever this page
// or Tiered Activity is open (hooks/useTieredActivity.js), so this page loads
// the same counts and records today's reading too.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  historyChartRows,
  historySnapshot,
  parseHistory,
  subscribeHistory,
  workingDaysBack,
} from '../../utils/prospectingHistory';
import { TIERS } from '../../data/enums.js';
import { ACTIVE_FIRMS_DAYS, ACTIVE_FIRM_BUCKETS, ACTIVITY_SUMMARY_DAYS, rosterActivityCounts, rosterActivityPeople, tierActivityCoverage } from '../../utils/tieredAccountActivity';
import { rosterActivityWorkbook } from '../../utils/rosterActivityExport';
import { makeMyCdmContactGate } from '../../utils/myCdmContacts';
import { useAuth } from '../../contexts/AuthContext';
import { useOpps2Data } from '../../hooks/useOpps2Data';
import { useRosterGates } from '../../hooks/useRosterTagCoverage';
import { todayISO } from '../../utils/prospectingStatus';
import { parseRosterActivityHistory, recordRosterActivity, rosterActivityChartRows, rosterActivityHistorySnapshot, subscribeRosterActivityHistory } from '../../utils/rosterActivityHistory';
import { activeFirmsChartRows, activeFirmsHistorySnapshot, parseActiveFirmsHistory, subscribeActiveFirmsHistory } from '../../utils/activeFirmsHistory';
import { coverageChartRows, coverageHistorySnapshot, parseCoverageHistory, subscribeCoverageHistory } from '../../utils/tieredCoverageHistory';
import {
  HIDDEN_STATUSES_KEY, WINDOW_DAYS_KEY, readHiddenCache, readWindowCache, statusOf, useRecordActiveFirms, useRecordTieredCoverage,
  useTieredActivity, validWindow,
} from '../../hooks/useTieredActivity';

const RANGES = [
  { days: 10, label: '2 weeks' },
  { days: 22, label: '1 month' },
  { days: 65, label: '3 months' },
];

const PROGRESS_COLOR = '#0A66C2';
const ALL_CLEAR_COLOR = '#16A34A';
const ZERO_COLOR = '#F87171';
const OVERDUE_START_COLOR = '#94A3B8';
const OVERDUE_END_COLOR = '#0A66C2';

const AXIS_TICK = { fontSize: 11, fill: '#64748B' };

// One hue per tier, checked for colour-blind separation as a set. Every
// line also has a dot per day and a legend, so colour is never the only cue.
const TIER_LINE_COLORS = { 'Tier 1': '#2563EB', 'Tier 2': '#D97706', 'Tier 3': '#0D9488' };
// The same three plus Not tiered for the firms-active bars. Purple rather
// than a gray: a gray sat too close to Tier 3's teal to tell apart (checked
// with the palette validator, normal and colour-blind vision).
const FIRM_BAR_COLORS = { ...TIER_LINE_COLORS, 'Not tiered': '#7C3AED' };
// The total line over the firms-active bars: dark slate, so it reads as the
// sum of the stack rather than one more tier.
const FIRM_TOTAL_COLOR = '#1E293B';

const CARD = {
  border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff',
  padding: '0.85rem 1rem 0.5rem',
};

function TooltipBox({ children }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8,
      padding: '6px 9px', fontSize: '0.72rem', color: '#1E293B',
      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)', maxWidth: 280,
    }}>{children}</div>
  );
}

function ProgressTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {row.reached == null ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t open)</div>
      ) : (
        <>
          <div>{row.reached} of {row.total} steps clear</div>
          {row.reachedTitle && <div style={{ color: '#475569' }}>Furthest: {row.reachedTitle}</div>}
          {row.nextTitle
            ? <div style={{ color: '#475569' }}>Stopped at: {row.nextTitle}</div>
            : <div style={{ color: '#166534', fontWeight: 600 }}>Whole ladder clear</div>}
        </>
      )}
    </TooltipBox>
  );
}

function OverdueTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {row.overdueStart == null ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t open)</div>
      ) : (
        <>
          <div>Start of day: {row.overdueStart} overdue</div>
          <div>End of day: {row.overdueEnd ?? row.overdueStart} overdue</div>
        </>
      )}
    </TooltipBox>
  );
}

function CoverageTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {!row.recorded ? (
        <div style={{ color: '#64748B' }}>Not recorded (Tiered Activity and History weren&apos;t opened)</div>
      ) : (
        <>
          {TIERS.map(tier => {
            const c = row[`${tier} counts`];
            return (
              <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: TIER_LINE_COLORS[tier], flexShrink: 0 }} />
                <span>{tier}: {row[tier] == null ? '-' : `${row[tier]}%`}{c ? ` (${c.active} of ${c.total})` : ''}</span>
              </div>
            );
          })}
          {row.windowDays != null && <div style={{ color: '#475569', marginTop: 2 }}>Reached within {row.windowDays} days</div>}
        </>
      )}
    </TooltipBox>
  );
}

function ActiveFirmsTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {!row.recorded ? (
        <div style={{ color: '#64748B' }}>Not recorded (Tiered Activity and History weren&apos;t opened)</div>
      ) : (
        <>
          {/* Top of the stack first, so the list reads in the order the bar does. */}
          {[...ACTIVE_FIRM_BUCKETS].reverse().map(b => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: FIRM_BAR_COLORS[b], flexShrink: 0 }} />
              <span style={{ color: '#475569' }}>{b}</span>
              <span style={{ marginLeft: 'auto', paddingLeft: 12, fontWeight: 700 }}>{row[b] ?? '-'}</span>
              <span style={{ color: '#64748B' }}>of {row[`${b} total`] ?? '-'}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 4, paddingTop: 3, fontWeight: 700 }}>
            {row.active} firm{row.active === 1 ? '' : 's'} active in the last {row.windowDays ?? ACTIVE_FIRMS_DAYS} days
          </div>
        </>
      )}
    </TooltipBox>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ ...CARD, padding: '0.6rem 0.9rem', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1E293B', lineHeight: 1.3 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{sub}</div>}
    </div>
  );
}

// The three contact rosters, one stacked 100% area chart each: per recorded
// day, the list split by how recently each person had a HubSpot email, call
// or contact, into bands that don't overlap (0-30 days, 31-90, 91-120, none
// in 120), so the bands always fill the chart top to bottom
// (utils/rosterActivityHistory). Most recent at the bottom, where a change
// is easiest to read off the baseline. The hues are checked as a set with
// the palette validator (every pair, normal and colour-blind vision,
// contrast on white) and kept apart from the tier colours above, so blue
// never reads as Tier 1 here; a thin white edge separates neighbouring
// bands, and the legend and tooltip name every band, so colour is never the
// only cue.
const ROSTER_BANDS = [
  { key: 'b30', label: 'Last 30 days', short: '0–30d', color: '#4F46E5', count: (r) => r.w30 },
  { key: 'b90', label: '31–90 days', short: '31–90d', color: '#D97706', count: (r) => r.w90 - r.w30 },
  { key: 'b120', label: '91–120 days', short: '91–120d', color: '#0891B2', count: (r) => r.w120 - r.w90 },
  { key: 'bNone', label: 'No activity in 120 days', short: 'None', color: '#BE123C', count: (r) => r.total - r.w120 },
];
const fmtPct = (v) => (v == null ? '-' : `${Math.round(v)}%`);

function RosterActivityTooltip({ active, payload }) {
  const row = active && payload?.[0]?.payload;
  if (!row) return null;
  return (
    <TooltipBox>
      <div style={{ fontWeight: 700 }}>{row.weekday}, {row.label}</div>
      {!row.recorded ? (
        <div style={{ color: '#64748B' }}>Not recorded (the app wasn&apos;t open with contacts loaded)</div>
      ) : row.b30 == null ? (
        <div style={{ color: '#64748B' }}>Recorded before the 90-day window was tracked</div>
      ) : (
        <>
          {/* Top band first, so the list reads in the order the chart stacks. */}
          {[...ROSTER_BANDS].reverse().map(b => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
              <span>{b.label}: <strong>{fmtPct(row[b.key])}</strong> ({b.count(row)} of {row.total})</span>
            </div>
          ))}
        </>
      )}
    </TooltipBox>
  );
}

// One roster's chart, as a full-width card of its own like the charts above.
// Clicking a day hands that chart row to `onPick`, which downloads the
// roster's raw data for it in Excel.
function RosterActivityChart({ label, data, note = '', onPick = null }) {
  const latest = [...data].reverse().find(r => r.recorded && r.b30 != null) || null;
  // An area needs a neighbour to span to; a day standing alone (the first
  // day recorded, or one between gaps) gets a dot per band edge instead, so
  // it still shows.
  const drawn = (i) => data[i]?.b30 != null;
  const loneDot = (color) => (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null || !drawn(index) || drawn(index - 1) || drawn(index + 1)) return null;
    return <circle key={`${color}-${index}`} cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={2} />;
  };
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>{label}: contacts with activity</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
          {latest ? `${latest.total} on the list${latest.iso !== data[data.length - 1]?.iso ? `, ${latest.label}` : ''}` : 'Not recorded yet'}
        </div>
      </div>
      {latest && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.68rem', color: '#475569', marginTop: 2 }}>
          {ROSTER_BANDS.map(b => (
            <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
              {b.short} <strong style={{ color: '#1E293B' }}>{fmtPct(latest[b.key])}</strong> ({b.count(latest)})
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: '0.68rem', color: '#64748B', margin: '2px 0 4px' }}>
        The {label} list split by when each person last had a HubSpot email, call or contact: in the last 30 days, 31 to 90, 91 to 120,
        or not in 120 days. The bands add up to 100%. A day is recorded whenever the app is open with contacts and the email/call feed
        loaded; a gap is a day that wasn&apos;t.{note}{onPick ? ' Click a day to download its raw data in Excel.' : ''}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 16, left: -10, bottom: 0 }}
          onClick={onPick ? (state) => {
            // The day under the pointer; nothing when it isn't over one.
            const i = state?.activeTooltipIndex;
            const row = i == null || i === '' ? null : data[Number(i)];
            if (row) onPick(row);
          } : undefined}
          style={onPick ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid vertical={false} stroke="#EEF2F6" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} allowDataOverflow />
          <Tooltip content={<RosterActivityTooltip />} cursor={{ stroke: '#94A3B8', strokeWidth: 1 }} />
          {ROSTER_BANDS.map(b => (
            <Area
              key={b.key}
              type="linear"
              dataKey={b.key}
              name={b.label}
              stackId="roster"
              fill={b.color}
              fillOpacity={0.85}
              stroke="#fff"
              strokeWidth={1.5}
              dot={loneDot(b.color)}
              activeDot={{ r: 4, fill: b.color, stroke: '#fff', strokeWidth: 2 }}
              // A day that wasn't recorded is a gap, not a slope across it
              // that reads like a reading.
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, fontSize: '0.7rem', color: '#475569', margin: '2px 0 4px' }}>
        {ROSTER_BANDS.map(b => (
          <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProspectingHistory({ today, maxWidth, prospects = null, settings = null, cdmName = '' }) {
  const raw = useSyncExternalStore(subscribeHistory, historySnapshot);
  const history = useMemo(() => parseHistory(raw), [raw]);
  const [range, setRange] = useState(RANGES[1].days);
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(
    () => historyChartRows(history, workingDaysBack(today, range)),
    [history, today, range],
  );

  // Today's Tiered Activity reading, worked out the way that subtab's tiles
  // are (its saved Hide statuses and Active within window), so opening
  // History alone still adds today's point.
  const { contacts, outreachIndex, noIndex, accounts, activity, localFields, links, exclusions } = useTieredActivity({ prospects, settings, cdmName });
  const [cachedHidden] = useState(readHiddenCache);
  const [cachedWindow] = useState(readWindowCache);
  const savedHidden = settings?.[HIDDEN_STATUSES_KEY];
  const hiddenStatuses = Array.isArray(savedHidden) ? savedHidden : (cachedHidden || []);
  const hiddenKey = hiddenStatuses.join('\u0000');
  const windowDays = validWindow(settings?.[WINDOW_DAYS_KEY]) ?? cachedWindow ?? ACTIVITY_SUMMARY_DAYS;
  const coverage = useMemo(() => {
    if (!activity) return null;
    const hidden = new Set(hiddenKey ? hiddenKey.split('\u0000') : []);
    return tierActivityCoverage(accounts.filter(p => !hidden.has(statusOf(p))), activity, { days: windowDays });
  }, [accounts, activity, hiddenKey, windowDays]);
  useRecordTieredCoverage({ coverage, windowDays, contacts, noIndex, accounts });
  useRecordActiveFirms({ prospects, cdmName, contacts, outreachIndex, noIndex, localFields, links, exclusions });

  // Dan Key Target, Dan Key Prospect and Decision Makers, counted the way
  // the contacts pages list them (their own gates and client exclusions).
  const { user } = useAuth() || {};
  const oppsRecords = useOpps2Data(user?.uid)?.records ?? null;
  const rosterGates = useRosterGates({ prospects, cdmName, oppsRecords, userId: user?.uid });
  const myCdmGate = useMemo(
    () => makeMyCdmContactGate({ prospects: prospects || [], cdmName, localFields }),
    [prospects, cdmName, localFields],
  );
  const rosterActivity = useMemo(
    () => (contacts ? rosterActivityCounts({ contacts, gates: rosterGates, myCdmGate, outreachIndex, localFields }) : null),
    [contacts, rosterGates, myCdmGate, outreachIndex, localFields],
  );
  // Today's reading goes into the record straight away while this page is
  // open (App records it too, so a day is logged without visiting here),
  // but only once it is real: the email/call index loaded and the opps in
  // hand, since they decide who is a Key Prospect.
  useEffect(() => {
    if (!rosterActivity || noIndex || oppsRecords == null || !contacts?.length) return;
    recordRosterActivity(todayISO(), rosterActivity);
  }, [rosterActivity, noIndex, oppsRecords, contacts]);
  const rawRosterHistory = useSyncExternalStore(subscribeRosterActivityHistory, rosterActivityHistorySnapshot);
  const rosterHistory = useMemo(() => parseRosterActivityHistory(rawRosterHistory), [rawRosterHistory]);
  // One chart per roster, in the order the counts list them; a roster's
  // name comes from its latest recorded row, else today's counts.
  const rosterCharts = useMemo(() => {
    const byIso = new Map(rows.map(r => [r.iso, r]));
    const keys = (rosterActivity || []).map(r => ({ key: r.key, label: r.label }));
    for (const day of Object.keys(rosterHistory).sort()) {
      for (const [key, r] of Object.entries(rosterHistory[day]?.rosters || {})) {
        const at = keys.find(k => k.key === key);
        if (at) { if (!rosterActivity) at.label = r.label || at.label; } else keys.push({ key, label: r.label || key });
      }
    }
    return keys.map(k => ({
      ...k,
      data: rosterActivityChartRows(rosterHistory, rows.map(r => r.iso), k.key)
        .map(c => ({ ...c, label: byIso.get(c.iso)?.label, weekday: byIso.get(c.iso)?.weekday })),
    }));
  }, [rosterActivity, rosterHistory, rows]);

  // One roster's raw data for a clicked day, as an Excel download: the
  // day's counts, every day on the chart, and the people on the list now.
  const downloadRosterDay = async (roster, day) => {
    const people = rosterActivityPeople({ contacts, gates: rosterGates, myCdmGate, outreachIndex, localFields })
      .find(x => x.key === roster.key)?.people || [];
    const { filename, sheets } = rosterActivityWorkbook({ label: roster.label, day, data: roster.data, people, today: todayISO() });
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const sh of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
    XLSX.writeFile(wb, filename);
  };

  const rawFirms = useSyncExternalStore(subscribeActiveFirmsHistory, activeFirmsHistorySnapshot);
  const firmsHistory = useMemo(() => parseActiveFirmsHistory(rawFirms), [rawFirms]);
  const firmsData = useMemo(() => {
    const byIso = new Map(rows.map(r => [r.iso, r]));
    return activeFirmsChartRows(firmsHistory, rows.map(r => r.iso))
      .map(c => ({ ...c, label: byIso.get(c.iso)?.label, weekday: byIso.get(c.iso)?.weekday }));
  }, [firmsHistory, rows]);
  const firmsRecordedRows = firmsData.filter(r => r.recorded && r.active != null);
  const firmsRecorded = firmsData.filter(r => r.recorded).length;
  const firmsLatest = firmsRecordedRows[firmsRecordedRows.length - 1] || null;
  const firmsFirst = firmsRecordedRows[0] || null;
  const firmsChange = firmsLatest && firmsFirst && firmsLatest !== firmsFirst ? firmsLatest.active - firmsFirst.active : null;
  // Each total is printed above its point while there's room for it; on the
  // longer ranges only the latest one is, so the numbers don't overlap.
  const labelEveryFirmsPoint = firmsData.length <= 22;

  const rawCoverage = useSyncExternalStore(subscribeCoverageHistory, coverageHistorySnapshot);
  const coverageHistory = useMemo(() => parseCoverageHistory(rawCoverage), [rawCoverage]);
  const coverageData = useMemo(() => {
    const byIso = new Map(rows.map(r => [r.iso, r]));
    return coverageChartRows(coverageHistory, rows.map(r => r.iso))
      .map(c => ({ ...c, label: byIso.get(c.iso)?.label, weekday: byIso.get(c.iso)?.weekday }));
  }, [coverageHistory, rows]);
  const coverageRecorded = coverageData.filter(r => r.recorded).length;
  const coverageWindows = [...new Set(coverageData.map(r => r.windowDays).filter(n => n != null))];
  const recorded = rows.filter(r => r.recorded);
  const maxSteps = Math.max(1, ...rows.map(r => r.total || 0));
  const maxOverdue = Math.max(1, ...rows.map(r => Math.max(r.overdueStart || 0, r.overdueEnd || 0)));

  const todayRow = rows.find(r => r.iso === today);
  const allClearDays = recorded.filter(r => r.reached != null && r.reached === r.total).length;
  const avgReached = recorded.length
    ? (recorded.reduce((n, r) => n + (r.reached || 0), 0) / recorded.length).toFixed(1)
    : null;

  // Bars need a value to draw; a day with no row plots nothing at all. A
  // recorded day that cleared nothing gets a sliver rather than nothing, so
  // "stuck on step 1" and "app not opened" don't look the same.
  const progressData = rows.map(r => ({ ...r, value: r.reached === 0 ? maxSteps * 0.02 : r.reached }));
  const overdueData = rows.map(r => ({ ...r, start: r.overdueStart, end: r.overdueEnd }));

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 300px', maxWidth: 760 }}>
          Each working day is recorded while the app is open: the furthest the ladder got (a step counts
          once every step above it is clear too), and how many opps were overdue on step 1 when the day
          started and where it was left.
        </div>
        <div role="group" aria-label="Date range" style={{ display: 'flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              onClick={() => setRange(r.days)}
              aria-pressed={range === r.days}
              style={{
                padding: '3px 10px', border: 0, fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                background: range === r.days ? '#0A66C2' : '#fff', color: range === r.days ? '#fff' : '#475569',
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat
          label="Today"
          value={todayRow?.reached != null ? `${todayRow.reached} of ${todayRow.total}` : '-'}
          sub={todayRow?.reached != null ? (todayRow.nextTitle ? `Next: ${todayRow.nextTitle}` : 'Whole ladder clear') : 'Not recorded yet'}
        />
        <Stat label="Average steps clear" value={avgReached ?? '-'} sub={`${recorded.length} day${recorded.length === 1 ? '' : 's'} recorded`} />
        <Stat label="Whole ladder clear" value={recorded.length ? `${allClearDays}` : '-'} sub={`of ${recorded.length} recorded day${recorded.length === 1 ? '' : 's'}`} />
        <Stat
          label="Overdue opps now"
          value={todayRow?.overdueEnd != null ? todayRow.overdueEnd : '-'}
          sub={todayRow?.overdueStart != null ? `${todayRow.overdueStart} at start of day` : 'Not recorded yet'}
        />
      </div>

      {recorded.length === 0 && (
        <div style={{ padding: '0.75rem 1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          Nothing recorded yet. Today&apos;s progress is saved as the ladder&apos;s counts load and as you mark steps
          caught up, and each working day adds a bar from here on.
        </div>
      )}

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Steps cleared each day</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          How far down the ladder you got. Green bars cleared the whole ladder, a red sliver cleared nothing, and an empty day wasn&apos;t recorded.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={progressData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} domain={[0, maxSteps]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <ReferenceLine y={maxSteps} stroke="#BBF7D0" strokeDasharray="4 3" />
            <Tooltip content={<ProgressTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Bar dataKey="value" name="Steps clear" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {progressData.map(r => (
                <Cell key={r.iso} fill={r.reached === 0 ? ZERO_COLOR : (r.reached != null && r.reached === r.total ? ALL_CLEAR_COLOR : PROGRESS_COLOR)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Step 1: overdue opps</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          Opps due to be called (Call In 0 or less) at the start of each day and where the day was left.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={overdueData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} domain={[0, maxOverdue]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<OverdueTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Legend
              iconType="square" iconSize={10} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }}
              // Bar order, not alphabetical: start of day reads first.
              itemSorter={null}
            />
            <Bar dataKey="start" name="Start of day" fill={OVERDUE_START_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="end" name="End of day" fill={OVERDUE_END_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={CARD}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Tiered accounts reached</div>
        <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
          The Tiered Activity tiles each day: per tier, the % of your accounts with a HubSpot email, call or contact
          in the {coverageWindows.length === 1 ? `last ${coverageWindows[0]} days` : 'Active within window'}. A day is recorded
          whenever Tiered Activity or this page is open{coverageRecorded === 0 ? ', starting today' : ''}; a day with no dot is one neither was.
          {coverageWindows.length > 1 ? ' The window was changed during this range, so hover a day to see the one it used.' : ''}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={coverageData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<CoverageTooltip />} cursor={{ stroke: '#CBD5E1', strokeWidth: 1 }} />
            <Legend
              iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }}
              itemSorter={null}
            />
            {TIERS.map(tier => (
              <Line
                key={tier}
                type="linear"
                dataKey={tier}
                name={tier}
                stroke={TIER_LINE_COLORS[tier]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: TIER_LINE_COLORS[tier] }}
                activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Firms with activity in the last {ACTIVE_FIRMS_DAYS} days</div>
            <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: 6 }}>
              How many of your firms had a HubSpot email, call or contact in the {ACTIVE_FIRMS_DAYS} days up to each day, stacked by
              tier, with your accounts that have no tier as Not tiered. The line is the total. A day is recorded whenever Tiered
              Activity or this page is open{firmsRecorded === 0 ? ', starting today' : ''}; a day with no bar is one neither was.
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8' }}>
              {firmsLatest && firmsLatest.iso !== today ? `Firms active, ${firmsLatest.label}` : 'Firms active now'}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1E293B', lineHeight: 1.2 }}>{firmsLatest ? firmsLatest.active : '-'}</div>
            <div style={{ fontSize: '0.68rem', color: firmsChange > 0 ? '#166534' : firmsChange < 0 ? '#B91C1C' : '#64748B' }}>
              {firmsChange == null
                ? (firmsLatest ? 'First day recorded' : 'Not recorded yet')
                : `${firmsChange > 0 ? '+' : ''}${firmsChange} since ${firmsFirst.label}`}
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={firmsData} margin={{ top: 20, right: 12, left: -18, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#EEF2F6" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip content={<ActiveFirmsTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: '0.7rem', color: '#475569' }} itemSorter={null} />
            {ACTIVE_FIRM_BUCKETS.map((b, i) => (
              <Bar
                key={b}
                dataKey={b}
                name={b}
                stackId="firms"
                fill={FIRM_BAR_COLORS[b]}
                // A thin white edge between segments so neighbouring tiers
                // don't run together; only the top segment is rounded.
                stroke="#fff"
                strokeWidth={1}
                radius={i === ACTIVE_FIRM_BUCKETS.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
            <Line
              type="linear"
              dataKey="active"
              name="Total"
              stroke={FIRM_TOTAL_COLOR}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: FIRM_TOTAL_COLOR }}
              activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            >
              <LabelList
                dataKey="active"
                content={({ x, y, value, index }) => {
                  if (value == null || x == null || y == null) return null;
                  if (!labelEveryFirmsPoint && firmsData[index]?.iso !== firmsLatest?.iso) return null;
                  return (
                    <text x={x} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill={FIRM_TOTAL_COLOR}>{value}</text>
                  );
                }}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {rosterCharts.length === 0 ? (
        <div style={CARD}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Contacts with activity</div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8', padding: '1rem 0' }}>{rosterActivity ? 'Nothing recorded yet.' : 'Loading contacts...'}</div>
        </div>
      ) : rosterCharts.map(r => (
        <RosterActivityChart
          key={r.key}
          label={r.label}
          data={r.data}
          onPick={contacts ? (day) => downloadRosterDay(r, day) : null}
          note={noIndex ? ' HubSpot emails and calls count once the Activity tab has loaded its feed; until then only Last Contacted dates do.' : ''}
        />
      ))}

      <div>
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          style={{
            padding: '3px 10px', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
            fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600, color: '#0A66C2', cursor: 'pointer',
          }}
        >{showTable ? 'Hide table' : 'Show as a table'}</button>
        {showTable && (
          <table style={{ marginTop: 8, borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%', background: '#fff' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748B' }}>
                {['Day', 'Steps clear', 'Stopped at', 'Overdue at start', 'Overdue at end', ...TIERS.map(t => `${t} reached`), ...ACTIVE_FIRM_BUCKETS.map(b => `${b} active ${ACTIVE_FIRMS_DAYS}d`), ...rosterCharts.map(r => `${r.label} 0–30 / 31–90 / 91–120d / none`)].map(h => (
                  <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map(r => {
                const c = coverageData.find(x => x.iso === r.iso);
                const f = firmsData.find(x => x.iso === r.iso);
                return (
                <tr key={r.iso} style={{ color: r.recorded ? '#1E293B' : '#94A3B8' }}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.weekday}, {r.label}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.reached != null ? `${r.reached} of ${r.total}` : '-'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.reached == null ? '-' : (r.nextTitle || 'All clear')}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.overdueStart ?? '-'}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{r.overdueEnd ?? '-'}</td>
                  {TIERS.map(t => (
                    <td key={t} style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', color: c?.recorded ? '#1E293B' : '#94A3B8' }}>
                      {c?.[t] == null ? '-' : `${c[t]}%`}
                    </td>
                  ))}
                  {ACTIVE_FIRM_BUCKETS.map(b => (
                    <td key={b} style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', color: f?.recorded ? '#1E293B' : '#94A3B8' }}>
                      {f?.[b] == null ? '-' : `${f[b]} of ${f[`${b} total`]}`}
                    </td>
                  ))}
                  {rosterCharts.map((rc) => {
                    const d = rc.data.find(x => x.iso === r.iso);
                    return (
                      <td key={rc.key} style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', color: d?.recorded ? '#1E293B' : '#94A3B8' }}>
                        {d?.b30 != null ? `${ROSTER_BANDS.map(b => fmtPct(d[b.key])).join(' / ')} of ${d.total}` : '-'}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
