import { Fragment, useEffect, useMemo, useState } from 'react';
import styles from './SiaHistoryTab.module.css';
import { SIA_HISTORY_EVENT, deleteSiaHistoryEntry, listSiaHistory } from '../../utils/siaLoadHistory';
import { siaHistorySummary } from '../../utils/siaHistoryEntry';
import * as XLSX from 'xlsx';
import { buildSiaHistoryWorkbook, siaHistoryFileName } from '../../utils/siaHistoryWorkbook';
import { sanitizeSheetJsWorkbook } from '../../utils/exportSanitize.js';

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '');
const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '');
const fmtWhen = (ms) => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// Every SIA loaded on the Pricing subtab, newest first. A row opens to the
// SIA's header details and cost lines, option by option.
export function SiaHistoryTab({ currentId }) {
  const [entries, setEntries] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      listSiaHistory({ onRemote: list => { if (!cancelled) setEntries(list); } })
        .then(list => { if (!cancelled) setEntries(list); })
        .catch(() => { if (!cancelled) setEntries([]); });
    };
    load();
    window.addEventListener(SIA_HISTORY_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SIA_HISTORY_EVENT, load);
    };
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (entries || []).map(e => ({ entry: e, summary: siaHistorySummary(e) }));
    if (!q) return list;
    return list.filter(({ entry, summary }) => {
      const hay = [
        entry.fileName,
        summary.salesperson,
        ...(entry.options || []).flatMap(o => [o.sheetName, o.solutionDescription, ...(o.headerDetails || []).map(d => d.value)]),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filter]);

  function download(entry) {
    const wb = buildSiaHistoryWorkbook(entry);
    sanitizeSheetJsWorkbook(wb);
    XLSX.writeFile(wb, siaHistoryFileName(entry));
  }

  async function remove(entry) {
    if (!window.confirm(`Remove "${entry.fileName}" (loaded ${fmtWhen(entry.loadedAt)}) from the SIA history?`)) return;
    setEntries(prev => (prev || []).filter(e => e.id !== entry.id));
    if (openId === entry.id) setOpenId(null);
    await deleteSiaHistoryEntry(entry.id);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Every SIA uploaded on the Pricing subtab is recorded here with its details (sites, accounts, salesperson,
        solution description, target GM%) and its cost line items, so an earlier SIA can be looked back on after
        another one replaces it. Click a row to see it option by option.
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Filter by file name, salesperson, or any SIA detail"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <span className={styles.count}>
          {entries == null ? 'Loading...' : `${shown.length} of ${entries.length} load${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {entries != null && entries.length === 0 && (
        <div className={styles.empty}>No SIAs loaded yet. Upload one on the Pricing subtab and it will appear here.</div>
      )}

      {shown.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              <th>Loaded</th>
              <th>File</th>
              <th>Salesperson</th>
              <th className={styles.num}>Options</th>
              <th className={styles.num}>Sites</th>
              <th className={styles.num}>Accounts</th>
              <th className={styles.num}>Cost lines</th>
              <th className={styles.num} title="Sum of the CTS column across every cost line on every option">Total CTS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ entry, summary }) => {
              const open = openId === entry.id;
              return (
                <Fragment key={entry.id}>
                  <tr className={open ? styles.rowOpen : styles.row} onClick={() => setOpenId(open ? null : entry.id)}>
                    <td className={styles.caret}>{open ? '▾' : '▸'}</td>
                    <td className={styles.nowrap}>{fmtWhen(entry.loadedAt)}</td>
                    <td>
                      {entry.fileName}
                      {entry.id === currentId && <span className={styles.currentTag}>On screen</span>}
                    </td>
                    <td>{summary.salesperson}</td>
                    <td className={styles.num}>{summary.optionCount}</td>
                    <td className={styles.num}>{fmtNum(summary.sites)}</td>
                    <td className={styles.num}>{fmtNum(summary.accounts)}</td>
                    <td className={styles.num}>{summary.costLines}</td>
                    <td className={styles.num}>{fmtMoney(summary.ctsTotal)}</td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.downloadBtn}
                          onClick={e => { e.stopPropagation(); download(entry); }}
                          title="Download this SIA's details and cost lines as an Excel workbook"
                        >
                          Download Excel
                        </button>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={e => { e.stopPropagation(); remove(entry); }}
                          title="Remove this load from the history"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={10} className={styles.detailCell}>
                        {(entry.options || []).map(opt => <OptionDetail key={`${opt.optionNumber}-${opt.sheetName}`} opt={opt} />)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OptionDetail({ opt }) {
  const ctsTotal = (opt.costItems || []).reduce((s, it) => s + (typeof it.cts === 'number' ? it.cts : 0), 0);
  // The parsed figures first, then whatever else the header block carried
  // that is not already one of them.
  const facts = [
    ['Sites', fmtNum(opt.siteCount)],
    ['Accounts', fmtNum(opt.accountCount)],
    ['Target GM%', fmtPct(opt.targetGmPct)],
    ['Use Target', opt.useTargetGm == null ? '' : (opt.useTargetGm ? 'Yes' : 'No')],
    ['Solution description', opt.solutionDescription],
  ].filter(([, v]) => v);
  const covered = /^(#?\s*(of\s+)?(sites?|accounts?)|number\s*of\s*(sites?|accounts?)|target\s*gm\s*%?|use\s*target.*|solution\s*description)$/i;
  const extra = (opt.headerDetails || []).filter(d => d.value && !covered.test(d.label.trim()));
  return (
    <div className={styles.option}>
      <div className={styles.optionTitle}>
        {opt.sheetName || `Option ${opt.optionNumber}`}
        {opt.hidden && <span className={styles.hiddenTag}>hidden sheet</span>}
      </div>
      {(facts.length > 0 || extra.length > 0) && (
        <dl className={styles.details}>
          {[...facts, ...extra.map(d => [d.label, d.value])].map(([k, v], i) => (
            <Fragment key={`${k}-${i}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {(opt.costItems || []).length === 0 ? (
        <div className={styles.empty}>No cost lines on this option.</div>
      ) : (
        <table className={styles.itemTable}>
          <thead>
            <tr>
              <th>Section</th>
              <th>Line Item</th>
              <th>Type</th>
              <th className={styles.num}>CTS</th>
              <th className={styles.num}>GM%</th>
              <th>Start Month</th>
              <th>Comments</th>
            </tr>
          </thead>
          <tbody>
            {opt.costItems.map((it, i) => (
              <tr key={i}>
                <td>{it.section}</td>
                <td>{it.description}</td>
                <td>{it.type}</td>
                <td className={styles.num}>{fmtMoney(it.cts)}</td>
                <td className={styles.num}>{fmtPct(it.gmPct)}</td>
                <td>{it.startMonth}</td>
                <td>{it.comments}</td>
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td colSpan={3}>Total</td>
              <td className={styles.num}>{fmtMoney(ctsTotal)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      )}
      {(opt.altFees || []).length > 0 && (
        <table className={styles.itemTable}>
          <thead>
            <tr>
              <th>Alternative Fee</th>
              <th>Type</th>
              <th className={styles.num}>Fee</th>
              <th>Unit</th>
              <th className={styles.num}>Units</th>
              <th className={styles.num}>Start Month</th>
            </tr>
          </thead>
          <tbody>
            {opt.altFees.map((a, i) => (
              <tr key={i}>
                <td>{a.altItem}</td>
                <td>{a.type}</td>
                <td className={styles.num}>{fmtMoney(a.fee)}</td>
                <td>{a.unit}</td>
                <td className={styles.num}>{fmtNum(a.unitCount)}</td>
                <td className={styles.num}>{fmtNum(a.startMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
