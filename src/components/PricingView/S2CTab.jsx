import { useId, useMemo, useState } from 'react';
import styles from './S2CTab.module.css';
import { S2C_TAG_FIELDS, carryTagsOnPaste, tagSuggestions } from '../../utils/s2cTags';

const EMPTY_ROW = () => ({
  costElement: '',
  // What this cost is for. Free text, suggested from what the sheet already
  // uses — see utils/s2cTags.js. Rows saved before these existed simply have
  // no value for them, which reads as untagged.
  serviceSegment: '',
  productName: '',
  deliverable: '',
  setup: '',      // SET-UP or ONE-OFF ($)
  setupUom: '',   // Cost UoM (Per Site, Per Account, etc.)
  ongoing: '',    // ON-GOING per month ($)
  ongoingUom: '', // Cost UoM
});

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const fmtMoney = (n, dp = 2) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

// Parse tab-separated text from Excel. Expected order matches the
// table left-to-right: Cost Element / SET-UP or ONE-OFF / Cost UoM /
// ON-GOING per month / Cost UoM. Excel-copied blocks may include the
// two-row header banner — skip rows that look like the banner
// ("Cost Element", "COSTS TO SERVE…", "SET-UP…") so the user can paste
// the whole selection without trimming first.
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    const first = cell(0).toLowerCase();
    if (
      first === 'cost element' ||
      first.startsWith('costs to serve') ||
      first.startsWith('set-up') ||
      first.startsWith('set up')
    ) continue;
    out.push({
      ...EMPTY_ROW(),
      costElement: cell(0),
      setup: cell(1),
      setupUom: cell(2),
      ongoing: cell(3),
      ongoingUom: cell(4),
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

// Same cell as above, offering back what the sheet already uses in this
// column. Free text either way — the list is a shortcut, never a constraint.
function TagCellInput({ value, onCommit, listId, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      list={listId}
      className={styles.input}
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

export function S2CTab({ rows, setRows }) {
  const tagListPrefix = useId();
  const safeRows = Array.isArray(rows) && rows.length
    ? rows
    : Array.from({ length: 10 }, EMPTY_ROW);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');

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
  // A paste refreshes the costs; it is not a re-tagging. Rows coming back
  // under a Cost Element that was already tagged keep their tags, so pulling
  // fresh numbers out of Excel doesn't quietly undo the classification work.
  const replaceRows = (newRows) => {
    const carried = carryTagsOnPaste(newRows, safeRows);
    const padded = carried.length < 10
      ? carried.concat(Array.from({ length: 10 - carried.length }, EMPTY_ROW))
      : carried;
    setRows(padded);
  };
  const clearAll = () => {
    const hasData = safeRows.some(r => r.costElement || r.setup || r.setupUom || r.ongoing || r.ongoingUom
      || r.serviceSegment || r.productName || r.deliverable);
    if (!hasData) {
      setRows(Array.from({ length: 10 }, EMPTY_ROW));
      return;
    }
    if (window.confirm('Clear all S2C rows? This cannot be undone.')) {
      setRows(Array.from({ length: 10 }, EMPTY_ROW));
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

  // What each tag column offers back. Keyed by field so the datalists can be
  // rendered once for the whole table rather than per row.
  const suggestionsByField = useMemo(() => {
    const out = {};
    for (const f of S2C_TAG_FIELDS) out[f.key] = tagSuggestions(safeRows, f.key);
    return out;
  }, [safeRows]);

  let setupSum = 0;
  let ongoingSum = 0;
  for (const r of safeRows) {
    const s = toNum(r.setup);
    if (s != null) setupSum += s;
    const o = toNum(r.ongoing);
    if (o != null) ongoingSum += o;
  }

  return (
    <div className={styles.wrapper} onPaste={handleTablePaste}>
      <div className={styles.intro}>
        Costs to Serve worksheet: paste a block straight from Excel (5 columns: Cost Element ·
        SET-UP or ONE-OFF · Cost UoM · ON-GOING per month · Cost UoM). The two-row header banner
        from the source workbook is auto-skipped. Tag each cost with its Service Segment, Product
        Name and Deliverable — typed here, not pasted, and kept when you re-paste the costs.
      </div>

      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Cost Element · SET-UP or ONE-OFF · Cost UoM · ON-GOING per month · Cost UoM.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Implementation\t$2,500\tPer Site\t$25\tPer Site'}
            rows={6}
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

      {S2C_TAG_FIELDS.map(f => (
        <datalist key={f.key} id={`${tagListPrefix}-${f.key}`}>
          {suggestionsByField[f.key].map(v => <option key={v} value={v} />)}
        </datalist>
      ))}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <colgroup>
            <col className={styles.colCostElement} />
            <col className={styles.colTag} />
            <col className={styles.colTag} />
            <col className={styles.colTag} />
            <col className={styles.colSetup} />
            <col className={styles.colSetupUom} />
            <col className={styles.colOngoing} />
            <col className={styles.colOngoingUom} />
            <col className={styles.actionCol} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.costElementHeader}>Cost Element</th>
              <th colSpan={S2C_TAG_FIELDS.length} className={styles.tagGroup} title="What this cost is for. Free text — each column suggests what the sheet already uses. Tags survive a re-paste when the Cost Element comes back under the same name.">TAGS</th>
              <th colSpan={4} className={styles.s2cGroup}>COSTS TO SERVE (includes Tech Depreciation)</th>
              <th rowSpan={2} className={styles.actionCol} />
            </tr>
            <tr>
              {S2C_TAG_FIELDS.map(f => (
                <th key={f.key} className={styles.tagHeader}>{f.label}</th>
              ))}
              <th className={styles.s2cHeader}>SET-UP<br/>or ONE-OFF</th>
              <th className={styles.s2cHeader}>Cost UoM</th>
              <th className={styles.s2cHeader}>ON-GOING<br/>per month</th>
              <th className={styles.s2cHeader}>Cost<br/>UoM</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, idx) => {
              const setupNum = toNum(row.setup);
              const ongoingNum = toNum(row.ongoing);
              const setupDisplay = setupNum != null ? fmtMoney(setupNum) : (row.setup ?? '');
              const ongoingDisplay = ongoingNum != null ? fmtMoney(ongoingNum) : (row.ongoing ?? '');
              const k = `${idx}-${row.costElement}-${row.setup}-${row.setupUom}-${row.ongoing}-${row.ongoingUom}`;
              return (
                <tr key={idx}>
                  <td className={styles.tan}>
                    <CellInput key={`ce-${k}`} value={row.costElement} onCommit={(v) => updateRow(idx, 'costElement', v)} />
                  </td>
                  {S2C_TAG_FIELDS.map(f => (
                    <td key={f.key} className={styles.tagCell}>
                      <TagCellInput
                        key={`${f.key}-${idx}-${row[f.key] ?? ''}`}
                        value={row[f.key]}
                        listId={`${tagListPrefix}-${f.key}`}
                        placeholder={f.placeholder}
                        onCommit={(v) => updateRow(idx, f.key, v)}
                      />
                    </td>
                  ))}
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`su-${k}`} value={setupDisplay} align="right" onCommit={(v) => updateRow(idx, 'setup', v)} />
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`suu-${k}`} value={row.setupUom} onCommit={(v) => updateRow(idx, 'setupUom', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`og-${k}`} value={ongoingDisplay} align="right" onCommit={(v) => updateRow(idx, 'ongoing', v)} />
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`ogu-${k}`} value={row.ongoingUom} onCommit={(v) => updateRow(idx, 'ongoingUom', v)} />
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
              {S2C_TAG_FIELDS.map(f => <td key={f.key} />)}
              <td className={styles.numCell}>{setupSum > 0 ? fmtMoney(setupSum) : ''}</td>
              <td />
              <td className={styles.numCell}>{ongoingSum > 0 ? fmtMoney(ongoingSum) : ''}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
