// Pipeline > KPI Trends: six KPIs over the trailing 6 and 12 months from the
// Opps tab (utils/kpiTrends.js), under Pipeline Metrics. Every value is a
// button that downloads the opps behind it; Export all downloads every cell
// in one workbook.
import { useMemo, useState } from 'react';
import styles from './PipelineView.module.css';
import { computeKpiTrends, formatKpi } from '../../utils/kpiTrends';

// The arrow says which way the number moved; the colour says whether that
// is good, so a shorter Opportunity Life is a green down arrow.
const TREND = {
  better: { color: '#166534', word: 'better' },
  worse: { color: '#b91c1c', word: 'worse' },
  flat: { color: '#64748b', word: 'about the same' },
};
const ARROW = { up: '▲', down: '▼', flat: '=' };
// Short names for Export all's sheets (Excel caps a sheet name at 31).
const SHEET = { generation: 'Generation', avgSize: 'Avg Size', pctQuoted: 'Pct Quoted', closeQuoted: 'Close Rate Quoted', closeOverall: 'Close Rate Overall', avgLife: 'Avg Life' };
const today = () => new Date().toISOString().slice(0, 10);
const range = (w) => `${new Date(w.from).toISOString().slice(0, 10)} to ${new Date(w.to).toISOString().slice(0, 10)}`;

function aboutRows(kpi, cell, w) {
  return [
    { Field: 'KPI', Value: kpi.label },
    { Field: 'Window', Value: `${w.label} (${range(w)})` },
    { Field: 'Value', Value: formatKpi(cell.value, kpi.format) },
    { Field: 'Detail', Value: cell.detail },
    { Field: 'How it is counted', Value: kpi.about },
    { Field: 'Pull-through opps', Value: 'Left out, as they are of the close rates.' },
  ];
}

function sheetOf(XLSX, rows, empty) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: empty }]);
  const headers = Object.keys(rows[0] || { Note: '' });
  ws['!cols'] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 2, 14), 40) }));
  return ws;
}

export function KpiTrendsSection({ oppsRecords = [], ageRef }) {
  const trends = useMemo(() => computeKpiTrends(oppsRecords, { ageRef }), [oppsRecords, ageRef]);
  const [error, setError] = useState('');

  const exportCell = async (kpi, i) => {
    setError('');
    try {
      const XLSX = await import('xlsx');
      const cell = kpi.cells[i];
      const w = trends.windows[i];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetOf(XLSX, cell.rows, 'No opps in this window.'), 'Opps');
      XLSX.utils.book_append_sheet(wb, sheetOf(XLSX, aboutRows(kpi, cell, w), ''), 'About');
      XLSX.writeFile(wb, `KPI Trends - ${kpi.label} - ${w.label} - ${today()}.xlsx`);
    } catch (err) {
      setError(`Couldn't build the export: ${err?.message || err}`);
    }
  };

  const exportAll = async () => {
    setError('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const summary = trends.rows.map(k => ({
        KPI: k.label,
        ...Object.fromEntries(trends.windows.map((w, i) => [w.label, formatKpi(k.cells[i].value, k.format)])),
        Trend: k.trend ? TREND[k.trend].word : '',
        'How it is counted': k.about,
      }));
      XLSX.utils.book_append_sheet(wb, sheetOf(XLSX, summary, ''), 'Summary');
      for (const k of trends.rows) {
        trends.windows.forEach((w, i) => {
          XLSX.utils.book_append_sheet(wb, sheetOf(XLSX, k.cells[i].rows, 'No opps in this window.'), `${SHEET[k.key]} ${w.months}mo`.slice(0, 31));
        });
      }
      XLSX.writeFile(wb, `KPI Trends - ${today()}.xlsx`);
    } catch (err) {
      setError(`Couldn't build the export: ${err?.message || err}`);
    }
  };

  const noData = oppsRecords.length === 0;
  return (
    <div className={styles.section} style={{ maxWidth: 760 }}>
      <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>KPI TRENDS</span>
        <button type="button" onClick={exportAll} disabled={noData}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, fontSize: 11, padding: '0.15rem 0.5rem', cursor: noData ? 'default' : 'pointer', fontFamily: 'inherit' }}
          title="Download every KPI and window in one Excel file: a summary sheet, then the opps behind each value."
        >Export all</button>
      </div>
      {noData ? (
        <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>Paste the Opps tab to see KPI trends.</div>
      ) : (
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.headerLeft}>KPI</th>
              {trends.windows.map(w => <th key={w.months} title={range(w)}>{w.label}</th>)}
              <th title={`${trends.windows[0].label} against ${trends.windows[1].label}. Opportunity Generation is compared per month.`}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {trends.rows.map(k => (
              <tr key={k.key}>
                <td className={styles.label} title={k.about}>{k.label}</td>
                {k.cells.map((c, i) => (
                  <td key={i} className={styles.numCell}>
                    <button type="button" onClick={() => exportCell(k, i)}
                      title={`${c.detail}. Click to download the ${c.rows.length} opp${c.rows.length === 1 ? '' : 's'} behind this value.`}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}
                    >{formatKpi(c.value, k.format)}</button>
                  </td>
                ))}
                <td style={{ textAlign: 'center' }}>
                  {k.trend
                    ? <span style={{ color: TREND[k.trend].color, fontWeight: 700 }} title={`${trends.windows[0].label} is ${TREND[k.trend].word} than ${trends.windows[1].label}`}>{ARROW[k.direction]}</span>
                    : <span style={{ color: '#94a3b8' }}>-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <div style={{ padding: '0.4rem 0.75rem', color: '#b91c1c', fontSize: '0.72rem' }}>{error}</div>}
    </div>
  );
}
