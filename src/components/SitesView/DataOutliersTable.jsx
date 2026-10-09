// The Data quality card on the Utility Lookup page, beside the Data
// summary: a min and a max per measure, and how many sites fall outside
// them. Clicking a count narrows the site list to those sites.
//
// The measures, the bounds and the counting live in dataOutliers.js; this
// file only lays them out.

import { OUTLIER_METRICS, formatMetric } from './dataOutliers.js';

const headCellStyle = {
  padding: '0.15rem 0.5rem 0.25rem 0',
  fontSize: '0.66rem',
  fontWeight: 600,
  color: '#94A3B8',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const labelCellStyle = {
  padding: '0.22rem 0.75rem 0.22rem 0',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#475569',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

const cellStyle = {
  padding: '0.1rem 0.5rem 0.1rem 0',
  fontSize: '0.72rem',
  color: '#0F172A',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

const inputStyle = {
  width: '5.5rem',
  padding: '0.15rem 0.35rem',
  fontSize: '0.72rem',
  border: '1px solid #CBD5E1',
  borderRadius: 4,
  background: '#FFFFFF',
  color: '#0F172A',
};

const pillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.15rem 0.5rem',
  borderRadius: 4,
  fontSize: '0.72rem',
  fontWeight: 600,
  border: 'none',
  font: 'inherit',
};

function OutlierCount({ result, active, onPick }) {
  if (!result.measured) {
    return <span style={{ color: '#94A3B8' }}>No sites measured</span>;
  }
  const n = result.ids.size;
  if (n === 0) {
    return (
      <span style={{ ...pillBase, background: '#F0FDF4', color: '#166534', borderLeft: '3px solid #16A34A' }}>
        None
      </span>
    );
  }
  const sides = [
    result.low ? `${result.low.toLocaleString()} below` : '',
    result.high ? `${result.high.toLocaleString()} above` : '',
  ].filter(Boolean).join(', ');
  return (
    <button
      type="button"
      onClick={onPick}
      title={active ? 'Showing these sites in the list below. Click to show every site again.' : 'Click to show only these sites in the list below.'}
      style={{
        ...pillBase,
        cursor: 'pointer',
        background: active ? '#DC2626' : '#FEF2F2',
        color: active ? '#FFFFFF' : '#991B1B',
        borderLeft: '3px solid #DC2626',
      }}
    >
      {n.toLocaleString()} site{n === 1 ? '' : 's'} ({sides})
    </button>
  );
}

export function DataOutliersTable({ thresholds, results, activeKey, onChange, onPick, onReset }) {
  if (!results) return null;
  return (
    <div
      style={{
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        background: '#FFFFFF',
        padding: '0.5rem 0.75rem',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem', fontWeight: 700, color: '#0F172A',
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem',
          display: 'flex', alignItems: 'baseline', gap: '0.4rem',
        }}
        title="Set a minimum and a maximum per measure. A site outside them is flagged as an outlier. Leave a box blank for no bound on that side."
      >
        Data quality
        <span style={{ fontWeight: 500, color: '#94A3B8', textTransform: 'none', letterSpacing: 0 }}>
          outlier thresholds
        </span>
        <button
          type="button"
          onClick={onReset}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: '0.66rem', fontWeight: 500, color: '#64748B', textTransform: 'none', letterSpacing: 0,
            textDecoration: 'underline',
          }}
          title="Put every threshold back to its default."
        >Reset</button>
      </div>
      <table style={{ width: 'auto', borderCollapse: 'separate', borderSpacing: '0 0.1rem' }}>
        <thead>
          <tr>
            <th style={headCellStyle} />
            <th style={headCellStyle}>Min</th>
            <th style={headCellStyle}>Max</th>
            <th style={headCellStyle}>Range on file</th>
            <th style={headCellStyle}>Outliers</th>
          </tr>
        </thead>
        <tbody>
          {OUTLIER_METRICS.map(m => {
            const result = results[m.key];
            const t = thresholds[m.key];
            const range = result.measured
              ? `${formatMetric(m, result.min)} to ${formatMetric(m, result.max)}`
              : '';
            return (
              <tr key={m.key}>
                <td style={labelCellStyle} title={m.title}>
                  {m.label}
                  <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: '0.3rem' }}>{m.unit}</span>
                </td>
                <td style={cellStyle}>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${m.label} minimum`}
                    placeholder="No min"
                    value={t.min}
                    onChange={e => onChange(m.key, 'min', e.target.value)}
                    style={inputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${m.label} maximum`}
                    placeholder="No max"
                    value={t.max}
                    onChange={e => onChange(m.key, 'max', e.target.value)}
                    style={inputStyle}
                  />
                </td>
                <td
                  style={{ ...cellStyle, color: '#64748B' }}
                  title={result.measured ? `Measured on ${result.measured.toLocaleString()} site${result.measured === 1 ? '' : 's'}.` : m.title}
                >{range}</td>
                <td style={cellStyle}>
                  <OutlierCount result={result} active={activeKey === m.key} onPick={() => onPick(m.key)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DataOutliersTable;
