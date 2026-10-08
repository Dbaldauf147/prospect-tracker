// My Accounts > "DM Tags History" subtab: how much of each tier has a
// decision maker carrying each STARRED tag, day by day. The tags are the
// ones starred in the DM Tags table's Columns menu, so starring a column
// there adds it here. The days come from utils/dmTagHistory.js, recorded
// while My Accounts is open.
import { useMemo, useSyncExternalStore } from 'react';
import { DataTable } from '../common/DataTable';
import { TIERS } from '../../data/enums';
import { readRemoteTablePrefs, tablePrefsKeys, loadColStarred, loadColNames } from '../../utils/tablePrefsSync';
import {
  subscribeDmTagHistory, dmTagHistorySnapshot, parseDmTagHistory,
  dmTagSeries, starredTagKeys, pctOf,
} from '../../utils/dmTagHistory';

const DM_TAGS_TABLE = 'my-accounts-dm-tags';
// The tier colours the DM Tags header already uses.
const TIER_INK = { 'Tier 1': '#DC2626', 'Tier 2': '#3B82F6', 'Tier 3': '#F59E0B' };

const fmtDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// One tag's three tier lines, 0-100%. Every recorded day is a point; a day
// recorded before the tag existed is a gap. Hovering a day names all three.
function TierLines({ series }) {
  const W = 560; const H = 150;
  const PAD = { l: 38, r: 54, t: 8, b: 22 };
  const n = series.length;
  const x = (i) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (pct) => PAD.t + (1 - pct / 100) * (H - PAD.t - PAD.b);
  const band = n <= 1 ? (W - PAD.l - PAD.r) : (W - PAD.l - PAD.r) / (n - 1);
  const ticks = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  // Where each tier's end label sits: at its line's last point, pushed
  // apart so two tiers on the same value don't print on top of each other.
  const labelY = {};
  const ends = TIERS.map((tier, ti) => {
    const s = [...series].reverse().find(d => d.byTier[ti].pct != null);
    return s ? { tier, y: y(s.byTier[ti].pct) } : null;
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  const GAP = 13;
  ends.forEach((e, i) => { labelY[e.tier] = i === 0 ? e.y : Math.max(e.y, labelY[ends[i - 1].tier] + GAP); });
  // Keep the bottom label above the axis by lifting the stack if needed.
  const bottom = ends.length ? labelY[ends[ends.length - 1].tier] : 0;
  const over = bottom - (H - PAD.b);
  if (over > 0) ends.forEach(e => { labelY[e.tier] -= over; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block', maxWidth: W }}>
      {[0, 50, 100].map(g => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="#E2E8F0" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(g) + 3} textAnchor="end" fontSize="12" fill="#94A3B8">{g}%</text>
        </g>
      ))}
      {[...new Set(ticks)].map(i => (
        <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="12" fill="#94A3B8">{fmtDay(series[i].day)}</text>
      ))}
      {TIERS.map((tier, ti) => {
        const pts = series.map((s, i) => ({ i, pct: s.byTier[ti].pct })).filter(p => p.pct != null);
        if (!pts.length) return null;
        // Break the line where a day has no reading for this tier.
        const segs = [];
        let cur = [];
        series.forEach((s, i) => {
          const pct = s.byTier[ti].pct;
          if (pct == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i)},${y(pct)}`);
        });
        if (cur.length) segs.push(cur);
        const last = pts[pts.length - 1];
        return (
          <g key={tier}>
            {segs.map((seg, k) => (seg.length > 1
              ? <polyline key={k} points={seg.join(' ')} fill="none" stroke={TIER_INK[tier]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              : null))}
            {pts.map(p => <circle key={p.i} cx={x(p.i)} cy={y(p.pct)} r={n > 40 ? 0 : 3} fill={TIER_INK[tier]} stroke="#fff" strokeWidth="1.5" />)}
            {/* Direct label at the line's end, in text ink, so identity is
                never colour alone. */}
            <circle cx={x(last.i)} cy={y(last.pct)} r="4" fill={TIER_INK[tier]} stroke="#fff" strokeWidth="2" />
            <text x={x(last.i) + 8} y={(labelY[tier] ?? y(last.pct)) + 3} fontSize="12" fontWeight="600" fill="#334155">
              {`T${tier.slice(-1)} ${last.pct}%`}
            </text>
          </g>
        );
      })}
      {series.map((s, i) => (
        <rect key={s.day} x={x(i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent">
          <title>
            {`${fmtDay(s.day)}\n` + s.byTier.map(b => (b.pct == null
              ? `${b.tier}: -`
              : `${b.tier}: ${b.pct}% (${b.mapped} of ${b.total})`)).join('\n')}
          </title>
        </rect>
      ))}
    </svg>
  );
}

// Where a tier stands now, and how far it has moved since the first day.
function TierNow({ series }) {
  const last = series[series.length - 1];
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {TIERS.map((tier, ti) => {
        const now = last?.byTier[ti];
        // Since the tier's first reading, which for a tag added later is
        // the day it first appeared, not the first day on record.
        const was = series.find(d => d.byTier[ti].pct != null)?.byTier[ti];
        const delta = now?.pct != null && was?.pct != null ? now.pct - was.pct : null;
        return (
          <div key={tier} style={{ fontSize: '0.72rem', color: '#475569' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TIER_INK[tier], marginRight: 5 }} />
            <span style={{ fontWeight: 600 }}>{tier}</span>{' '}
            <span style={{ fontWeight: 700, color: '#1E293B', fontVariantNumeric: 'tabular-nums' }}>{now?.pct == null ? '-' : `${now.pct}%`}</span>
            {now?.total ? <span style={{ color: '#94A3B8' }}>{` (${now.mapped}/${now.total})`}</span> : null}
            {delta != null && delta !== 0 && (
              <span style={{ marginLeft: 4, fontWeight: 600, color: delta > 0 ? '#047857' : '#B91C1C' }}>
                {`${delta > 0 ? '+' : ''}${delta} pts`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TagCard({ title, subtitle, series }) {
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.6rem 0.75rem', background: '#fff', minWidth: 0 }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginBottom: 4 }}>{subtitle}</div>}
      <TierNow series={series} />
      <div style={{ marginTop: 6 }}><TierLines series={series} /></div>
    </div>
  );
}

export function DmTagHistoryView({ settings, updateSettings }) {
  const raw = useSyncExternalStore(subscribeDmTagHistory, dmTagHistorySnapshot);
  const history = useMemo(() => parseDmTagHistory(raw), [raw]);
  const days = useMemo(() => Object.keys(history).sort(), [history]);

  // The DM Tags table's stars and renames, wherever that table keeps them:
  // the synced settings once there are any, else this browser's copy.
  const remote = readRemoteTablePrefs(settings, DM_TAGS_TABLE);
  const keys = tablePrefsKeys(DM_TAGS_TABLE);
  const starred = Array.isArray(remote?.starred) ? remote.starred : [...loadColStarred(keys)];
  const names = remote?.names || loadColNames(keys) || {};
  const tagKeys = starredTagKeys(starred);

  // A tag's label: the rename on the DM Tags table, else the newest
  // spelling recorded for it.
  const labelOf = (key) => {
    if (names?.[key]) return names[key];
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const l = history[days[i]]?.tags?.[key]?.label;
      if (l) return l;
    }
    return key.replace(/^tag:/, '');
  };

  const cards = [
    { key: 'dm', title: 'Any decision maker', subtitle: 'Accounts with at least one contact tagged Decision Maker, whatever else they carry' },
    ...tagKeys.map(k => ({ key: k, title: labelOf(k), subtitle: 'Decision makers also tagged this' })),
  ];

  // Built each render: a handful of columns, and the stars and names they
  // follow live in settings.
  const columns = [
    { key: 'day', label: 'Date', defaultWidth: 100, sticky: true, render: r => fmtDay(r.day), getSortValue: r => Number(r.day.replace(/-/g, '')), exportValue: r => r.day },
    ...cards.map(c => {
      const text = (r) => {
        const pairs = c.key === 'dm' ? r.row.dm : r.row.tags?.[c.key]?.t;
        if (!Array.isArray(pairs)) return '';
        return TIERS.map((t, i) => `T${t.slice(-1)} ${pctOf(pairs[i]) ?? '-'}${pctOf(pairs[i]) == null ? '' : '%'}`).join(' · ');
      };
      return {
        key: c.key, label: c.title, defaultWidth: 210,
        render: r => text(r) || <span style={{ color: '#CBD5E1' }}>-</span>,
        exportValue: text, getFilterValue: text,
      };
    }),
  ];
  const tableRows = useMemo(() => days.map(day => ({ id: day, day, row: history[day] })), [days, history]);

  if (days.length === 0) {
    return (
      <div style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748B', maxWidth: 640 }}>
        Nothing recorded yet. A reading is taken each day while My Accounts is open, once HubSpot contacts have loaded,
        so the first point lands today. Star tag columns on the DM Tags subtab to choose which ones are charted here.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.25rem 0.25rem 1rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.6rem' }}>
        {`${days.length} day${days.length === 1 ? '' : 's'} recorded since ${fmtDay(days[0])}. `}
        Each is the share of Tier 1, 2 and 3 accounts on My Accounts (inactive ones left out) with at least one such contact,
        as it stood at the end of that day. The tags are the columns starred on the DM Tags subtab.
        {tagKeys.length === 0 && ' No tag columns are starred yet, so only the decision-maker baseline shows: star some on DM Tags.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: '0.75rem' }}>
        {cards.map(c => <TagCard key={c.key} title={c.title} subtitle={c.subtitle} series={dmTagSeries(history, c.key)} />)}
      </div>
      <div style={{ marginTop: '1rem', height: Math.min(420, 90 + tableRows.length * 32), display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-dm-tags-history"
          exportFileName="DM Tags History"
          columns={columns}
          rows={tableRows}
          defaultSort={{ key: 'day', direction: 'desc' }}
          alwaysVisible={['day']}
          gridLines
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
