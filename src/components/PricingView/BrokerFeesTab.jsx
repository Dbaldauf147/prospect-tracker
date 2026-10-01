import { useEffect, useState } from 'react';
import styles from './BrokerFeesTab.module.css';
import { SIA_HISTORY_EVENT, listSiaHistory } from '../../utils/siaLoadHistory';
import { siaHistorySummary } from '../../utils/siaHistoryEntry';
import { brokerFeeImportFor, mergeSiaImports } from '../../utils/brokerFeesSiaImport';

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

// The heat-shaded columns, and the row field naming the ones a row leaves
// out of the shading: an outlier ticked off there stays uncoloured and
// stops stretching the scale for everyone else. Totals still count it.
const HEAT_KEYS = ['loadEp', 'feeEp', 'loadNg', 'feeNg'];
const isColorIgnored = (row, key) => Array.isArray(row?.colorIgnore) && row.colorIgnore.includes(key);

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
  // "Import from SIA" picker: every SIA in the SIA History subtab that
  // carries a company, kWh or gas figure, ticked ones merged into the table.
  const [siaOpen, setSiaOpen] = useState(false);
  const [siaEntries, setSiaEntries] = useState(null);
  const [siaPicked, setSiaPicked] = useState(() => new Set());
  const [siaFilter, setSiaFilter] = useState('');

  useEffect(() => {
    if (!siaOpen) return undefined;
    let cancelled = false;
    const load = () => {
      listSiaHistory({ onRemote: list => { if (!cancelled) setSiaEntries(list); } })
        .then(list => { if (!cancelled) setSiaEntries(list); })
        .catch(() => { if (!cancelled) setSiaEntries([]); });
    };
    load();
    window.addEventListener(SIA_HISTORY_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SIA_HISTORY_EVENT, load);
    };
  }, [siaOpen]);

  const siaChoices = (siaEntries || [])
    .map(entry => ({ entry, imp: brokerFeeImportFor(entry), summary: siaHistorySummary(entry) }))
    .filter(c => c.imp);
  const siaQ = siaFilter.trim().toLowerCase();
  const siaShown = siaQ
    ? siaChoices.filter(c => [c.imp.company, c.entry.fileName, c.summary.date].join(' ').toLowerCase().includes(siaQ))
    : siaChoices;

  function toggleSiaPick(id) {
    setSiaPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function importFromSia() {
    const imports = siaChoices.filter(c => siaPicked.has(c.entry.id)).map(c => c.imp);
    if (!imports.length) return;
    const { rows: merged, updated, added } = mergeSiaImports(safeRows, imports);
    setRows(merged);
    setSiaPicked(new Set());
    setSiaOpen(false);
    const parts = [];
    if (added) parts.push(`added ${added} row${added === 1 ? '' : 's'}`);
    if (updated) parts.push(`updated ${updated} row${updated === 1 ? '' : 's'}`);
    setFlash(`Imported from SIA: ${parts.join(', ')}.`);
    window.setTimeout(() => setFlash(''), 3000);
  }

  const updateRow = (idx, key, value) => {
    const next = safeRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    setRows(next);
  };
  const addRow = () => setRows([...safeRows, EMPTY_ROW()]);
  const toggleColorIgnore = (idx, key) => {
    const row = safeRows[idx];
    const list = Array.isArray(row.colorIgnore) ? row.colorIgnore : [];
    const nextList = list.includes(key) ? list.filter(k => k !== key) : [...list, key];
    const next = safeRows.slice();
    const { colorIgnore: _drop, ...rest } = row;
    next[idx] = nextList.length ? { ...rest, colorIgnore: nextList } : rest;
    setRows(next);
  };
  const showAllColors = () => setRows(safeRows.map(r => {
    if (!('colorIgnore' in r)) return r;
    const { colorIgnore: _drop, ...rest } = r;
    return rest;
  }));
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
  // Values left out of the colours don't set the range either.
  const shaded = (key) => safeRows.filter(r => !isColorIgnored(r, key)).map(r => r[key]);
  const loadEpRange = rangeOf(shaded('loadEp'));
  const feeEpRange  = rangeOf(shaded('feeEp'));
  const loadNgRange = rangeOf(shaded('loadNg'));
  const feeNgRange  = rangeOf(shaded('feeNg'));
  const ignoredCount = safeRows.reduce((n, r) => n + HEAT_KEYS.filter(k => isColorIgnored(r, k)).length, 0);

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
    title: 'Click to sort: click again to reverse, third click clears the sort',
  });

  return (
    <div className={styles.wrapper} onPaste={handleTablePaste}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button
          type="button"
          className={styles.btn}
          title="Pull the company name, annual kWh and annual Dth from SIAs in the SIA History subtab."
          onClick={() => setSiaOpen(o => !o)}
        >
          {siaOpen ? 'Close SIA import' : 'Import from SIA'}
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
            (Total Fee EP: ignored, recomputed) · Annual Load NG (Dth) · Fee NG ($/Dth) ·
            (Total Fee NG: ignored).
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

      {siaOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tick the SIAs to bring in. Each one's company name, annual kWh and annual gas (Dth; an MMBtu figure
            is the same number) goes into the table. A company already in the table has its loads updated and
            keeps its fees; anything else is added as a new row.
          </div>
          <div className={styles.siaToolbar}>
            <input
              type="search"
              className={styles.siaSearch}
              placeholder="Search company, file or SIA date"
              value={siaFilter}
              onChange={(e) => setSiaFilter(e.target.value)}
            />
            <button
              type="button"
              className={styles.btn}
              disabled={!siaShown.length}
              onClick={() => setSiaPicked(prev => {
                const allOn = siaShown.every(c => prev.has(c.entry.id));
                const next = new Set(prev);
                for (const c of siaShown) { if (allOn) next.delete(c.entry.id); else next.add(c.entry.id); }
                return next;
              })}
            >{siaShown.length && siaShown.every(c => siaPicked.has(c.entry.id)) ? 'Untick all' : 'Tick all'}</button>
          </div>
          {siaEntries == null && <div className={styles.pasteHint}>Loading SIA history...</div>}
          {siaEntries != null && siaChoices.length === 0 && (
            <div className={styles.pasteHint}>
              No SIA in the SIA History subtab carries a company, kWh or gas figure yet. Upload one on the Pricing subtab first.
            </div>
          )}
          {siaShown.length > 0 && (
            <div className={styles.siaListWrap}>
              <table className={styles.siaList}>
                <thead>
                  <tr>
                    <th />
                    <th>Company</th>
                    <th>SIA Date</th>
                    <th>File</th>
                    <th className={styles.numCell}>Annual kWh</th>
                    <th className={styles.numCell}>Annual Dth</th>
                  </tr>
                </thead>
                <tbody>
                  {siaShown.map(({ entry, imp, summary }) => (
                    <tr key={entry.id} onClick={() => toggleSiaPick(entry.id)}>
                      <td>
                        <input
                          type="checkbox"
                          checked={siaPicked.has(entry.id)}
                          onChange={() => toggleSiaPick(entry.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>{imp.company || <span className={styles.muted}>(no company)</span>}</td>
                      <td>{summary.date}</td>
                      <td className={styles.muted}>{entry.fileName}</td>
                      <td className={styles.numCell}>{imp.loadEp ? Number(imp.loadEp).toLocaleString('en-US') : ''}</td>
                      <td className={styles.numCell}>{imp.loadNg ? Number(imp.loadNg).toLocaleString('en-US') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={styles.pasteActions}>
            <button type="button" className={styles.btn} disabled={!siaPicked.size} onClick={importFromSia}>
              Import {siaPicked.size || ''} selected
            </button>
            <button type="button" className={styles.btn} onClick={() => { setSiaPicked(new Set()); setSiaOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.colorHint}>
        Hover a load or fee cell and click ⊘ to leave an outlier out of the colours. It keeps its value and still counts in the totals.
        {ignoredCount > 0 && (
          <>
            {' '}{ignoredCount} left out.{' '}
            <button type="button" className={styles.linkBtn} onClick={showAllColors}>Colour all again</button>
          </>
        )}
      </div>

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
              const off = (key) => isColorIgnored(row, key);
              const loadEpBg = off('loadEp') ? null : heatmapBg(loadEpNum, loadEpRange.min, loadEpRange.max, 'highGood');
              const feeEpBg  = off('feeEp') ? null : heatmapBg(feeEpNum,  feeEpRange.min,  feeEpRange.max,  'lowGood');
              const loadNgBg = off('loadNg') ? null : heatmapBg(loadNgNum, loadNgRange.min, loadNgRange.max, 'highGood');
              const feeNgBg  = off('feeNg') ? null : heatmapBg(feeNgNum,  feeNgRange.min,  feeNgRange.max,  'lowGood');
              // The ⊘ toggle in a shaded cell: shown on hover, and always
              // on a cell already left out so it can be put back.
              const heatCls = (key) => `${styles.tan} ${styles.numCell} ${styles.heatCell} ${off(key) ? styles.colorOff : ''}`;
              const ignoreBtn = (key) => (
                <button
                  type="button"
                  className={styles.ignoreBtn}
                  aria-pressed={off(key)}
                  onClick={() => toggleColorIgnore(idx, key)}
                  title={off(key)
                    ? 'Left out of the colours. Click to colour it again.'
                    : 'Leave this value out of the colours, so an outlier does not stretch the scale. It still counts in the totals.'}
                >⊘</button>
              );
              const benchmark = isBenchmarkRow(row.company);
              return (
                <tr key={idx} className={benchmark ? styles.benchmarkRow : ''}>
                  <td className={styles.tan}>
                    <CellInput key={`co-${k}`} value={row.company} onCommit={(v) => updateRow(idx, 'company', v)} />
                  </td>
                  <td className={heatCls('loadEp')} style={loadEpBg ? { background: loadEpBg } : undefined}>
                    {ignoreBtn('loadEp')}
                    <CellInput
                      key={`le-${k}`}
                      value={loadEpNum != null ? loadEpNum.toLocaleString('en-US') : (row.loadEp ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadEp', v)}
                    />
                  </td>
                  <td className={heatCls('feeEp')} style={feeEpBg ? { background: feeEpBg } : undefined}>
                    {ignoreBtn('feeEp')}
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
                  <td className={heatCls('loadNg')} style={loadNgBg ? { background: loadNgBg } : undefined}>
                    {ignoreBtn('loadNg')}
                    <CellInput
                      key={`ln-${k}`}
                      value={loadNgNum != null ? loadNgNum.toLocaleString('en-US') : (row.loadNg ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadNg', v)}
                    />
                  </td>
                  <td className={heatCls('feeNg')} style={feeNgBg ? { background: feeNgBg } : undefined}>
                    {ignoreBtn('feeNg')}
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
