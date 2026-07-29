import { useState } from 'react';
import styles from './BrokerFeesTab.module.css';

const EMPTY_ROW = () => ({
  company: '',
  loadEp: '',     // kWh
  feeEp: '',      // $ / kWh
  rfps: '',
  loadNg: '',     // Dth
  feeNg: '',      // $ / Dth
});

// Historical broker-fee benchmarks pulled from the deal log. Loaded
// as the default seed when no broker-fee data has been entered yet
// (and re-loaded by the "Load historical defaults" button below). The
// "SE PE pricing" rows are reference floors/ceilings and get bolded
// by the benchmark-row check in the render.
const SEED_ROWS = () => ([
  { company: 'Brixmor',                        loadEp: '',          feeEp: '0.00190', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'CBRE IM',                        loadEp: '65444610',  feeEp: '0.00235', rfps: '', loadNg: '11857',  feeNg: '0.11'   },
  { company: 'Group RMC',                      loadEp: '6500000',   feeEp: '0.00300', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Guy',                            loadEp: '10000000',  feeEp: '0.00300', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'High end SS - SE PE pricing',    loadEp: '10000000',  feeEp: '0.00350', rfps: '', loadNg: '50000',  feeNg: '0.21'   },
  { company: 'High end RFP - SE PE pricing',   loadEp: '10000000',  feeEp: '0.00075', rfps: '', loadNg: '50000',  feeNg: ''       },
  { company: 'Intown Suites',                  loadEp: '',          feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: '0.20'   },
  { company: 'IRG',                            loadEp: '',          feeEp: '0.00206', rfps: '', loadNg: '',       feeNg: '0.05'   },
  { company: 'IRG',                            loadEp: '118090000', feeEp: '0.00090', rfps: '', loadNg: '',       feeNg: '0.07'   },
  { company: 'Jamestown',                      loadEp: '26616828',  feeEp: '0.00075', rfps: '4', loadNg: '25032', feeNg: '0.18'   },
  { company: 'Low end SS - SE PE pricing',     loadEp: '25000000',  feeEp: '0.00120', rfps: '', loadNg: '75000',  feeNg: '0.11'   },
  { company: 'Low end RFP - SE PE pricing',    loadEp: '25000000',  feeEp: '0.00025', rfps: '', loadNg: '75000',  feeNg: '0.06'   },
  { company: 'Luxema',                         loadEp: '26534377',  feeEp: '0.00120', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Piedmont',                       loadEp: '103772520', feeEp: '0.00080', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Starwood',                       loadEp: '',          feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'WeWork',                         loadEp: '',          feeEp: '0.01249', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Willco',                         loadEp: '17563824',  feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Criterion',                      loadEp: '385000',    feeEp: '0.03600', rfps: '', loadNg: '',       feeNg: ''       },
  { company: '',                               loadEp: '12215073',  feeEp: '0.002',   rfps: '', loadNg: '',       feeNg: ''       },
]);

const fmtMoney = (n, dp = 0) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtRate = (n, dp = 5) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `$${n.toFixed(dp)}`;
};

const fmtNum = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function totalFee(load, rate) {
  const l = toNum(load);
  const r = toNum(rate);
  if (l == null || r == null) return null;
  return l * r;
}

// Heatmap interpolator. Returns an HSL background for a numeric value
// scaled across the [min, max] range. `direction = 'highGood'` puts
// green at the high end (loads — bigger is better for us); 'lowGood'
// puts green at the low end (broker fees — lower is cheaper).
function heatmapBg(value, min, max, direction) {
  if (value == null || !Number.isFinite(value) || min == null || max == null || max === min) return null;
  let t = (value - min) / (max - min);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  if (direction === 'lowGood') t = 1 - t;
  // Interpolate hue red(0) → yellow(60) → green(120). Keep saturation
  // and lightness gentle so text stays readable.
  const hue = Math.round(t * 120);
  return `hsl(${hue} 70% 82%)`;
}

// SE PE pricing reference rows ("High end SS - SE PE pricing", etc.)
// aren't real deals; they're floor/ceiling benchmarks. Bold them so
// they read as reference lines.
function isBenchmarkRow(company) {
  if (!company) return false;
  return /\bse pe pricing\b/i.test(company);
}

// Parse tab- or comma-separated text from Excel. Expected order:
// Company / Annual Load EP / Fee EP / RFPs / (Total Fee EP — ignored) /
// Annual Load NG / Fee NG / (Total Fee NG — ignored).
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    out.push({
      company: cell(0),
      loadEp: cell(1),
      feeEp: cell(2),
      rfps: cell(3),
      // cell(4) is the source workbook's Total Fee EP — recomputed below
      loadNg: cell(5),
      feeNg: cell(6),
      // cell(7) is the source workbook's Total Fee NG — recomputed below
    });
  }
  return out;
}

function CellInput({ value, onCommit, align, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

export function BrokerFeesTab({ rows, setRows }) {
  // First-time visit (rows === null/undefined) → show the historical
  // seed. An explicitly-saved empty array still wins, so a user who
  // hits Clear doesn't get the seed re-shoved back in.
  const safeRows = Array.isArray(rows) ? (rows.length ? rows : Array.from({ length: 12 }, EMPTY_ROW)) : SEED_ROWS();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  // Column sort is a view-only overlay. Click a header to cycle
  // unsorted → ascending → descending → unsorted. The underlying
  // rows array stays in its persisted order so updateRow / removeRow
  // hit the right cell after a sort.
  const [sortConfig, setSortConfig] = useState(null);

  const updateRow = (idx, key, value) => {
    const next = safeRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    setRows(next);
  };
  const addRow = () => setRows([...safeRows, EMPTY_ROW()]);
  const removeRow = (idx) => {
    const next = safeRows.slice();
    next.splice(idx, 1);
    setRows(next.length ? next : [EMPTY_ROW()]);
  };
  const replaceRows = (newRows) => {
    const padded = newRows.length < 12
      ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
      : newRows;
    setRows(padded);
  };
  const clearAll = () => {
    const hasData = safeRows.some(r => r.company || r.loadEp || r.feeEp || r.rfps || r.loadNg || r.feeNg);
    if (!hasData) {
      setRows(Array.from({ length: 12 }, EMPTY_ROW));
      return;
    }
    if (window.confirm('Clear all broker-fee rows? This cannot be undone.')) {
      setRows(Array.from({ length: 12 }, EMPTY_ROW));
    }
  };

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseRowsFromText(text);
    if (!parsed.length) return;
    replaceRows(parsed);
    setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  // Aggregates across non-empty rows. Per-commodity totals power the
  // summary cards; the weighted-average fee divides total revenue by
  // total load so a small high-rate row can't skew it.
  let epLoadSum = 0;
  let epFeeRevSum = 0;
  let ngLoadSum = 0;
  let ngFeeRevSum = 0;
  let totalRfps = 0;
  for (const r of safeRows) {
    const tEp = totalFee(r.loadEp, r.feeEp);
    if (tEp != null) { epFeeRevSum += tEp; epLoadSum += toNum(r.loadEp) || 0; }
    const tNg = totalFee(r.loadNg, r.feeNg);
    if (tNg != null) { ngFeeRevSum += tNg; ngLoadSum += toNum(r.loadNg) || 0; }
    const rfps = toNum(r.rfps);
    if (rfps != null) totalRfps += rfps;
  }
  const epWeightedRate = epLoadSum > 0 ? epFeeRevSum / epLoadSum : null;
  const ngWeightedRate = ngLoadSum > 0 ? ngFeeRevSum / ngLoadSum : null;

  // Per-column min/max for the heatmap shading. Only numeric values
  // contribute, so blanks stay neutral.
  function rangeOf(values) {
    const nums = values.map(toNum).filter(v => v != null);
    if (!nums.length) return { min: null, max: null };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  const loadEpRange = rangeOf(safeRows.map(r => r.loadEp));
  const feeEpRange  = rangeOf(safeRows.map(r => r.feeEp));
  const loadNgRange = rangeOf(safeRows.map(r => r.loadNg));
  const feeNgRange  = rangeOf(safeRows.map(r => r.feeNg));

  // Sortable column accessor. Returns the value the sorter should
  // compare on — numeric for load / fee / RFP / total columns,
  // lowercased string for company. Total columns sort on the
  // computed load × fee, not on whatever's stored.
  function sortValueFor(row, key) {
    switch (key) {
      case 'company': return String(row.company || '').toLowerCase();
      case 'loadEp':  return toNum(row.loadEp);
      case 'feeEp':   return toNum(row.feeEp);
      case 'rfps':    return toNum(row.rfps);
      case 'totalEp': return totalFee(row.loadEp, row.feeEp);
      case 'loadNg':  return toNum(row.loadNg);
      case 'feeNg':   return toNum(row.feeNg);
      case 'totalNg': return totalFee(row.loadNg, row.feeNg);
      default:        return null;
    }
  }

  // Visible row order. Without a sort, that's just the persisted
  // order. With one, sort a copy by the chosen column — blank cells
  // sink to the bottom regardless of direction so empty padding
  // rows don't shove real data offscreen.
  const indexedRows = safeRows.map((row, idx) => ({ row, idx }));
  let viewRows = indexedRows;
  if (sortConfig?.key) {
    const isAsc = sortConfig.direction === 'asc';
    viewRows = indexedRows.slice().sort((a, b) => {
      const av = sortValueFor(a.row, sortConfig.key);
      const bv = sortValueFor(b.row, sortConfig.key);
      const aEmpty = av == null || av === '';
      const bEmpty = bv == null || bv === '';
      if (aEmpty && bEmpty) return a.idx - b.idx;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return isAsc ? av - bv : bv - av;
      const as = String(av), bs = String(bv);
      return isAsc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }

  function toggleSort(key) {
    setSortConfig(prev => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  function sortArrow(key) {
    if (sortConfig?.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  }

  const sortableHeaderProps = (key, className) => ({
    className,
    onClick: () => toggleSort(key),
    style: { cursor: 'pointer', userSelect: 'none' },
    title: 'Click to sort — click again to reverse, third click clears the sort',
  });

  return (
    <div className={styles.wrapper} onPaste={handleTablePaste}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        <button
          type="button"
          className={styles.btn}
          title="Replace current rows with the historical benchmark data."
          onClick={() => {
            const hasData = safeRows.some(r => r.company || r.loadEp || r.feeEp || r.rfps || r.loadNg || r.feeNg);
            if (hasData && !window.confirm('Replace current rows with the historical benchmark data?')) return;
            setRows(SEED_ROWS());
            setFlash('Loaded historical defaults.');
            window.setTimeout(() => setFlash(''), 2500);
          }}
        >Load historical defaults</button>
        <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Company · Annual Load EP (kWh) · Fee EP ($/kWh) · RFPs ·
            (Total Fee EP — ignored, recomputed) · Annual Load NG (Dth) · Fee NG ($/Dth) ·
            (Total Fee NG — ignored).
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Jamestown\t26,616,828\t$0.00075\t4\t\t25,032\t$0.18\t'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const parsed = parseRowsFromText(pasteText);
                if (!parsed.length) return;
                replaceRows(parsed);
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >Replace rows</button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th rowSpan={2} {...sortableHeaderProps('company', styles.colCompany)}>
                Company{sortArrow('company')}
              </th>
              <th colSpan={4} className={styles.epGroup}>Electric Power</th>
              <th colSpan={3} className={styles.ngGroup}>Natural Gas</th>
              <th rowSpan={2} className={styles.actionCol} />
            </tr>
            <tr>
              <th {...sortableHeaderProps('loadEp', `${styles.colLoad} ${styles.numCell} ${styles.epGroup}`)}>
                Annual Deregulated Load (kWh){sortArrow('loadEp')}
              </th>
              <th {...sortableHeaderProps('feeEp', `${styles.colFee} ${styles.numCell} ${styles.epGroup}`)}>
                Broker Fee /kWh{sortArrow('feeEp')}
              </th>
              <th {...sortableHeaderProps('rfps', `${styles.colRfps} ${styles.numCell} ${styles.epGroup}`)}>
                RFPs{sortArrow('rfps')}
              </th>
              <th {...sortableHeaderProps('totalEp', `${styles.colTotal} ${styles.numCell} ${styles.epGroup}`)}>
                Total Fee{sortArrow('totalEp')}
              </th>
              <th {...sortableHeaderProps('loadNg', `${styles.colLoad} ${styles.numCell} ${styles.ngGroup}`)}>
                Annual Load (Dth){sortArrow('loadNg')}
              </th>
              <th {...sortableHeaderProps('feeNg', `${styles.colFee} ${styles.numCell} ${styles.ngGroup}`)}>
                Broker Fee /Dth{sortArrow('feeNg')}
              </th>
              <th {...sortableHeaderProps('totalNg', `${styles.colTotal} ${styles.numCell} ${styles.ngGroup}`)}>
                Total Fee{sortArrow('totalNg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map(({ row, idx }) => {
              const tEp = totalFee(row.loadEp, row.feeEp);
              const tNg = totalFee(row.loadNg, row.feeNg);
              const k = `${idx}-${row.company}-${row.loadEp}-${row.feeEp}-${row.rfps}-${row.loadNg}-${row.feeNg}`;
              const feeEpDisplay = row.feeEp !== '' && row.feeEp != null && toNum(row.feeEp) != null
                ? `$${(toNum(row.feeEp) || 0).toFixed(5)}`
                : (row.feeEp ?? '');
              const feeNgDisplay = row.feeNg !== '' && row.feeNg != null && toNum(row.feeNg) != null
                ? `$${(toNum(row.feeNg) || 0).toFixed(4)}`
                : (row.feeNg ?? '');
              const loadEpNum = toNum(row.loadEp);
              const loadNgNum = toNum(row.loadNg);
              const feeEpNum  = toNum(row.feeEp);
              const feeNgNum  = toNum(row.feeNg);
              // Heatmap shading: larger loads green, smaller red;
              // lower fees green, higher red.
              const loadEpBg = heatmapBg(loadEpNum, loadEpRange.min, loadEpRange.max, 'highGood');
              const feeEpBg  = heatmapBg(feeEpNum,  feeEpRange.min,  feeEpRange.max,  'lowGood');
              const loadNgBg = heatmapBg(loadNgNum, loadNgRange.min, loadNgRange.max, 'highGood');
              const feeNgBg  = heatmapBg(feeNgNum,  feeNgRange.min,  feeNgRange.max,  'lowGood');
              const benchmark = isBenchmarkRow(row.company);
              return (
                <tr key={idx} className={benchmark ? styles.benchmarkRow : ''}>
                  <td className={styles.tan}>
                    <CellInput key={`co-${k}`} value={row.company} onCommit={(v) => updateRow(idx, 'company', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={loadEpBg ? { background: loadEpBg } : undefined}>
                    <CellInput
                      key={`le-${k}`}
                      value={loadEpNum != null ? loadEpNum.toLocaleString('en-US') : (row.loadEp ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadEp', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={feeEpBg ? { background: feeEpBg } : undefined}>
                    <CellInput
                      key={`fe-${k}`}
                      value={feeEpDisplay}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'feeEp', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`rf-${k}`} value={row.rfps} align="right" onCommit={(v) => updateRow(idx, 'rfps', v)} />
                  </td>
                  <td className={`${styles.calc} ${styles.numCell}`}>
                    {tEp != null ? fmtMoney(tEp) : ''}
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={loadNgBg ? { background: loadNgBg } : undefined}>
                    <CellInput
                      key={`ln-${k}`}
                      value={loadNgNum != null ? loadNgNum.toLocaleString('en-US') : (row.loadNg ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadNg', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={feeNgBg ? { background: feeNgBg } : undefined}>
                    <CellInput
                      key={`fn-${k}`}
                      value={feeNgDisplay}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'feeNg', v)}
                    />
                  </td>
                  <td className={`${styles.calc} ${styles.numCell}`}>
                    {tNg != null ? fmtMoney(tNg, 2) : ''}
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td style={{ textAlign: 'right' }}>Totals</td>
              <td className={styles.numCell}>{fmtNum(epLoadSum)}</td>
              <td className={styles.numCell}>{epWeightedRate != null ? fmtRate(epWeightedRate, 5) : ''}</td>
              <td className={styles.numCell}>{fmtNum(totalRfps)}</td>
              <td className={styles.numCell}>{fmtMoney(epFeeRevSum)}</td>
              <td className={styles.numCell}>{fmtNum(ngLoadSum)}</td>
              <td className={styles.numCell}>{ngWeightedRate != null ? fmtRate(ngWeightedRate, 4) : ''}</td>
              <td className={styles.numCell}>{fmtMoney(ngFeeRevSum, 2)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
