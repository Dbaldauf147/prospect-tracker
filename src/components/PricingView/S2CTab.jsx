import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './S2CTab.module.css';
import {
  S2C_TAG_FIELDS, collectS2cLineItems, countTagged, hasAnyTag,
  s2cTagSuggestions, setS2cTag, setS2cNote, clearS2cTags, s2cNote,
  addS2cLineItem, s2cSuggestionMatches, s2cCellMatches,
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

// A plain text cell: commits on blur, reverts on Escape. The worksheet's cost
// cells and the Notes column use it. The three tag columns don't — they get
// the predictive list below.
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

// The tallest a suggestion list gets, and roughly what one option costs —
// enough to ask for only the room the options actually need, so a two-option
// list doesn't flip above the box over a shortfall it doesn't have.
const COMBO_LIST_MAX = 240;
const COMBO_OPTION_H = 27;

const comboListHeight = (count) => Math.min(COMBO_LIST_MAX, count * COMBO_OPTION_H + 10);

// Where a suggestion list goes.
//
// It can't go where it belongs — inside the cell. The table scrolls inside
// .gridWrap and the page scrolls inside .wrapper, so a list positioned in the
// cell is clipped by both, and the rows nearest the bottom (the ones with the
// most list to show) lose all of it. So it is fixed to the viewport and put
// back under its own box whenever anything scrolls or resizes.
function useComboAnchor(open, inputRef, wanted) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    // Nothing to place while closed, and nothing to clear either: the list is
    // only rendered while open, and this runs before paint, so the next open
    // has its new position in hand before anything is drawn at the old one.
    if (!open) return undefined;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const base = { left: r.left, width: Math.max(r.width, 200) };
      // Below unless it genuinely doesn't fit there and fits better above.
      setPos(below < wanted && r.top > below
        ? { ...base, bottom: window.innerHeight - r.top + 2 }
        : { ...base, top: r.bottom + 2 });
    };
    place();
    // Capture, so scrolling either of the two nested scroll containers counts
    // and not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, inputRef, wanted]);

  return pos;
}

// The list itself, shared by the tag cells and the column filters.
function ComboList({ pos, options, active, onPick, onHover, footer }) {
  const listRef = useRef(null);

  // Keep the highlighted option in view while ↑/↓ walk past the edge.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!pos) return null;
  return (
    <div className={styles.comboList} style={pos} role="listbox" ref={listRef}>
      {options.map((opt, i) => (
        <div
          key={opt}
          role="option"
          aria-selected={i === active}
          data-active={i === active ? 'true' : undefined}
          className={i === active ? styles.comboOptionOn : styles.comboOption}
          // mousedown, not click: the input's blur would tear the list down
          // before a click ever landed on it.
          onMouseDown={(e) => { e.preventDefault(); onPick(opt); }}
          onMouseEnter={() => onHover(i)}
        >{opt}</div>
      ))}
      {footer}
    </div>
  );
}

// A tag cell: type anything, or pick what the column already uses.
//
// The suggestions were a native <datalist> before this. A datalist shows
// nothing until you have typed, and gives no sign at all that it is there —
// so the vocabulary a column had built up was invisible to the next person
// filling one in, which was the one job it had. This is the same list, shown:
// focusing a cell offers the whole column, typing narrows it.
//
// Free text is still the point, and survives the change intact. ↓ walks into
// the suggestions, but nothing is highlighted until it does, so Enter commits
// exactly what was typed — a tag nobody has used yet is added by writing it.
function TagCombo({ value, suggestions, onCommit, placeholder, ariaLabel, inputClass, live }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  // The committed intent, readable from a blur handler that fires in the same
  // event as the write that caused it — `draft` is still last render's value
  // there, and committing that would undo the pick.
  const draftRef = useRef(initial);

  const write = (v) => {
    draftRef.current = v;
    setDraft(v);
    // The add-line-item form needs every keystroke: it has to know what is in
    // its boxes when the Add button is pressed, not what was in them at the
    // last blur. Cells stay commit-on-blur — a tag map rewritten per keystroke
    // is a tag map saved per keystroke.
    if (live) onCommit(v);
  };

  // Before anything is typed the whole column is on offer, so a focused cell
  // that already holds a value still shows what else it could hold.
  const options = useMemo(
    () => s2cSuggestionMatches(suggestions || [], typed ? draft : '').slice(0, 50),
    [suggestions, typed, draft],
  );

  // The footer line stands in for an option's worth of room when there are no
  // options, so an empty list still gets placed somewhere it can be read.
  const pos = useComboAnchor(open, inputRef, comboListHeight(options.length || 2));

  const pick = (v) => { write(v); setOpen(false); inputRef.current?.blur(); };

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // -1 is "nothing highlighted", and the list wraps back through it: there
      // is always a way back to committing what you typed.
      setActive((i) => {
        const n = i + step;
        if (n < -1) return options.length - 1;
        if (n >= options.length) return -1;
        return n;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && options[active] != null) write(options[active]);
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      write(initial);
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.comboWrap}>
      <input
        ref={inputRef}
        type="text"
        className={inputClass || styles.input}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={draft}
        placeholder={placeholder || ''}
        onFocus={() => { setTyped(false); setActive(-1); setOpen(true); }}
        onChange={(e) => { setTyped(true); setActive(-1); setOpen(true); write(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          if (!live && draftRef.current !== initial) onCommit(draftRef.current);
        }}
      />
      {open && (
        <ComboList
          pos={pos}
          options={options}
          active={active}
          onPick={pick}
          onHover={setActive}
          footer={options.length === 0 ? (
            <div className={styles.comboEmpty}>
              {(suggestions || []).length
                ? `Nothing used here matches “${draft.trim()}” — Enter adds it as a new tag.`
                : 'Nothing tagged in this column yet — type the first one.'}
            </div>
          ) : null}
        />
      )}
    </div>
  );
}

// One column's own filter, sitting under its heading.
//
// Same predictive list as the cells above it, and for the same reason: the
// question a mapping table gets asked is "what is tagged Sourcing", and
// answering it should not mean remembering how Sourcing was spelled. It stays
// a text box rather than a dropdown, so half a name narrows too, and a column
// with nothing in it yet (Notes) is just a text box.
function ColumnFilter({ value, onChange, suggestions, placeholder, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);

  const list = useMemo(() => suggestions || [], [suggestions]);
  const options = useMemo(() => s2cSuggestionMatches(list, value).slice(0, 50), [list, value]);
  const pos = useComboAnchor(open, inputRef, comboListHeight(options.length));

  const pick = (v) => { onChange(v); setOpen(false); inputRef.current?.blur(); };

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const n = i + step;
        if (n < -1) return options.length - 1;
        if (n >= options.length) return -1;
        return n;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && options[active] != null) pick(options[active]);
      else { setOpen(false); e.currentTarget.blur(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onChange('');
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  return (
    <div className={styles.filterWrap}>
      <input
        ref={inputRef}
        type="text"
        className={value ? styles.filterInputOn : styles.filterInput}
        role={list.length ? 'combobox' : undefined}
        aria-expanded={list.length ? open : undefined}
        aria-autocomplete={list.length ? 'list' : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onFocus={() => { setActive(-1); if (list.length) setOpen(true); }}
        onChange={(e) => { setActive(-1); if (list.length) setOpen(true); onChange(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setOpen(false); setActive(-1); }}
      />
      {value && (
        <button
          type="button"
          className={styles.filterClear}
          aria-label={`Clear the ${ariaLabel} filter`}
          title="Clear this column filter"
          onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
        >×</button>
      )}
      {open && options.length > 0 && (
        <ComboList pos={pos} options={options} active={active} onPick={pick} onHover={setActive} />
      )}
    </div>
  );
}

const BLANK_DRAFT = { lineItem: '', serviceSegment: '', productName: '', deliverable: '', notes: '' };
const BLANK_COL_FILTERS = { lineItem: '', serviceSegment: '', productName: '', deliverable: '', notes: '' };

// The SIA line items, with the three tags that say what each one is for.
//
// Modelled on the Linked To page, and for the same reason: the workbook says
// what a line item costs, not which part of the business it belongs to.
//
// One row per Line Item, not per (Line Item, Type) row of the workbook. A
// service belongs to one segment whether it bills as a Setup or a Recurring
// cost, so it is asked about once — see utils/s2cTags for why keying the Type
// in was what made the mapping stop applying to the next SIA.
//
// A line item the current workbook no longer carries but that still has tags
// keeps its row, marked as such — otherwise the tags are invisible and there
// is no way to clear them. A line item no workbook ever carried can be added
// by hand, and lands in exactly the same place: the mapping is not the
// workbook's to decide, it only happens to be where most of it comes from.
function SiaLineItemTags({ workbook, tags, setTag, setNote, clearTags, addLineItem }) {
  const [filter, setFilter] = useState('');
  const [taggedOnly, setTaggedOnly] = useState(false);
  const [colFilters, setColFilters] = useState(BLANK_COL_FILTERS);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [addError, setAddError] = useState('');
  const [flash, setFlash] = useState('');

  const pairs = useMemo(() => collectS2cLineItems({
    options: workbook?.options || [],
    tags,
  }), [workbook, tags]);

  const suggestionsByField = useMemo(() => {
    const out = {};
    for (const f of S2C_TAG_FIELDS) out[f.key] = s2cTagSuggestions(tags, f.key);
    return out;
  }, [tags]);

  // The Line Item column filter suggests the names on the table, which is the
  // one column whose vocabulary comes from the workbook rather than from what
  // has been typed into it.
  const lineItemNames = useMemo(() => pairs.map(p => p.lineItem).filter(Boolean), [pairs]);

  const setCol = (key, value) => setColFilters(prev => ({ ...prev, [key]: value }));
  const clearFilters = () => { setColFilters(BLANK_COL_FILTERS); setFilter(''); setTaggedOnly(false); };

  const filtered = filter.trim() !== ''
    || taggedOnly
    || Object.values(colFilters).some(v => v.trim() !== '');

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return pairs.filter(p => {
      const entry = tags?.[p.key] || {};
      if (taggedOnly && !hasAnyTag(entry)) return false;
      // Each column narrows on its own column only. The box in the toolbar
      // above still searches across all of them — they answer different
      // questions ("where did I write that" vs "show me the Sourcing ones")
      // and both are worth having.
      if (!s2cCellMatches(p.lineItem, colFilters.lineItem)) return false;
      if (S2C_TAG_FIELDS.some(f => !s2cCellMatches(entry[f.key], colFilters[f.key]))) return false;
      if (!s2cCellMatches(s2cNote(entry), colFilters.notes)) return false;
      if (!q) return true;
      return p.lineItem.toLowerCase().includes(q)
        || S2C_TAG_FIELDS.some(f => String(entry[f.key] || '').toLowerCase().includes(q))
        // The note is a column of the table, so the box above it filters on
        // it too — a filter that skips a visible column is a filter that
        // hides rows for no stated reason.
        || s2cNote(entry).toLowerCase().includes(q);
    });
  }, [pairs, tags, filter, taggedOnly, colFilters]);

  const tagged = countTagged(pairs, tags);

  function cancelAdd() {
    setAdding(false);
    setDraft(BLANK_DRAFT);
    setAddError('');
  }

  function submitAdd() {
    const name = draft.lineItem.trim();
    if (!name) { setAddError('Give the line item a name.'); return; }
    // Same rule the store keeps: an entry with neither a tag nor a note has
    // nothing to save, so it would be gone by the next load. Said here rather
    // than letting the row quietly fail to appear.
    const hasContent = S2C_TAG_FIELDS.some(f => draft[f.key].trim() !== '') || draft.notes.trim() !== '';
    if (!hasContent) {
      setAddError('Add at least one tag or a note — there would be nothing to store otherwise.');
      return;
    }
    addLineItem(name, draft);
    setAdding(false);
    setDraft(BLANK_DRAFT);
    setAddError('');
    // A filter still narrowing the table would hide the row that was just
    // typed in, which reads exactly like the add having failed.
    clearFilters();
    setFlash(`Added “${name}”.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  return (
    <section className={styles.siaSection}>
      <h3 className={styles.siaHeading}>
        SIA line items ({tagged} of {pairs.length} tagged)
      </h3>
      <div className={styles.intro}>
        Every Line Item in the uploaded workbook, plus any you add by hand. Tag each with the
        Service Segment, Product Name and Deliverable it belongs to — each column suggests back
        what it already holds, and takes anything new you type. Tags are saved against the line
        item itself — not the row, the Type or the file — so one answer covers its Setup and
        Recurring rows and every option, and it survives a re-upload, removing the SIA, the Clear
        button and parser updates, the same way the Linked To defaults do.
      </div>

      <div className={styles.siaToolbar}>
        <input
          type="text"
          className={styles.siaFilter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search every column…"
        />
        <label className={styles.siaCheck}>
          <input
            type="checkbox"
            checked={taggedOnly}
            onChange={(e) => setTaggedOnly(e.target.checked)}
          />
          Tagged only
        </label>
        <button type="button" className={styles.btn} onClick={() => (adding ? cancelAdd() : setAdding(true))}>
          {adding ? 'Close' : '+ Line item'}
        </button>
        {filtered && (
          <>
            <span className={styles.siaCount}>Showing {shown.length} of {pairs.length}</span>
            <button type="button" className={styles.btn} onClick={clearFilters}>Clear filters</button>
          </>
        )}
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {adding && (
        <div className={styles.addBox}>
          <div className={styles.addRow}>
            <label className={styles.addField}>
              <span className={styles.addLabel}>Line Item</span>
              <input
                type="text"
                className={styles.addInput}
                autoFocus
                value={draft.lineItem}
                placeholder="Name it the way the SIA would"
                onChange={(e) => setDraft(d => ({ ...d, lineItem: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
              />
            </label>
            {S2C_TAG_FIELDS.map(f => (
              <label key={f.key} className={styles.addField}>
                <span className={styles.addLabel}>{f.label}</span>
                <TagCombo
                  live
                  value={draft[f.key]}
                  suggestions={suggestionsByField[f.key]}
                  inputClass={styles.addInput}
                  ariaLabel={f.label}
                  placeholder="Type or pick"
                  onCommit={(v) => setDraft(d => ({ ...d, [f.key]: v }))}
                />
              </label>
            ))}
            <label className={styles.addField}>
              <span className={styles.addLabel}>Notes</span>
              <input
                type="text"
                className={styles.addInput}
                value={draft.notes}
                placeholder="Optional"
                onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
              />
            </label>
          </div>
          <div className={styles.addActions}>
            <button type="button" className={styles.btn} onClick={submitAdd}>Add line item</button>
            <button type="button" className={styles.btn} onClick={cancelAdd}>Cancel</button>
            {addError
              ? <span className={styles.addError}>{addError}</span>
              : (
                <span className={styles.addHint}>
                  A name the workbook already carries fills that row in instead of making a second one.
                </span>
              )}
          </div>
        </div>
      )}

      {pairs.length === 0 ? (
        <div className={styles.siaEmpty}>
          No line items yet — upload a workbook on the Pricing subtab and its line items show up
          here, or add one by hand with “+ Line item”.
        </div>
      ) : (
        <>
          {shown.length === 0 ? (
            <div className={styles.siaEmpty}>
              {taggedOnly && tagged === 0
                ? 'Nothing is tagged yet.'
                : 'No line items match the filters.'}
            </div>
          ) : (
            <div className={styles.gridWrap}>
              <table className={styles.grid}>
                <thead>
                  <tr>
                    <th rowSpan={2} className={styles.costElementHeader}>Line Item</th>
                    <th colSpan={S2C_TAG_FIELDS.length} className={styles.tagGroup}>TAGS</th>
                    <th rowSpan={2} className={styles.siaNotesHeader}>Notes</th>
                    <th rowSpan={3} className={styles.actionCol} />
                  </tr>
                  <tr>
                    {S2C_TAG_FIELDS.map(f => (
                      <th key={f.key} className={styles.tagHeader}>{f.label}</th>
                    ))}
                  </tr>
                  {/* A filter per column, under the heading it filters. */}
                  <tr>
                    <th className={styles.filterHeader}>
                      <ColumnFilter
                        value={colFilters.lineItem}
                        onChange={(v) => setCol('lineItem', v)}
                        suggestions={lineItemNames}
                        ariaLabel="Line Item"
                        placeholder="Filter…"
                      />
                    </th>
                    {S2C_TAG_FIELDS.map(f => (
                      <th key={f.key} className={styles.filterHeaderTag}>
                        <ColumnFilter
                          value={colFilters[f.key]}
                          onChange={(v) => setCol(f.key, v)}
                          suggestions={suggestionsByField[f.key]}
                          ariaLabel={f.label}
                          placeholder="Filter…"
                        />
                      </th>
                    ))}
                    <th className={styles.filterHeader}>
                      <ColumnFilter
                        value={colFilters.notes}
                        onChange={(v) => setCol('notes', v)}
                        suggestions={[]}
                        ariaLabel="Notes"
                        placeholder="Filter…"
                      />
                    </th>
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
                        {S2C_TAG_FIELDS.map(f => (
                          <td key={f.key} className={styles.tagCell}>
                            <TagCombo
                              key={`${pair.key}-${f.key}-${entry[f.key] ?? ''}`}
                              value={entry[f.key]}
                              suggestions={suggestionsByField[f.key]}
                              ariaLabel={`${f.label} for ${pair.lineItem}`}
                              // A dash rather than an example. The examples
                              // read like values on a table where most cells
                              // are empty, and the three of them repeated
                              // down every row drowned out the answers.
                              placeholder="-"
                              onCommit={(v) => setTag(pair.key, f.key, v, pair.lineItem)}
                            />
                          </td>
                        ))}
                        {/* Whatever had to be said about this line item.
                            Stored on the same key as the tags, so it outlives
                            the workbook exactly as they do. */}
                        <td className={styles.siaNoteCell}>
                          <CellInput
                            key={`${pair.key}-notes-${s2cNote(entry)}`}
                            value={s2cNote(entry)}
                            placeholder="-"
                            onCommit={(v) => setNote(pair.key, v, pair.lineItem)}
                          />
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


export function S2CTab({ rows, setRows, workbook, lineItemTags, setLineItemTags }) {
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
          tags={lineItemTags || {}}
          setTag={(key, field, value, label) => setLineItemTags(prev => setS2cTag(prev, key, field, value, label))}
          setNote={(key, value, label) => setLineItemTags(prev => setS2cNote(prev, key, value, label))}
          clearTags={(key) => setLineItemTags(prev => clearS2cTags(prev, key))}
          addLineItem={(lineItem, values) => setLineItemTags(prev => addS2cLineItem(prev, lineItem, values))}
        />
      )}
    </div>
  );
}
