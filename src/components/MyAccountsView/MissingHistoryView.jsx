// My Accounts > "All Missing History" subtab: the sum of every missing value
// on the Company Data subtab, day by day, with each field's share of it in
// the table underneath. The days come from utils/missingHistory.js,
// recorded while My Accounts is open.
import { useMemo, useSyncExternalStore } from 'react';
import { DataTable } from '../common/DataTable';
import { COMPANY_DATA_FIELDS } from '../../utils/companyDataFields';
import { subscribeMissingHistory, missingHistorySnapshot, parseMissingHistory } from '../../utils/missingHistory';

const INK = '#DC2626';

const fmtDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function TotalLine({ series }) {
  const W = 760; const H = 200;
  const PAD = { l: 48, r: 60, t: 12, b: 24 };
  const n = series.length;
  const max = Math.max(1, ...series.map(s => s.total));
  // A round ceiling so the gridlines land on readable numbers.
  const step = 10 ** Math.max(0, Math.floor(Math.log10(max)) - (max / 10 ** Math.floor(Math.log10(max)) < 3 ? 1 : 0));
  const top = Math.ceil(max / step) * step;
  const x = (i) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const band = n <= 1 ? (W - PAD.l - PAD.r) : (W - PAD.l - PAD.r) / (n - 1);
  const ticks = [...new Set(n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1])];
  const last = series[n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Total missing values by day" style={{ display: 'block', maxWidth: W }}>
      {[0, top / 2, top].map(g => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="#E2E8F0" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(g) + 3} textAnchor="end" fontSize="12" fill="#94A3B8">{Math.round(g).toLocaleString()}</text>
        </g>
      ))}
      {ticks.map(i => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" fill="#94A3B8">{fmtDay(series[i].day)}</text>
      ))}
      {n > 1 && (
        <polyline
          points={series.map((s, i) => `${x(i)},${y(s.total)}`).join(' ')}
          fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        />
      )}
      {n <= 40 && series.map((s, i) => <circle key={s.day} cx={x(i)} cy={y(s.total)} r="3" fill={INK} stroke="#fff" strokeWidth="1.5" />)}
      <circle cx={x(n - 1)} cy={y(last.total)} r="4" fill={INK} stroke="#fff" strokeWidth="2" />
      <text x={x(n - 1) + 8} y={y(last.total) + 4} fontSize="12" fontWeight="600" fill="#334155">{last.total.toLocaleString()}</text>
      {series.map((s, i) => (
        <rect key={s.day} x={x(i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent">
          <title>{`${fmtDay(s.day)}: ${s.total.toLocaleString()} missing across ${s.companies} companies`}</title>
        </rect>
      ))}
    </svg>
  );
}

export function MissingHistoryView({ settings, updateSettings }) {
  const raw = useSyncExternalStore(subscribeMissingHistory, missingHistorySnapshot);
  const history = useMemo(() => parseMissingHistory(raw), [raw]);
  const series = useMemo(
    () => Object.keys(history).sort().map(day => ({ day, ...history[day], total: Number(history[day]?.total) || 0 })),
    [history],
  );

  const rows = useMemo(() => series.map((s, i) => ({
    id: s.day,
    ...s,
    change: i === 0 ? null : s.total - series[i - 1].total,
  })), [series]);

  const columns = [
    { key: 'day', label: 'Date', defaultWidth: 100, sticky: true, render: r => fmtDay(r.day), getSortValue: r => Number(r.day.replace(/-/g, '')), exportValue: r => r.day },
    { key: 'total', label: 'All Missing', defaultWidth: 110, render: r => <span style={{ fontWeight: 700 }}>{r.total.toLocaleString()}</span> },
    {
      key: 'change', label: 'Change', defaultWidth: 90,
      getSortValue: r => r.change ?? 0,
      exportValue: r => (r.change == null ? '' : r.change),
      render: r => (r.change == null || r.change === 0
        ? <span style={{ color: '#94A3B8' }}>-</span>
        // Fewer missing is progress, so a drop reads green.
        : <span style={{ fontWeight: 600, color: r.change < 0 ? '#047857' : '#B91C1C' }}>{`${r.change > 0 ? '+' : ''}${r.change}`}</span>),
    },
    { key: 'companies', label: 'Companies', defaultWidth: 100 },
    ...COMPANY_DATA_FIELDS.map(f => ({
      key: f.key, label: f.label, defaultWidth: 120,
      getSortValue: r => r.fields?.[f.key] ?? -1,
      exportValue: r => r.fields?.[f.key] ?? '',
      getFilterValue: r => String(r.fields?.[f.key] ?? ''),
      render: r => (r.fields?.[f.key] == null ? <span style={{ color: '#CBD5E1' }}>-</span> : r.fields[f.key].toLocaleString()),
    })),
  ];

  if (series.length === 0) {
    return (
      <div style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748B', maxWidth: 640 }}>
        Nothing recorded yet. A reading is taken each day while My Accounts is open, once the accounts have loaded.
        The first reading is also logged as yesterday, so the chart starts with two points.
      </div>
    );
  }

  const last = series[series.length - 1];
  const first = series[0];
  const delta = last.total - first.total;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.25rem 0.25rem 1rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.6rem' }}>
        {`${series.length} day${series.length === 1 ? '' : 's'} recorded since ${fmtDay(first.day)}. `}
        Each day is the sum of every missing value on the Company Data subtab (sites, utility accounts, meters, equipment,
        MWh, Zoom ID and name, URL) across the My Accounts companies, inactive ones left out, as it stood at the end of that day.
      </div>
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.6rem 0.75rem', background: '#fff', maxWidth: 820 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B' }}>All missing</span>
          <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1E293B', fontVariantNumeric: 'tabular-nums' }}>{last.total.toLocaleString()}</span>
          <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{`across ${last.companies} companies`}</span>
          {delta !== 0 && (
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: delta < 0 ? '#047857' : '#B91C1C' }}>
              {`${delta > 0 ? '+' : ''}${delta.toLocaleString()} since ${fmtDay(first.day)}`}
            </span>
          )}
        </div>
        <div style={{ marginTop: 6 }}><TotalLine series={series} /></div>
      </div>
      <div style={{ marginTop: '1rem', height: Math.min(420, 90 + rows.length * 32), display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-missing-history"
          exportFileName="All Missing History"
          columns={columns}
          rows={rows}
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
