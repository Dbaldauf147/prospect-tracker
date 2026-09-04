import { useId, useMemo, useState } from 'react';
import styles from './S2CTab.module.css';
import {
  S2C_TAG_FIELDS, collectS2cLineItems, countTagged, hasAnyTag,
  s2cTagSuggestions, setS2cTag, clearS2cTags,
} from '../../utils/s2cTags';

const EMPTY_ROW = () => ({
  costElement: '',
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
      costElement: cell(0),
      setup: cell(1),
      setupUom: cell(2),
      ongoing: cell(3),
      ongoingUom: cell(4),
    });
  }
  return out;
}

// `listId` attaches a datalist: the tag columns suggest back what has already
// been used, while staying free text. The cost cells pass none.
function CellInput({ value, onCommit, align, placeholder, listId }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      list={listId}
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

// The SIA line items, with the three tags that say what each one is for.
//
// Modelled on the Linked To page, and for the same reason: the workbook says
// what a line item costs, not which part of the business it belongs to. Tags
// are keyed by (Line Item, Type) rather than by row, so the answer is given
// once and holds across every option and every later upload of the same sheet.
//
// A line item the current workbook no longer carries but that still has tags
// keeps its row, marked as such — otherwise the tags are invisible and there
// is no way to clear them.
function SiaLineItemTags({ workbook, activeOption, tags, setTag, clearTags, effectiveType }) {
  const listPrefix = useId();
  const [filter, setFilter] = useState('');
  const [taggedOnly, setTaggedOnly] = useState(false);

  const activeOpt = workbook?.options?.find(o => o.optionNumber === activeOption)
    || workbook?.options?.[0];

  const pairs = useMemo(() => collectS2cLineItems({
    options: workbook?.options || [],
    tags,
    activeOptionNumber: activeOpt?.optionNumber,
    typeOf: effectiveType,
  }), [workbook, tags, activeOpt, effectiveType]);

  const suggestionsByField = useMemo(() => {
    const out = {};
    for (const f of S2C_TAG_FIELDS) out[f.key] = s2cTagSuggestions(tags, f.key);
    return out;
  }, [tags]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return pairs.filter(p => {
      if (taggedOnly && !hasAnyTag(tags?.[p.key])) return false;
      if (!q) return true;
      const entry = tags?.[p.key] || {};
      return p.lineItem.toLowerCase().includes(q)
        || String(p.type || '').toLowerCase().includes(q)
        || S2C_TAG_FIELDS.some(f => String(entry[f.key] || '').toLowerCase().includes(q));
    });
  }, [pairs, tags, filter, taggedOnly]);

  const tagged = countTagged(pairs, tags);

  return (
    <section className={styles.siaSection}>
      <h3 className={styles.siaHeading}>
        SIA line items ({tagged} of {pairs.length} tagged)
      </h3>
      <div className={styles.intro}>
        Every Line Item + Type pair in the uploaded workbook. Tag each with the Service Segment,
        Product Name and Deliverable it belongs to. Tags are saved against the pair, not the row —
        so one answer covers every option, and it survives a re-upload, the Clear button and parser
        updates, the same way the Linked To defaults do.
      </div>

      {S2C_TAG_FIELDS.map(f => (
        <datalist key={f.key} id={`${listPrefix}-${f.key}`}>
          {suggestionsByField[f.key].map(v => <option key={v} value={v} />)}
        </datalist>
      ))}

      {pairs.length === 0 ? (
        <div className={styles.siaEmpty}>
          No line items yet — upload a workbook on the Pricing subtab and its line items show up here.
        </div>
      ) : (
        <>
          <div className={styles.siaToolbar}>
            <input
              type="text"
              className={styles.siaFilter}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter line items…"
            />
            <label className={styles.siaCheck}>
              <input
                type="checkbox"
                checked={taggedOnly}
                onChange={(e) => setTaggedOnly(e.target.checked)}
              />
              Tagged only
            </label>
          </div>
          {shown.length === 0 ? (
            <div className={styles.siaEmpty}>
              {taggedOnly && tagged === 0
                ? 'Nothing is tagged yet.'
                : 'No line items match the filter.'}
            </div>
          ) : (
            <div className={styles.gridWrap}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th rowSpan={2} className={styles.costElementHeader}>Line Item</th>
                    <th rowSpan={2} className={styles.siaMetaHeader}>Type</th>
                    <th colSpan={S2C_TAG_FIELDS.length} className={styles.tagGroup}>TAGS</th>
                    <th rowSpan={2} className={styles.siaMetaHeader}>CTS ({activeOpt?.sheetName || 'active option'})</th>
                    <th rowSpan={2} className={styles.siaMetaHeader}>On options</th>
                    <th rowSpan={2} className={styles.actionCol} />
                  </tr>
                  <tr>
                    {S2C_TAG_FIELDS.map(f => (
                      <th key={f.key} className={styles.tagHeader}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(pair => {
                    const entry = tags?.[pair.key] || {};
                    return (
                      <tr key={pair.key}>
                        <td className={styles.siaCell}>
                          {pair.lineItem || <span className={styles.siaMuted}>-</span>}
                          {workbook && !pair.reachable && (
                            <span className={styles.siaMuted}> · not in this workbook</span>
                          )}
                        </td>
                        <td className={styles.siaCell}>
                          <span className={styles.siaType} title={pair.type || ''}>
                            {pair.type || <span className={styles.siaMuted}>-</span>}
                          </span>
                        </td>
                        {S2C_TAG_FIELDS.map(f => (
                          <td key={f.key} className={styles.tagCell}>
                            <CellInput
                              key={`${pair.key}-${f.key}-${entry[f.key] ?? ''}`}
                              value={entry[f.key]}
                              listId={`${listPrefix}-${f.key}`}
                              placeholder={f.placeholder}
                              onCommit={(v) => setTag(pair.key, f.key, v)}
                            />
                          </td>
                        ))}
                        <td className={`${styles.siaCell} ${styles.numCell}`}>
                          {pair.activeCts == null
                            ? <span className={styles.siaMuted}>-</span>
                            : fmtMoney(pair.activeCts)}
                        </td>
                        <td className={styles.siaCell}>
                          {pair.options.length === 0
                            ? <span className={styles.siaMuted}>-</span>
                            : pair.options.join(', ')}
                        </td>
                        <td className={styles.actionCell}>
                          {hasAnyTag(entry) && (
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() => clearTags(pair.key)}
                              title="Clear all three tags on this line item"
                            >×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function S2CTab({ rows, setRows, workbook, activeOption, lineItemTags, setLineItemTags, effectiveType }) {
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
  const replaceRows = (newRows) => {
    const padded = newRows.length < 10
      ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
      : newRows;
    setRows(padded);
  };
  const clearAll = () => {
    const hasData = safeRows.some(r => r.costElement || r.setup || r.setupUom || r.ongoing || r.ongoingUom);
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
        from the source workbook is auto-skipped.
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

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <colgroup>
            <col className={styles.colCostElement} />
            <col className={styles.colSetup} />
            <col className={styles.colSetupUom} />
            <col className={styles.colOngoing} />
            <col className={styles.colOngoingUom} />
            <col className={styles.actionCol} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.costElementHeader}>Cost Element</th>
              <th colSpan={4} className={styles.s2cGroup}>COSTS TO SERVE (includes Tech Depreciation)</th>
              <th rowSpan={2} className={styles.actionCol} />
            </tr>
            <tr>
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
              <td className={styles.numCell}>{setupSum > 0 ? fmtMoney(setupSum) : ''}</td>
              <td />
              <td className={styles.numCell}>{ongoingSum > 0 ? fmtMoney(ongoingSum) : ''}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {setLineItemTags && (
        <SiaLineItemTags
          workbook={workbook}
          activeOption={activeOption}
          tags={lineItemTags || {}}
          effectiveType={effectiveType}
          setTag={(key, field, value) => setLineItemTags(prev => setS2cTag(prev, key, field, value))}
          clearTags={(key) => setLineItemTags(prev => clearS2cTags(prev, key))}
        />
      )}
    </div>
  );
}
