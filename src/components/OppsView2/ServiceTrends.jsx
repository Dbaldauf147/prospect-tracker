import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DataTable } from '../common/DataTable';
import { TagMultiSelect } from '../common/TagMultiSelect';
import {
  EXCLUDED_KEY, GROUPS_KEY, excludedFromSettings, groupsFromSettings, withExcluded, withServiceGroup,
} from '../../utils/serviceTrendSettings';
import { serviceShareTrend, serviceCloseRateTrend, serviceDealSizeTrend, periodLabel, servicesOf } from '../../utils/serviceTrends';
import { getServiceCategories } from '../../utils/serviceCategoriesStore';
import styles from './OppsView2.module.css';

const muted = { color: 'var(--color-text-muted, #64748B)' };

// The validated categorical order the other Opps trend charts use. With
// nothing picked the chart draws the busiest MAX_LINES services; picking
// draws exactly the picked ones, however many, and lines past the eighth
// take colours spread round the wheel (lineColour).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_LINES = PALETTE.length;
function lineColour(i) {
  if (i < PALETTE.length) return PALETTE[i];
  // Golden-angle hue steps keep neighbouring extra lines apart.
  const hue = Math.round((i - PALETTE.length) * 137.508 + 200) % 360;
  return `hsl(${hue}, 62%, ${i % 2 ? 42 : 55}%)`;
}
// Services switched off the chart for good (the Hide column of the
// Services picker), saved and shared by both trend subtabs. They are never
// drawn, picked or not; on the % of 100 scale they fall into Other.

/**
 * The Chart box: a button that opens a list of every service with a Show
 * and a Hide checkbox. Show picks the service onto the chart (none shown
 * means the busiest eight); Hide keeps it off the chart. "Show all" picks
 * every service that isn't hidden.
 */
function ServicePicker({ options, picked, excluded, onPickedChange, onExcludedChange, noun }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setTerm(''); } };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setTerm(''); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const pickedSet = new Set(picked);
  const excludedSet = new Set(excluded);
  const shown = options.filter(o => pickedSet.has(o) && !excludedSet.has(o));
  const hiddenCount = options.filter(o => excludedSet.has(o)).length;
  const showable = options.filter(o => !excludedSet.has(o));
  const q = term.trim().toLowerCase();
  const list = q ? options.filter(o => o.toLowerCase().includes(q)) : options;

  const setShow = (o, on) => {
    onPickedChange(on ? [...picked.filter(x => x !== o), o] : picked.filter(x => x !== o));
    if (on && excludedSet.has(o)) onExcludedChange(excluded.filter(x => x !== o));
  };
  const setHide = (o, on) => {
    onExcludedChange(on ? [...excluded.filter(x => x !== o), o].sort((a, b) => a.localeCompare(b)) : excluded.filter(x => x !== o));
    if (on && pickedSet.has(o)) onPickedChange(picked.filter(x => x !== o));
  };

  let label = shown.length === 0
    ? `Top ${MAX_LINES} ${noun}`
    : shown.length === showable.length ? `All ${showable.length} ${noun}` : `${shown.length} ${noun} shown`;
  if (hiddenCount) label += `, ${hiddenCount} hidden`;

  const btn = { background: 'none', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text)' };
  const cell = { width: 44, textAlign: 'center', flexShrink: 0 };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 32, padding: '0.3rem 0.55rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 6, background: 'var(--color-bg, #fff)', color: 'var(--color-text)', fontSize: '0.74rem', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ fontSize: '0.6rem', ...muted }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Services on the chart"
          style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, width: 'max(100%, 340px)', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.14)', display: 'flex', flexDirection: 'column', maxHeight: 380 }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0.45rem 0.55rem 0.3rem' }}>
            <button type="button" style={btn} onClick={() => onPickedChange(showable)} title={`Draw every ${noun === 'lines' ? 'line' : 'service'} that isn't hidden`}>Show all</button>
            <button type="button" style={btn} onClick={() => onPickedChange([])} disabled={!picked.length} title={`Clear the Show ticks: the chart goes back to the top ${MAX_LINES}`}>Clear shown</button>
            <button type="button" style={btn} onClick={() => onExcludedChange([])} disabled={!hiddenCount} title="Clear the Hide ticks">Clear hidden</button>
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={term}
            onChange={e => setTerm(e.target.value)}
            autoFocus
            style={{ margin: '0 0.55rem 0.35rem', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none', background: 'var(--color-bg, #fff)', color: 'var(--color-text)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', padding: '0.15rem 0.6rem', fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border, #E2E8F0)', ...muted }}>
            <span style={{ flex: 1 }}>{noun === 'lines' ? 'Line' : 'Service'}</span>
            <span style={cell} title="Draw it on the chart">Show</span>
            <span style={cell} title="Keep it off the chart (saved)">Hide</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {list.map(o => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', padding: '0.25rem 0.6rem', fontSize: '0.74rem', color: 'var(--color-text)', opacity: excludedSet.has(o) ? 0.55 : 1 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o}>{o}</span>
                <span style={cell}><input type="checkbox" aria-label={`Show ${o}`} checked={pickedSet.has(o) && !excludedSet.has(o)} onChange={e => setShow(o, e.target.checked)} /></span>
                <span style={cell}><input type="checkbox" aria-label={`Hide ${o}`} checked={excludedSet.has(o)} onChange={e => setHide(o, e.target.checked)} /></span>
              </div>
            ))}
            {list.length === 0 && <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.72rem', ...muted }}>No matches</div>}
          </div>
          <div style={{ padding: '0.35rem 0.6rem', fontSize: '0.68rem', borderTop: '1px solid var(--color-border, #E2E8F0)', ...muted }}>
            Nothing ticked under Show draws the top {MAX_LINES}. Hidden ones stay off the chart{noun === 'lines' ? '' : ' (on % of 100 they count in Other)'}.
          </div>
        </div>
      )}
    </div>
  );
}
const OVERALL_COLOUR = '#334155';
const OVERALL_KEY = '__overall';
const OTHER_COLOUR = '#cbd5e1';
const OTHER_KEY = '__other';
const TAGS_KEY = '__tags';

// The share mode's two scales. 'mix' (the default) is each service's slice
// of every service tag in the period, so a period stacks to 100%; 'opps' is
// the share of opps that include the service, which can top 100%.
const SCALES = [
  { key: 'mix', label: '% of 100', title: 'Each period stacks to 100%: each service\'s slice of all the services on the opps started' },
  { key: 'opps', label: '% of opps', title: 'Each service\'s share of the opps started (an opp with several services counts toward each)' },
];
const MIX_BLURB = 'Each period\'s service mix, adding up to 100%: of every service on the opps that started in the period (by Start Date, open or closed), the slice each service makes up. An opp with several services counts once toward each. Services not drawn are grouped as Other.';

const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

const MODES = {
  share: {
    title: '% of total opps',
    dateLabel: 'Started',
    defaultPeriod: 'quarter',
    blurb: 'Of the opps that started in each period (by Start Date, open or closed), the share that include each service. An opp with several services counts toward each, so a period can add up to more than 100%.',
    empty: 'No opps with a Start Date match these filters.',
    tableId: 'opps2-service-share-trend',
    exportName: '% of total opps by service',
  },
  closeRate: {
    title: 'Close rate',
    dateLabel: 'Closed',
    defaultPeriod: 'year',
    blurb: 'Of each service\'s opps decided in a period (Sold or Not Sold, by Close Date), the share that were won. Overall counts each opp once, whatever its services.',
    empty: 'No decided opps match these filters.',
    tableId: 'opps2-service-close-rate-trend',
    exportName: 'Close rate by service',
  },
  dealSize: {
    title: 'Avg deal size',
    dateLabel: 'Started',
    defaultPeriod: 'quarter',
    blurb: 'Of each service\'s opps that started in a period (by Start Date, open or closed) with a Quoted Amount, the average Quoted Amount. Overall counts each opp once, at its full amount, whatever its services. Opps with no Quoted Amount are left out.',
    soldBlurb: 'Of each service\'s Sold opps that started in a period (by Start Date) with a Quoted Amount, the average Quoted Amount. Overall counts each opp once, at its full amount, whatever its services.',
    empty: 'No opps with a Start Date and a Quoted Amount match these filters.',
    tableId: 'opps2-service-deal-size-trend',
    exportName: 'Avg deal size by service',
  },
};

// Deal size mode: every quoted opp, or only the Sold ones.
const DEAL_SETS = [
  { key: 'all', label: 'All quoted', title: 'Every opp with a Quoted Amount, open or closed' },
  { key: 'sold', label: 'Sold only', title: 'Only Sold opps: the average won deal' },
];

// Deal size mode: how an opp with several services is credited.
const SPLITS = [
  { key: 'full', label: 'Full to each', title: 'An opp scoped "A, B" counts its whole Quoted Amount toward A and toward B' },
  { key: 'split', label: 'Split evenly', title: 'An opp scoped "A, B" counts half its Quoted Amount toward A and half toward B' },
];
const SPLIT_BLURB = {
  full: 'An opp with several services counts its whole amount toward each.',
  split: 'An opp with several services is split evenly: a $30,000 opp scoped "A, B, C" counts $10,000 toward each.',
};

/**
 * The popup behind one Avg deal size number: the opps averaged, what each
 * one put toward the line, and the sum / count that makes the average.
 * Chips across the top switch between Overall and the services that have
 * opps in the same period, so a click on the chart can be followed down
 * to any line. `onOpenOpp` (optional) opens an opp's details.
 */
function DealBreakdown({ trend, pick, period, split, sold, colourOf, onPick, onClose, onOpenOpp, settings, updateSettings }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const p = pick.period;
  const isOverall = pick.key === OVERALL_KEY;
  const series = isOverall ? null : trend.series.find(x => x.key === pick.key);
  const src = useMemo(() => (isOverall
    ? (p == null ? { opps: trend.opps, sum: trend.sum, sized: trend.sized, avg: trend.avg } : trend.overall[p])
    : series && (p == null ? series : series.byPeriod[p])), [isOverall, p, trend, series]);
  const opps = useMemo(() => [...(src?.opps || [])].sort((a, b) => b.counted - a.counted), [src]);
  const chips = [OVERALL_KEY, ...trend.series.filter(x => (p == null ? x.sized : x.byPeriod[p]?.sized) > 0).map(x => x.key)];
  const when = p == null ? 'whole window' : periodLabel(p, period);
  const name = isOverall ? 'Overall' : pick.key;
  const shared = opps.filter(o => o.of > 1).length;
  const multi = opps.filter(o => servicesOf(o.r).length > 1).length;
  const rows = opps.map((o, i) => ({ ...o, id: o.r._id || `${i}` }));
  const columns = [
    { key: 'account', label: 'Account', defaultWidth: 200, render: (o) => String(o.r['Account'] || '').trim() || '-', getFilterValue: (o) => String(o.r['Account'] || ''), exportValue: (o) => String(o.r['Account'] || '') },
    { key: 'scope', label: 'Scope', defaultWidth: 230, render: (o) => o.r['Scope'] || '-', getFilterValue: (o) => String(o.r['Scope'] || ''), exportValue: (o) => String(o.r['Scope'] || '') },
    { key: 'stage', label: 'Stage', defaultWidth: 110, render: (o) => o.r['Stage'] || '-', getFilterValue: (o) => String(o.r['Stage'] || ''), exportValue: (o) => String(o.r['Stage'] || '') },
    { key: 'start', label: 'Start Date', defaultWidth: 110, render: (o) => o.r['Start Date'] || '-', getFilterValue: (o) => String(o.r['Start Date'] || ''), exportValue: (o) => String(o.r['Start Date'] || '') },
    {
      key: 'amount', label: 'Quoted Amount', defaultWidth: 130,
      render: (o) => <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(o.amount)}</div>,
      getSortValue: (o) => o.amount, getFilterValue: (o) => fmtMoney(o.amount), exportValue: (o) => o.amount,
    },
    {
      key: 'counted', label: isOverall ? 'Counted' : `Counted toward ${name}`, defaultWidth: 210,
      render: (o) => (
        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} title={o.of > 1 ? `${fmtMoney(o.amount)} shared over the ${o.of} services on the Scope` : 'The whole Quoted Amount'}>
          {fmtMoney(o.counted)}
          {o.of > 1 && <span style={{ ...muted, fontWeight: 400 }}> ({Math.round((o.counted / o.amount) * o.of)}/{o.of} of it)</span>}
        </div>
      ),
      getSortValue: (o) => o.counted, getFilterValue: (o) => fmtMoney(o.counted), exportValue: (o) => o.counted,
    },
  ];
  const chip = (k) => {
    const on = k === pick.key;
    return (
      <button
        key={k}
        type="button"
        onClick={() => onPick({ key: k, period: p })}
        className={on ? styles.notSoldYearOn : styles.notSoldYear}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        <span style={{ width: 8, height: k === OVERALL_KEY ? 3 : 8, borderRadius: k === OVERALL_KEY ? 0 : 999, background: colourOf(k) }} />
        {k === OVERALL_KEY ? 'Overall' : k}
      </button>
    );
  };
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-label={`${name}, ${when}: deal size breakdown`}
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.1rem 1.25rem', width: 'min(1100px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: '0.6rem', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: isOverall ? 3 : 12, borderRadius: isOverall ? 0 : 999, background: colourOf(pick.key) }} />
            {name}, {when}
            <span style={{ ...muted, fontWeight: 400, fontSize: '0.8rem' }}>Avg deal size breakdown</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <div className={styles.notSoldYears} style={{ flexWrap: 'wrap' }}>
          <span className={styles.filterLabel} style={{ marginRight: 2 }}>Line</span>
          {chips.map(chip)}
        </div>
        {!src || !src.sized ? (
          <div style={{ padding: '1rem', ...muted }}>No opps with a Quoted Amount here.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem 1rem', padding: '0.6rem 0.75rem', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, background: 'var(--color-surface-alt, #F8FAFC)', fontSize: '0.85rem' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(src.sum)} counted <span style={muted}>÷</span> {src.sized} opp{src.sized === 1 ? '' : 's'} <span style={muted}>=</span>{' '}
                <strong style={{ fontSize: '1.05rem' }}>{fmtMoney(src.avg)}</strong> average
              </span>
              <span style={{ ...muted, fontSize: '0.78rem' }}>
                {isOverall
                  ? `Each ${sold ? 'Sold ' : ''}opp counts once at its full Quoted Amount${multi ? `, including the ${multi} with several services` : ''}.`
                  : split
                    ? (shared ? `${shared} of these opp${shared === 1 ? ' has' : 's have'} several services, so only ${name}'s even share of the amount is counted. Switch to Full to each to count the whole amount.` : `None of these opps share their amount with another service, so Split evenly and Full to each give the same average here.`)
                    : (multi ? `${multi} of these opp${multi === 1 ? ' has' : 's have'} other services too, and the whole amount still counts toward ${name}. Switch to Split evenly to count only ${name}'s share.` : `Each opp here is ${name} only, so its whole amount counts.`)}
              </span>
            </div>
            <div style={{ flex: '0 1 auto', minHeight: 220, height: Math.min(130 + rows.length * 36, 560), display: 'flex', flexDirection: 'column' }}>
              <DataTable
                tableId="opps2-service-deal-size-breakdown"
                columns={columns}
                rows={rows}
                alwaysVisible={['account']}
                onRowClick={onOpenOpp ? (o) => o.r._id && onOpenOpp(o.r._id) : undefined}
                exportFileName={`Avg deal size, ${name}, ${when}`}
                emptyMessage="No opps"
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
            {onOpenOpp && <div style={{ ...muted, fontSize: '0.72rem' }}>Click a row to open the opp.</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Saved service groups (settings.oppsServiceTrendGroups) and the Count in
// Other list live in utils/serviceTrendSettings, shared with Close Rates.

// The editor for the groups: a name and its services per row, edited as a
// draft and saved together so a half-typed name never reaches the chart.
export function GroupEditor({ groups, services, settings, onSave, onClose }) {
  const [draft, setDraft] = useState(() => groups.map(g => ({ name: g.name, services: [...g.services] })));
  const edit = (i, patch) => setDraft(d => d.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  // A service sits in one group at a time, so each picker offers the
  // services no other group has taken.
  const takenElsewhere = (i) => new Set(draft.flatMap((g, j) => (j === i ? [] : g.services)));
  const fromBuckets = () => {
    const have = new Set(services);
    const next = getServiceCategories(settings)
      .map(c => ({ name: c.name, services: c.items.filter(x => have.has(x)) }))
      .filter(c => c.services.length > 0);
    setDraft(next);
  };
  const names = draft.map(g => g.name.trim().toLowerCase()).filter(Boolean);
  const dupe = names.some((n, i) => names.indexOf(n) !== i);
  const save = () => {
    onSave(draft
      .map(g => ({ name: g.name.trim(), services: g.services }))
      .filter(g => g.name && g.services.length));
  };
  const btn = { fontSize: '0.74rem', padding: '3px 10px', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, background: 'var(--color-surface, #fff)', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8, padding: '0.6rem 0.75rem', background: 'var(--color-surface, #fff)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
      <div style={{ fontWeight: 700 }}>Service groups</div>
      <div style={muted}>Each group draws as one line, and an opp counts once toward a group however many of its services it carries. Services in no group stay on their own.</div>
      {draft.length === 0 && <div style={muted}>No groups yet.</div>}
      {draft.map((g, i) => {
        const taken = takenElsewhere(i);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className={styles.filterInput}
              style={{ width: 200 }}
              placeholder="Group name"
              value={g.name}
              onChange={e => edit(i, { name: e.target.value })}
            />
            <div style={{ flex: '1 1 320px', minWidth: 240 }}>
              <TagMultiSelect
                options={services.filter(x => !taken.has(x))}
                selected={g.services}
                onToggle={(v) => edit(i, { services: g.services.includes(v) ? g.services.filter(x => x !== v) : [...g.services, v] })}
                placeholder="Pick services"
              />
            </div>
            <button type="button" style={btn} onClick={() => setDraft(d => d.filter((_, j) => j !== i))} title="Remove this group">Remove</button>
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <button type="button" style={btn} onClick={() => setDraft(d => [...d, { name: '', services: [] }])}>+ Add group</button>
        <button type="button" style={btn} onClick={fromBuckets} title="Replace these groups with the service buckets from the services board">Start from service buckets</button>
        <span style={{ flex: 1 }} />
        {dupe && <span style={{ color: '#b91c1c' }}>Two groups share a name</span>}
        <button type="button" style={btn} onClick={onClose}>Cancel</button>
        <button type="button" style={{ ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff', opacity: dupe ? 0.5 : 1 }} disabled={dupe} onClick={save}>Save groups</button>
      </div>
    </div>
  );
}

// The popup a service (or group) name in the table opens: which group the
// service sits in, whether its line is visible by default, whether it always
// counts in Other, and Hide. Every choice saves straight away and is shared
// by both trend subtabs.
export function ServiceSettingsPopup({
  popup, groups, groupMembers, offDefault, excluded, hidden,
  onSetGroup, onRemoveFromGroup, onDefaultChange, onOtherChange, onToggleHide, onClose,
}) {
  const ref = useRef(null);
  const [newName, setNewName] = useState(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-service-name]')) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const { name } = popup;
  const isGroup = groupMembers.has(name);
  const current = groups.find(g => g.services.includes(name))?.name || '';
  const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', whiteSpace: 'nowrap' };
  const btn = { fontSize: '0.72rem', padding: '2px 8px', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, background: 'var(--color-surface, #fff)', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'inherit' };
  const label = { fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', ...muted };
  const taken = new Set(groups.map(g => g.name.trim().toLowerCase()));
  const trimmed = (newName || '').trim();
  const nameOk = trimmed && !taken.has(trimmed.toLowerCase());
  const addNew = () => { if (nameOk) { onSetGroup(name, trimmed); setNewName(null); } };
  const left = Math.max(8, Math.min(popup.left, window.innerWidth - 290));
  const top = popup.top + 300 > window.innerHeight ? Math.max(8, popup.top - 310) : popup.top;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${name} settings`}
      style={{ position: 'fixed', left, top, zIndex: 40, width: 270, background: 'var(--color-surface, #fff)', color: 'var(--color-text)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8, padding: '0.6rem 0.75rem', boxShadow: '0 6px 20px rgba(0,0,0,0.14)', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={name}>{name}{isGroup ? ' (group)' : ''}</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #64748B)', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {isGroup ? (
        <div>
          <div style={label}>Services in this group</div>
          {groupMembers.get(name).map(sv => (
            <div key={sv} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sv}>{sv}</span>
              <button type="button" style={btn} onClick={() => onRemoveFromGroup(sv)} title={`Take ${sv} out of ${name}`}>Remove</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={label}>Group</div>
          {newName == null ? (
            <select
              className={styles.filterInput}
              value={current}
              onChange={e => (e.target.value === '__new' ? setNewName('') : onSetGroup(name, e.target.value || null))}
              aria-label={`Group for ${name}`}
            >
              <option value="">No group (on its own)</option>
              {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              <option value="__new">+ New group...</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className={styles.filterInput}
                style={{ flex: 1, minWidth: 0 }}
                placeholder="Group name"
                value={newName}
                autoFocus
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNew(); }}
              />
              <button type="button" style={{ ...btn, opacity: nameOk ? 1 : 0.5 }} disabled={!nameOk} onClick={addNew}>Add</button>
              <button type="button" style={btn} onClick={() => setNewName(null)}>Cancel</button>
            </div>
          )}
          {newName != null && trimmed && !nameOk && <div style={{ color: '#b91c1c', fontSize: '0.7rem' }}>A group already has that name</div>}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--color-border, #E2E8F0)', paddingTop: 4 }}>
        <label style={row} title="Saved: the line starts switched on or off on every visit">
          <input type="checkbox" checked={!offDefault.has(name)} onChange={e => onDefaultChange(name, e.target.checked)} />
          Visible by default
        </label>
        <label style={row} title="Saved: never drawn as its own line; on % of 100 it counts in Other">
          <input type="checkbox" checked={excluded.includes(name)} onChange={e => onOtherChange(name, e.target.checked)} />
          Count in Other by default
        </label>
      </div>
      {onToggleHide && !isGroup && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" style={btn} onClick={() => onToggleHide(name)}>{hidden ? 'Unhide service' : 'Hide service'}</button>
          <span style={{ ...muted, fontSize: '0.68rem' }}>{hidden ? 'Back into the counts' : 'Out of every count'}</span>
        </div>
      )}
    </div>
  );
}

const fmtPct = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);
const fmtMoney = (v) => (v == null ? '-' : `$${Math.round(v).toLocaleString('en-US')}`);
// Short dollars for the y axis: $850, $12k, $1.2M.
const fmtMoneyAxis = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${+(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `$${v}`;
};
const fmtOf = (mode) => (mode === 'dealSize' ? fmtMoney : fmtPct);

// A period cell's numbers, the same in both modes: the % and what it's of.
// `scale` only matters for share: 'mix' is out of the period's service tags.
function cellOf(mode, trend, series, p, scale = 'opps') {
  if (mode === 'share') {
    const mix = scale === 'mix';
    const d = p == null ? (mix ? trend.tagTotal : trend.total) : (mix ? trend.tagTotals[p] : trend.totals[p]);
    const n = p == null ? series.count : series.byPeriod[p].count;
    const field = mix ? 'mix' : 'share';
    const v = p == null ? series[field] : series.byPeriod[p][field];
    return { v, n, d };
  }
  const c = p == null ? series : series.byPeriod[p];
  if (mode === 'dealSize') return { v: c.avg, n: c.sized, d: c.sized };
  return { v: c.rate, n: c.wins, d: c.decided };
}

function TrendTooltip({ active, payload, mode, scale, trend, lines, period, showOverall, showOther, colourOf }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload.period;
  const mix = mode === 'share' && scale === 'mix';
  const items = lines.map(s => ({ key: s.key, ...cellOf(mode, trend, s, p, scale) }))
    .filter(i => i.d > 0 && (mode === 'share' ? i.n > 0 : true))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  if (mix && showOther) {
    const o = payload[0].payload[OTHER_KEY];
    const n = trend.tagTotals[p] - lines.reduce((a, s) => a + s.byPeriod[p].count, 0);
    if (n > 0) items.push({ key: OTHER_KEY, label: 'Other', v: o, n, d: trend.tagTotals[p] });
  }
  const o = mode === 'share' ? null : cellOf(mode, trend, trend.overall[p], null);
  const fmt = fmtOf(mode);
  const countOf = (i) => (mode === 'dealSize' ? `${i.n} deal${i.n === 1 ? '' : 's'}` : `${i.n}/${i.d}`);
  return (
    <div style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6, padding: '0.5rem 0.65rem', fontSize: '0.75rem', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', minWidth: 230 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        {periodLabel(p, period)}
        {mode === 'share' && <span style={{ ...muted, fontWeight: 400 }}> · {trend.totals[p]} opp{trend.totals[p] === 1 ? '' : 's'} started{mix ? `, ${trend.tagTotals[p]} service${trend.tagTotals[p] === 1 ? '' : 's'}` : ''}</span>}
      </div>
      {o && showOverall && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', fontWeight: 700 }}>
          <span style={{ width: 10, height: 2, background: OVERALL_COLOUR }} />
          <span style={{ flex: 1 }}>Overall</span>
          <span>{fmt(o.v)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right', fontWeight: 400 }}>{countOf(o)}</span>
        </div>
      )}
      {items.length === 0 && <div style={muted}>Nothing for these services</div>}
      {items.map(i => (
        <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: colourOf(i.key) }} />
          <span style={{ flex: 1 }}>{i.label || i.key}</span>
          <span style={{ fontWeight: 600 }}>{fmt(i.v)}</span>
          <span style={{ ...muted, minWidth: 48, textAlign: 'right' }}>{countOf(i)}</span>
        </div>
      ))}
      <div style={{ ...muted, marginTop: 4 }}>{mix ? 'Service count / all services on the opps started' : mode === 'share' ? 'Opps with the service / opps started' : mode === 'dealSize' ? 'Average Quoted Amount, over the opps with one. Click for the breakdown' : 'Won / decided (Sold + Not Sold)'}</div>
    </div>
  );
}

/**
 * Opps > By Service > "% of total over time", "Close rate over time" and
 * "Avg deal size over time" ('dealSize': each service's average Quoted
 * Amount per start period).
 *
 * One component, two measures (see utils/serviceTrends.js): `mode` 'share'
 * is each service's share of the opps started per period, 'closeRate' is
 * each service's won / decided per close period. The chart draws the
 * services picked in the Services box, or the busiest eight when none are;
 * the table underneath lists every service.
 *
 * The service choices belong to the By Service tab, not to this subtab, so
 * they carry between the two trend subtabs: `picked` / `onPickedChange` is
 * the Chart box, `linesOff` the legend's lines switched off. Clicking a
 * legend entry opens a small popup: "Show on chart" (`onLineShownChange`,
 * this visit) and "Visible by default" (`linesOffDefault` /
 * `onLineDefaultChange`, saved in settings). Hidden services (`hiddenSet`, saved in settings) are left out unless
 * `showHidden`, and `onToggleHide` hides or unhides one from this table the
 * same as from the By service table.
 */
export function ServiceTrends({
  mode, records, settings, updateSettings,
  picked = [], onPickedChange, linesOff, onLineShownChange,
  linesOffDefault = new Set(), onLineDefaultChange,
  hiddenSet = new Set(), showHidden = false, onShowHiddenChange, onToggleHide,
  onOpenOpp,
}) {
  const cfg = MODES[mode] || MODES.share;
  const [period, setPeriod] = useState(cfg.defaultPeriod);
  const [scaleChoice, setScale] = useState('mix');
  const [dealSet, setDealSet] = useState('all');
  const [splitChoice, setSplit] = useState('full');
  const split = mode === 'dealSize' && splitChoice === 'split';
  // The deal size breakdown popup: { key, period } (period null = whole window).
  const [breakdown, setBreakdown] = useState(null);
  const hoverPeriod = useRef(null);
  const hasOverall = mode === 'closeRate' || mode === 'dealSize';
  const fmt = fmtOf(mode);
  const scale = mode === 'share' ? scaleChoice : 'opps';
  const isMix = mode === 'share' && scale === 'mix';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const hidden = linesOff || new Set();
  const hiddenServices = useMemo(() => (showHidden ? [] : [...hiddenSet]), [showHidden, hiddenSet]);

  // Service groups, saved and shared by both trend subtabs.
  const savedGroups = useMemo(() => groupsFromSettings(settings), [settings]);
  const grouping = savedGroups.on && savedGroups.groups.length > 0;
  const activeGroups = useMemo(() => (grouping ? savedGroups.groups : []), [grouping, savedGroups]);
  const groupMembers = useMemo(() => new Map(activeGroups.map(g => [g.name, g.services])), [activeGroups]);
  const [editingGroups, setEditingGroups] = useState(false);
  const allServices = useMemo(() => {
    const seen = new Set();
    for (const r of records || []) for (const sv of servicesOf(r)) seen.add(sv);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [records]);
  const saveGroups = (patch) => updateSettings?.({ [GROUPS_KEY]: { ...savedGroups, ...patch } });
  // Move a service into a group (or out of every group with null).
  const setServiceGroup = (service, groupName) => updateSettings?.({ [GROUPS_KEY]: withServiceGroup(savedGroups, service, groupName) });
  const [svcPopup, setSvcPopup] = useState(null);
  const openSvcPopup = (e, name) => {
    e.stopPropagation();
    if (svcPopup?.name === name) { setSvcPopup(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setSvcPopup({ name, left: r.left, top: r.bottom + 4 });
  };

  const trend = useMemo(() => {
    const opts = { period, from, to, hidden: hiddenServices, groups: activeGroups };
    if (mode === 'share') return serviceShareTrend(records, opts);
    if (mode === 'dealSize') return serviceDealSizeTrend(records, { ...opts, sold: dealSet === 'sold', split });
    return serviceCloseRateTrend(records, opts);
  }, [mode, records, period, from, to, hiddenServices, activeGroups, dealSet, split]);

  const allKeys = useMemo(() => trend.series.map(s => s.key), [trend]);
  const excluded = useMemo(() => excludedFromSettings(settings), [settings]);
  const setExcluded = (next) => updateSettings?.({ [EXCLUDED_KEY]: next });
  const lines = useMemo(() => {
    const off = new Set(excluded);
    const pool = trend.series.filter(s => !off.has(s.key));
    const keep = new Set(picked);
    const chosen = pool.filter(s => keep.has(s.key));
    return chosen.length ? chosen : pool.slice(0, MAX_LINES);
  }, [trend, picked, excluded]);
  const colourMap = useMemo(() => new Map(lines.map((s, i) => [s.key, lineColour(i)])), [lines]);
  const colourOf = (k) => (k === OVERALL_KEY ? OVERALL_COLOUR : k === OTHER_KEY ? OTHER_COLOUR : colourMap.get(k) || '#9ca3af');
  const visible = lines.filter(s => !hidden.has(s.key));
  const showOverall = hasOverall && !hidden.has(OVERALL_KEY);
  // The services left out of the chart, so the % of 100 stack still adds up.
  const hasOther = isMix && trend.series.length > lines.length;
  const showOther = hasOther && !hidden.has(OTHER_KEY);

  const chartData = useMemo(() => trend.periods.map(p => {
    const row = { period: p, label: periodLabel(p, period) };
    for (const s of lines) row[s.key] = cellOf(mode, trend, s, p, scale).v;
    if (hasOverall) row[OVERALL_KEY] = cellOf(mode, trend, trend.overall[p], null).v;
    if (isMix) {
      const d = trend.tagTotals[p];
      const drawn = lines.reduce((a, s) => a + s.byPeriod[p].count, 0);
      row[OTHER_KEY] = d > 0 ? ((d - drawn) / d) * 100 : null;
    }
    return row;
  }), [trend, lines, period, mode, scale, isMix, hasOverall]);

  // The legend popup: which entry it's open for, and where under it.
  const [linePopup, setLinePopup] = useState(null);
  const legendRef = useRef(null);
  const popupRef = useRef(null);
  useEffect(() => {
    if (!linePopup) return undefined;
    const onDown = (e) => {
      if (popupRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-legend-key]')) return;
      setLinePopup(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setLinePopup(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [linePopup]);
  const openLinePopup = (e, key) => {
    if (linePopup?.key === key) { setLinePopup(null); return; }
    const box = legendRef.current?.getBoundingClientRect();
    const btn = e.currentTarget.getBoundingClientRect();
    setLinePopup({ key, left: btn.left - (box?.left || 0), top: btn.bottom - (box?.top || 0) + 4 });
  };

  // ---- table: every service, then the total row ------------------------
  const tableRows = useMemo(() => {
    const rows = trend.series.map(s => ({ id: s.key, name: s.key, kind: 'series', s, _hidden: hiddenSet.has(s.key) }));
    if (mode === 'closeRate') {
      rows.push({ id: OVERALL_KEY, name: 'Overall', kind: 'total', s: { wins: trend.wins, decided: trend.decided, rate: trend.rate, byPeriod: trend.overall } });
    } else if (mode === 'dealSize') {
      rows.push({ id: OVERALL_KEY, name: 'Overall', kind: 'total', s: { sized: trend.sized, sum: trend.sum, avg: trend.avg, opps: trend.opps, byPeriod: trend.overall } });
    } else {
      if (isMix) rows.push({ id: TAGS_KEY, name: 'Services on those opps', kind: 'total' });
      rows.push({ id: OVERALL_KEY, name: 'Opps started', kind: 'total' });
    }
    return rows;
  }, [trend, mode, hiddenSet, isMix]);

  const columns = useMemo(() => {
    const cell = (row, p) => {
      if (mode === 'share' && row.kind === 'total') {
        if (row.id === TAGS_KEY) {
          const n = p == null ? trend.tagTotal : trend.tagTotals[p];
          return { text: String(n), sort: n, title: `${n} services across the opps started` };
        }
        const n = p == null ? trend.total : trend.totals[p];
        return { text: String(n), sort: n, title: `${n} opps started` };
      }
      const c = cellOf(mode, trend, row.s, p, scale);
      if (!c.d || (mode === 'closeRate' && c.d === 0)) return { text: '-', sort: -1, title: '' };
      if (mode === 'dealSize') {
        const total = p == null ? row.s.sum : row.s.byPeriod[p].sum;
        return {
          text: `${fmtMoney(c.v)} (${c.n})`, pct: fmtMoney(c.v), count: String(c.n), sort: c.v ?? -1,
          title: `Average of ${c.n} Quoted Amount${c.n === 1 ? '' : 's'}, ${fmtMoney(total)} in all`,
        };
      }
      return {
        text: `${fmtPct(c.v)} (${c.n}/${c.d})`, pct: fmtPct(c.v), count: `${c.n}/${c.d}`, sort: c.v ?? -1,
        title: isMix ? `${c.n} of ${c.d} services on the opps started` : mode === 'share' ? `${c.n} of ${c.d} opps started` : `${c.n} won of ${c.d} decided`,
      };
    };
    const render = (row, p) => {
      const c = cell(row, p);
      const bold = row.kind === 'total' || p == null;
      if (c.pct == null) return <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, ...(c.text === '-' ? muted : null) }} title={c.title}>{c.text}</div>;
      if (mode === 'dealSize') {
        return (
          <div style={{ textAlign: 'right' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setBreakdown({ key: row.kind === 'total' ? OVERALL_KEY : row.name, period: p }); }}
              title={`${c.title}. Click to see the opps behind it.`}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-link, #2563EB)', fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
            >
              {c.pct} <span style={{ ...muted, fontWeight: 400 }}>({c.count})</span>
            </button>
          </div>
        );
      }
      return (
        <div style={{ textAlign: 'right', fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }} title={c.title}>
          {c.pct} <span style={{ ...muted, fontWeight: 400 }}>({c.count})</span>
        </div>
      );
    };
    const cols = [{
      key: 'name',
      label: 'Service (Scope)',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: row.kind === 'total' ? 700 : 400 }}>
          {(colourMap.has(row.name) || (row.kind === 'total' && hasOverall)) && (
            <span style={{ width: 10, height: row.kind === 'total' ? 3 : 10, borderRadius: 2, background: colourOf(row.kind === 'total' ? OVERALL_KEY : row.name), flexShrink: 0 }} />
          )}
          {row.kind === 'series' ? (
            <button
              type="button"
              data-service-name={row.name}
              onClick={(e) => openSvcPopup(e, row.name)}
              title="Group, visible by default, count in Other"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
            >{row.name}</button>
          ) : row.name}
          {excluded.includes(row.name) && <span style={{ ...muted, fontSize: '0.72rem' }} title="Counts in Other by default">(Other)</span>}
          {linesOffDefault.has(row.name) && <span style={{ ...muted, fontSize: '0.72rem' }} title="Off by default">(off)</span>}
          {groupMembers.has(row.name) && (
            <span style={{ ...muted, fontSize: '0.72rem' }} title={groupMembers.get(row.name).join(', ')}>
              (group of {groupMembers.get(row.name).length})
            </span>
          )}
        </span>
      ),
    }];
    for (const p of trend.periods) {
      cols.push({
        key: `p:${p}`,
        label: periodLabel(p, period),
        defaultWidth: 150,
        render: (row) => render(row, p),
        getFilterValue: (row) => cell(row, p).text,
        exportValue: (row) => cell(row, p).text,
        getSortValue: (row) => cell(row, p).sort,
      });
    }
    cols.push({
      key: 'total',
      label: 'Whole window',
      defaultWidth: 150,
      render: (row) => render(row, null),
      getFilterValue: (row) => cell(row, null).text,
      exportValue: (row) => cell(row, null).text,
      getSortValue: (row) => cell(row, null).sort,
    });
    if (onToggleHide) {
      cols.push({
        key: '_actions',
        label: '',
        defaultWidth: 90,
        exportValue: () => '',
        render: (row) => (row.kind !== 'series' || groupMembers.has(row.name) ? null : (
          <button
            className={styles.hideServiceBtn}
            onClick={(e) => { e.stopPropagation(); onToggleHide(row.name); }}
            title={row._hidden ? 'Unhide service (on every By Service subtab)' : 'Hide service (on every By Service subtab, saved for next time)'}
          >{row._hidden ? 'Unhide' : 'Hide'}</button>
        )),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, period, mode, scale, isMix, hasOverall, colourMap, onToggleHide, groupMembers, excluded, linesOffDefault, svcPopup]);

  // "See an example": the busiest service cell with an opp that carries
  // other services too, so the popup shows the Full / Split difference.
  const exampleCell = useMemo(() => {
    if (mode !== 'dealSize') return null;
    let best = null;
    for (const sr of trend.series) {
      for (const p of trend.periods) {
        const c = sr.byPeriod[p];
        if (!c.sized) continue;
        const multi = c.opps.filter(o => servicesOf(o.r).length > 1).length;
        const score = (multi ? 1000 : 0) + Math.min(c.sized, 12) * 10 + multi;
        if (!best || score > best.score) best = { key: sr.key, period: p, score };
      }
    }
    return best;
  }, [mode, trend]);

  const legend = [
    ...(mode === 'closeRate' ? [{ key: OVERALL_KEY, label: 'Overall', v: trend.rate }] : []),
    ...(mode === 'dealSize' ? [{ key: OVERALL_KEY, label: 'Overall', v: trend.avg }] : []),
    ...lines.map(s => ({ key: s.key, label: s.key, v: cellOf(mode, trend, s, null, scale).v })),
    ...(hasOther ? [{
      key: OTHER_KEY,
      label: 'Other',
      v: trend.tagTotal ? ((trend.tagTotal - lines.reduce((a, s) => a + s.count, 0)) / trend.tagTotal) * 100 : null,
    }] : []),
  ];
  const summary = mode === 'share'
    ? `${trend.total} opp${trend.total === 1 ? '' : 's'} started${trend.undated ? ` · ${trend.undated} without a Start Date left out` : ''}`
    : mode === 'dealSize'
    ? `${trend.sized} ${dealSet === 'sold' ? 'Sold ' : ''}opp${trend.sized === 1 ? '' : 's'} with a Quoted Amount${trend.sized ? ` · ${fmtMoney(trend.avg)} average` : ''}${trend.unsized ? ` · ${trend.unsized} without one left out` : ''}${trend.undated ? ` · ${trend.undated} without a Start Date left out` : ''}`
    : `${trend.wins} won of ${trend.decided} decided${trend.decided ? ` · ${fmtPct(trend.rate)} close rate` : ''}${trend.undated ? ` · ${trend.undated} without a Close Date left out` : ''}`;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 1.25rem 1.25rem' }}>
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        <span className={styles.notSoldYears}>
          <span className={styles.filterLabel} style={{ marginRight: 2 }}>Period</span>
          {PERIODS.map(o => (
            <button
              key={o.key}
              type="button"
              className={period === o.key ? styles.notSoldYearOn : styles.notSoldYear}
              onClick={() => setPeriod(o.key)}
            >{o.label}</button>
          ))}
        </span>
        {mode === 'share' && (
          <span className={styles.notSoldYears}>
            <span className={styles.filterLabel} style={{ marginRight: 2 }}>Scale</span>
            {SCALES.map(o => (
              <button
                key={o.key}
                type="button"
                title={o.title}
                className={scale === o.key ? styles.notSoldYearOn : styles.notSoldYear}
                onClick={() => setScale(o.key)}
              >{o.label}</button>
            ))}
          </span>
        )}
        {mode === 'dealSize' && (
          <span className={styles.notSoldYears}>
            <span className={styles.filterLabel} style={{ marginRight: 2 }}>Deals</span>
            {DEAL_SETS.map(o => (
              <button
                key={o.key}
                type="button"
                title={o.title}
                className={dealSet === o.key ? styles.notSoldYearOn : styles.notSoldYear}
                onClick={() => setDealSet(o.key)}
              >{o.label}</button>
            ))}
          </span>
        )}
        {mode === 'dealSize' && (
          <span className={styles.notSoldYears}>
            <span className={styles.filterLabel} style={{ marginRight: 2 }} title="How an opp with several services on its Scope is credited">Multi-service</span>
            {SPLITS.map(o => (
              <button
                key={o.key}
                type="button"
                title={o.title}
                className={splitChoice === o.key ? styles.notSoldYearOn : styles.notSoldYear}
                onClick={() => setSplit(o.key)}
              >{o.label}</button>
            ))}
          </span>
        )}
        <label className={styles.filterLabel}>
          {cfg.dateLabel} from
          <input type="date" className={styles.filterInput} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className={styles.filterLabel}>
          to
          <input type="date" className={styles.filterInput} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 260, maxWidth: 460, flex: '1 1 260px' }}>
          <span className={styles.filterLabel}>Chart</span>
          <div style={{ flex: 1 }} title={`Tick Show to draw a service, Hide to keep it off; none shown draws the ${MAX_LINES} busiest`}>
            <ServicePicker
              options={allKeys}
              picked={picked}
              excluded={excluded}
              onPickedChange={(next) => onPickedChange?.(next)}
              onExcludedChange={setExcluded}
              noun={grouping ? 'lines' : 'services'}
            />
          </div>
        </div>
        <span className={styles.notSoldYears}>
          <span className={styles.filterLabel} style={{ marginRight: 2 }}>Group</span>
          <button
            type="button"
            className={!grouping ? styles.notSoldYearOn : styles.notSoldYear}
            onClick={() => saveGroups({ on: false })}
            title="Each service on its own"
          >Off</button>
          <button
            type="button"
            className={grouping ? styles.notSoldYearOn : styles.notSoldYear}
            onClick={() => (savedGroups.groups.length ? saveGroups({ on: true }) : setEditingGroups(true))}
            title={savedGroups.groups.length ? 'Draw each service group as one line' : 'Set up service groups'}
          >Groups{savedGroups.groups.length ? ` (${savedGroups.groups.length})` : ''}</button>
          <button
            type="button"
            className={styles.notSoldYear}
            onClick={() => setEditingGroups(v => !v)}
            title="Add, rename or change the service groups"
          >Edit</button>
        </span>
        {(picked.length > 0 || from || to) && (
          <button className={styles.clearFiltersBtn} onClick={() => { onPickedChange?.([]); setFrom(''); setTo(''); }}>Clear</button>
        )}
        {hiddenSet.size > 0 && (
          <label className={styles.showHiddenLabel}>
            <input type="checkbox" checked={showHidden} onChange={e => onShowHiddenChange?.(e.target.checked)} />
            Show {hiddenSet.size} hidden
          </label>
        )}
        <span className={styles.resultCount}>{summary}</span>
      </div>
      {svcPopup && trend.series.some(s => s.key === svcPopup.name) && (
        <ServiceSettingsPopup
          popup={svcPopup}
          groups={savedGroups.groups}
          groupMembers={groupMembers}
          offDefault={linesOffDefault}
          excluded={excluded}
          hidden={hiddenSet.has(svcPopup.name)}
          onSetGroup={setServiceGroup}
          onRemoveFromGroup={(sv) => setServiceGroup(sv, null)}
          onDefaultChange={(k, shown) => onLineDefaultChange?.(k, shown)}
          onOtherChange={(k, on) => setExcluded(withExcluded(excluded, k, on))}
          onToggleHide={onToggleHide}
          onClose={() => setSvcPopup(null)}
        />
      )}
      {editingGroups && (
        <GroupEditor
          groups={savedGroups.groups}
          services={allServices}
          settings={settings}
          onClose={() => setEditingGroups(false)}
          onSave={(groups) => { saveGroups({ groups, on: groups.length > 0 }); setEditingGroups(false); }}
        />
      )}
      <div style={{ fontSize: '0.72rem', ...muted }}>
        {grouping && `Grouped: ${activeGroups.map(g => g.name).join(', ')}. `}
        {isMix ? MIX_BLURB : mode === 'dealSize' && dealSet === 'sold' ? cfg.soldBlurb : cfg.blurb}
        {mode === 'dealSize' && <> {SPLIT_BLURB[splitChoice]} Click any amount in the table, or a point on the chart, to see the opps behind it.</>}
        {exampleCell && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => setBreakdown({ key: exampleCell.key, period: exampleCell.period })}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-link, #2563EB)', fontWeight: 600, textDecoration: 'underline' }}
            >See an example: {exampleCell.key}, {periodLabel(exampleCell.period, period)}</button>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {trend.periods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', ...muted }}>{cfg.empty}</div>
        ) : (
          <>
            <div ref={legendRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.85rem', fontSize: '0.74rem' }}>
              {legend.map(l => (
                <button
                  key={l.key}
                  type="button"
                  data-legend-key={l.key}
                  onClick={(e) => openLinePopup(e, l.key)}
                  title={`${l.label}: show or hide, and set whether it's visible by default`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--color-text)', fontWeight: l.key === OVERALL_KEY ? 700 : 400, opacity: hidden.has(l.key) ? 0.4 : 1, textDecoration: hidden.has(l.key) ? 'line-through' : 'none' }}
                >
                  <span style={{ width: 12, height: l.key === OVERALL_KEY ? 3 : 10, borderRadius: l.key === OVERALL_KEY ? 0 : 999, background: colourOf(l.key) }} />
                  {l.label} <span style={muted}>({fmt(l.v)})</span>
                  {linesOffDefault.has(l.key) && <span style={{ ...muted, fontSize: '0.66rem' }} title="Hidden by default">(off by default)</span>}
                </button>
              ))}
              {linePopup && legend.some(l => l.key === linePopup.key) && (() => {
                const l = legend.find(x => x.key === linePopup.key);
                const shown = !hidden.has(l.key);
                const byDefault = !linesOffDefault.has(l.key);
                const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', whiteSpace: 'nowrap' };
                return (
                  <div
                    ref={popupRef}
                    role="dialog"
                    aria-label={`${l.label} line`}
                    style={{ position: 'absolute', left: linePopup.left, top: linePopup.top, zIndex: 20, background: 'var(--color-surface, #fff)', color: 'var(--color-text)', border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8, padding: '0.55rem 0.75rem', boxShadow: '0 6px 20px rgba(0,0,0,0.14)', fontSize: '0.78rem', minWidth: 210 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                      <span style={{ width: 12, height: l.key === OVERALL_KEY ? 3 : 10, borderRadius: l.key === OVERALL_KEY ? 0 : 999, background: colourOf(l.key) }} />
                      <span style={{ flex: 1 }}>{l.label}</span>
                      <button type="button" onClick={() => setLinePopup(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, #64748B)', fontSize: '0.9rem', lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                    <label style={row} title="Switch the line on or off for this visit">
                      <input type="checkbox" checked={shown} onChange={e => onLineShownChange?.(l.key, e.target.checked)} />
                      Show on chart now
                    </label>
                    <label style={row} title="Saved: the line starts this way on every visit and on both trend subtabs">
                      <input type="checkbox" checked={byDefault} onChange={e => onLineDefaultChange?.(l.key, e.target.checked)} />
                      Visible by default
                    </label>
                  </div>
                );
              })()}
            </div>
            <div style={{ height: 300, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                {isMix ? (
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDataOverflow tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      content={<TrendTooltip mode={mode} scale={scale} trend={trend} lines={visible} period={period} showOther={showOther} colourOf={colourOf} />}
                      cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
                    />
                    {visible.map(s => (
                      <Area
                        key={s.key}
                        type="linear"
                        dataKey={s.key}
                        name={s.key}
                        stackId="mix"
                        stroke={colourOf(s.key)}
                        strokeWidth={1}
                        fill={colourOf(s.key)}
                        fillOpacity={0.85}
                        isAnimationActive={false}
                      />
                    ))}
                    {showOther && (
                      <Area type="linear" dataKey={OTHER_KEY} name="Other" stackId="mix" stroke={OTHER_COLOUR} strokeWidth={1} fill={OTHER_COLOUR} fillOpacity={0.85} isAnimationActive={false} />
                    )}
                  </AreaChart>
                ) : (
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  // Recharts 3 reports the hovered index (sometimes as a
                  // string); the last hovered period covers a click that
                  // lands before the tooltip has caught up.
                  onMouseMove={mode === 'dealSize' ? (st) => {
                    const idx = st?.activeTooltipIndex ?? st?.activeIndex;
                    if (idx != null && idx !== '') hoverPeriod.current = chartData[Number(idx)]?.period ?? null;
                  } : undefined}
                  onClick={mode === 'dealSize' ? (st) => {
                    const idx = st?.activeTooltipIndex ?? st?.activeIndex;
                    const pp = (idx != null && idx !== '' ? chartData[Number(idx)]?.period : null) ?? hoverPeriod.current;
                    if (pp) setBreakdown({ key: OVERALL_KEY, period: pp });
                  } : undefined}
                  style={mode === 'dealSize' ? { cursor: 'pointer', outline: 'none' } : undefined}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={mode === 'dealSize' ? 56 : 44} domain={mode === 'closeRate' ? [0, 100] : [0, 'auto']} tickFormatter={mode === 'dealSize' ? fmtMoneyAxis : (v) => `${v}%`} />
                  <Tooltip
                    content={<TrendTooltip mode={mode} scale={scale} trend={trend} lines={visible} period={period} showOverall={showOverall} colourOf={colourOf} />}
                    cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
                  />
                  {visible.map(s => (
                    <Line
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      stroke={colourOf(s.key)}
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 0, fill: colourOf(s.key) }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                  {showOverall && (
                    <Line dataKey={OVERALL_KEY} name="Overall" stroke={OVERALL_COLOUR} strokeWidth={3} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
                  )}
                </LineChart>
                )}
              </ResponsiveContainer>
            </div>

            <div style={{ height: Math.min(140 + tableRows.length * 36, 640), flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <DataTable
                tableId={`${cfg.tableId}-${period}`}
                columns={columns}
                rows={tableRows}
                alwaysVisible={['name']}
                rowStyle={(row) => (row._hidden ? { opacity: 0.5 } : undefined)}
                rowGroup={(row) => (row.kind === 'total' ? 1 : 0)}
                exportFileName={`${cfg.exportName}${mode === 'dealSize' && dealSet === 'sold' ? ' (Sold)' : ''}${split ? ' (split)' : ''} by ${period}`}
                emptyMessage={cfg.empty}
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          </>
        )}
      </div>
      {mode === 'dealSize' && breakdown && (
        <DealBreakdown
          trend={trend}
          pick={breakdown}
          period={period}
          split={split}
          sold={dealSet === 'sold'}
          colourOf={colourOf}
          onPick={setBreakdown}
          onClose={() => setBreakdown(null)}
          onOpenOpp={onOpenOpp ? (id) => { setBreakdown(null); onOpenOpp(id); } : undefined}
          settings={settings}
          updateSettings={updateSettings}
        />
      )}
    </div>
  );
}
