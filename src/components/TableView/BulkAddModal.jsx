import { useState, useMemo, useRef, useEffect } from 'react';
import { companyDedupeKey } from '../../utils/firestoreSync';
import { STATUSES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, FRAMEWORKS } from '../../data/enums';
import { buildTypeOptions, buildCdmOptions, buildAssetTypeOptions, buildStrategyOptions } from '../../utils/prospectOptions';
import { splitPeOwners } from '../../utils/peOwners';
import { FIELDS, autoMap, parseDelimitedRows, cellsToProspect } from './pasteFields';

// Defaults a bulk-added company starts with, matching what the single
// "+ Add" popup pre-fills (see EMPTY in ProspectModal) so a company
// created either way lands in the same shape.
const BULK_DEFAULTS = {
  status: 'Inside Sales',
  tier: 'Tier 3',
  cdm: '',
  type: '',
  geography: '',
  publicPrivate: '',
};

// Fields the shared-values row always offers, as dropdowns. Whatever is
// picked here is stamped on every company in the list that doesn't bring
// its own value from a mapped column — the point of the bulk add is that
// a batch usually shares its CDM / type / status. Any other field can be
// added to the row from the picker beside them (see EXTRA_FIELDS).
const SHARED_FIELDS = [
  { key: 'status', label: 'Status', options: STATUSES },
  { key: 'cdm', label: 'CDM', dynamic: 'cdm' },
  { key: 'type', label: 'Type', dynamic: 'type' },
  { key: 'tier', label: 'Tier', options: TIERS },
  { key: 'geography', label: 'Geography', options: GEOGRAPHIES },
  { key: 'publicPrivate', label: 'Pub/Priv', options: PUBLIC_PRIVATE },
];
const FIXED_SHARED = new Set(SHARED_FIELDS.map(f => f.key));

// Everything else a pasted column can land in is also settable for the
// whole batch — PE Owner for a portfolio list, Frameworks for a
// compliance list, and so on. Same vocabulary as the column mapper, so
// the two halves of the modal can't offer different fields.
const EXTRA_FIELDS = FIELDS.filter(f => f.key !== 'company' && !FIXED_SHARED.has(f.key));

// Values already on the roster for a field, offered as type-ahead
// suggestions so a batch's PE Owner / HQ Region / Rank matches what is
// already there instead of introducing a near-miss spelling.
function suggestionsFor(key, prospects) {
  const vals = new Set();
  for (const p of prospects || []) {
    const v = p?.[key];
    if (Array.isArray(v)) {
      for (const item of v) if (String(item || '').trim()) vals.add(String(item).trim());
    } else if (String(v ?? '').trim()) {
      // PE Owner holds a comma-separated list of firms in one string.
      if (key === 'peOwner') for (const owner of splitPeOwners(v)) vals.add(owner);
      else vals.add(String(v).trim());
    }
  }
  return [...vals].sort((a, b) => a.localeCompare(b)).slice(0, 300);
}

// One added shared field: a value editor matched to the field's type,
// with the roster's existing values (plus the built-in vocabulary for
// tag fields) as datalist suggestions.
function ExtraSharedField({ field, value, onChange, onRemove, disabled, overridden, prospects, vocab }) {
  const listId = `bulk-shared-${field.key}`;
  const options = useMemo(() => {
    const known = vocab?.[field.key] || [];
    return [...new Set([...known, ...suggestionsFor(field.key, prospects)])];
  }, [field.key, prospects, vocab]);
  const isList = field.type === 'list' || field.type === 'frameworks';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {field.label}
        {overridden && <span style={{ fontWeight: 400, fontStyle: 'italic' }}>(paste wins)</span>}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${field.label}`}
          style={{ border: 'none', background: 'none', color: '#94A3B8', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
        >×</button>
      </span>
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value}
        disabled={disabled}
        list={options.length ? listId : undefined}
        onChange={e => onChange(e.target.value)}
        placeholder={isList ? 'comma separated' : ''}
        style={{ padding: '0.3rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', minWidth: 150, background: '#fff', color: '#1E293B', fontWeight: 400 }}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map(o => <option key={o} value={o} />)}
        </datalist>
      )}
    </label>
  );
}

// One pasted line -> one company name. Tolerates the shapes a name list
// actually arrives in: a comma-separated list on one line, numbered or
// bulleted lists, and cells Excel wrapped in quotes.
function parseLine(line) {
  let s = String(line || '').trim();
  if (!s) return '';
  s = s.replace(/^[-*•·▪●]\s+/, '');                       // bullet
  s = s.replace(/^\d+[.)]\s+/, '');                        // "1. " / "1) "
  s = s.replace(/,\s*$/, '').trim();                       // trailing comma
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"').trim();
  }
  return s;
}

// Split one line on its commas, ignoring commas inside double quotes so
// a quoted cell keeps a comma that belongs to the name ("Wayne, Inc.").
function splitOnCommas(line) {
  const parts = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; cur += ch; continue; }
    if (ch === ',' && !inQuotes) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// Split a name-list paste (no columns) into candidate names. Newlines
// are the primary separator; a single line holding a comma list
// ("Acme, Globex, Initech") is split on commas so a one-line paste
// still works.
function parseNames(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.includes(',')) {
      for (const part of splitOnCommas(line)) {
        const name = parseLine(part);
        if (name) out.push(name);
      }
      continue;
    }
    const name = parseLine(line);
    if (name) out.push(name);
  }
  return out;
}

// A pasted table's first row is a header when any of its cells names a
// Table View field ("Company", "HQ", "CDM", …). Data rows are company
// names and free text, which don't match the field vocabulary.
function looksLikeHeader(row) {
  return (row || []).some(cell => autoMap(cell));
}

// Mass-add companies for Table View. Sits behind the "+ Add" split
// button's "Multiple companies…" item, next to the single-company popup.
//
// Two shapes of paste are handled from the one box. A plain list of
// names (one per line) adds them as-is. A table copied out of Excel or
// Google Sheets — anything with tab-separated columns — switches on the
// column mapper: each pasted column gets a dropdown naming the Table
// View field it lands in, auto-picked where the header matches, and a
// header row is detected and dropped rather than being read as a
// company. Either way, companies already on the roster and repeats
// inside the paste are listed as skipped rather than duplicated.
export function BulkAddModal({ existingProspects = [], onAdd, onClose, settings }) {
  const [text, setText] = useState('');
  const [shared, setShared] = useState(BULK_DEFAULTS);
  // Fields added to the shared row beyond the six fixed dropdowns, in the
  // order they were added: [{ key, value }].
  const [extras, setExtras] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null);     // { added, failed: [] }
  // Per-column mapping overrides, keyed by column index; the auto-mapping
  // shows through wherever the user hasn't picked something else.
  const [mapOverrides, setMapOverrides] = useState({});
  const [headerOverride, setHeaderOverride] = useState(null); // null = auto-detect
  const textareaRef = useRef(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const typeOptions = useMemo(() => buildTypeOptions(existingProspects, settings), [existingProspects, settings]);
  const cdmOptions = useMemo(() => buildCdmOptions(existingProspects, settings), [existingProspects, settings]);
  // Built-in vocabularies for the tag fields, so an added Asset Types /
  // Frameworks / Strategies row suggests the real options rather than
  // only what the roster happens to use already.
  const vocab = useMemo(() => ({
    assetTypes: buildAssetTypeOptions(existingProspects, settings),
    strategies: buildStrategyOptions(existingProspects, settings),
    frameworks: FRAMEWORKS,
  }), [existingProspects, settings]);

  // A tab anywhere in the paste means columns, which is the one thing a
  // typed list of names never contains.
  const isTable = text.includes('\t');

  // Columns mode: the raw grid as pasted, before any header decision.
  const grid = useMemo(() => {
    if (!isTable) return null;
    const rows = parseDelimitedRows(text, '\t')
      .map(r => r.map(c => String(c ?? '').trim()))
      .filter(r => r.some(c => c));
    if (rows.length === 0) return null;
    return { rows, colCount: rows.reduce((n, r) => Math.max(n, r.length), 0) };
  }, [isTable, text]);

  // A new paste re-detects everything: stale column picks and a stale
  // header decision belong to the paste they were made against, and
  // column 3 of the old paste has nothing to do with column 3 of the
  // new one. Keyed on the pasted shape rather than on the header
  // decision, so ticking the checkbox keeps the picks.
  const shapeKey = grid ? `${grid.colCount}|${grid.rows[0].join('|')}` : '';
  useEffect(() => {
    setMapOverrides({});
    setHeaderOverride(null);
  }, [shapeKey]);

  // Where row 0 is a header, what the data rows are, and the mapping
  // auto-picked from the header text.
  const table = useMemo(() => {
    if (!grid) return null;
    const { rows, colCount } = grid;
    const detectedHeader = looksLikeHeader(rows[0]);
    const hasHeader = headerOverride == null ? detectedHeader : headerOverride;
    const headers = hasHeader ? rows[0] : [];
    const dataRows = hasHeader ? rows.slice(1) : rows;
    // Without a header there's nothing to match on, so the first column
    // is the company (that's the shape of a pasted name column).
    const auto = Array.from({ length: colCount }, (_, i) => (hasHeader ? autoMap(headers[i]) : (i === 0 ? 'company' : '')));
    return { colCount, headers, dataRows, hasHeader, detectedHeader, auto };
  }, [grid, headerOverride]);

  const mapping = useMemo(() => {
    if (!table) return [];
    return table.auto.map((key, i) => (Object.prototype.hasOwnProperty.call(mapOverrides, i) ? mapOverrides[i] : key));
  }, [table, mapOverrides]);

  const companyMapped = mapping.includes('company');
  // The mapped fields other than Company, in FIELDS order, for the preview.
  const extraFields = useMemo(() => {
    const keys = new Set(mapping.filter(k => k && k !== 'company'));
    return FIELDS.filter(f => keys.has(f.key));
  }, [mapping]);

  const availableExtras = useMemo(
    () => EXTRA_FIELDS.filter(f => !extras.some(e => e.key === f.key)),
    [extras]
  );

  // The shared values as a prospect patch. Only what was actually filled
  // in is written, so a blank dropdown leaves the field empty rather than
  // stamping ''. Added fields go through the same typing as a pasted
  // cell, so "Hotels, Retail" lands as tags and "12" as a number.
  const sharedRecord = useMemo(() => {
    const out = {};
    for (const [key, val] of Object.entries(shared)) {
      if (String(val || '').trim()) out[key] = val;
    }
    for (const { key, value } of extras) {
      if (!key || !String(value || '').trim()) continue;
      Object.assign(out, cellsToProspect([value], [key]));
    }
    return out;
  }, [shared, extras]);

  // Classify every pasted row against the roster (and against the
  // earlier rows of the paste) so the button can say exactly how many
  // companies it is about to create before it is clicked.
  const plan = useMemo(() => {
    const existing = new Map();
    for (const p of existingProspects || []) {
      const key = companyDedupeKey(p?.company);
      if (key && !existing.has(key)) existing.set(key, p.company);
    }
    const seen = new Set();
    const rows = [];

    // Both modes produce the same thing: a record per pasted row. The
    // name list only ever fills `company`; the column mapper fills
    // whatever the user mapped.
    const records = table
      ? (companyMapped ? table.dataRows.map(cells => cellsToProspect(cells, mapping)) : [])
      : parseNames(text).map(name => ({ company: name }));

    for (const record of records) {
      const name = String(record.company || '').trim();
      const key = companyDedupeKey(name);
      let state = 'new';
      let note = '';
      if (!key) {
        state = 'skip';
        note = name ? 'not a company name' : 'no company in this row';
      } else if (existing.has(key)) {
        state = 'existing';
        note = `already in Table View as "${existing.get(key)}"`;
      } else if (seen.has(key)) {
        state = 'repeat';
        note = 'repeated in this list';
      } else {
        seen.add(key);
      }
      rows.push({ record, name, state, note });
    }
    return {
      rows,
      toAdd: rows.filter(r => r.state === 'new').map(r => r.record),
      existing: rows.filter(r => r.state === 'existing').length,
      repeats: rows.filter(r => r.state === 'repeat').length,
      skipped: rows.filter(r => r.state === 'skip').length,
    };
  }, [text, existingProspects, table, mapping, companyMapped]);

  async function handleAdd() {
    if (busy || plan.toAdd.length === 0) return;
    setBusy(true);
    setResult(null);
    const failed = [];
    let added = 0;
    try {
      for (const record of plan.toAdd) {
        setProgress({ done: added + failed.length, total: plan.toAdd.length });
        try {
          await onAdd({ ...sharedRecord, ...record });
          added++;
        } catch (err) {
          console.error('Bulk add failed for', record.company, err);
          failed.push(record.company);
        }
      }
      setResult({ added, failed });
      // Leave only what still needs doing in the box. The roster prop
      // takes a beat to catch up with the writes, so without this the
      // just-added names still read as "new" and the button invites a
      // second click; the failures stay so they can be retried.
      setText(failed.join('\n'));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const stateStyles = {
    new: { color: '#166534', background: '#F0FDF4', label: 'New' },
    existing: { color: '#92400E', background: '#FFFBEB', label: 'Skip' },
    repeat: { color: '#92400E', background: '#FFFBEB', label: 'Skip' },
    skip: { color: '#991B1B', background: '#FEF2F2', label: 'Skip' },
  };
  const cell = { padding: '0.3rem 0.5rem', borderBottom: '1px solid #E2E8F0' };
  const canAdd = plan.toAdd.length > 0 && (!table || companyMapped);

  return (
    <div onClick={() => { if (!busy) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(900px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>Add multiple companies</strong>
          <button onClick={() => { if (!busy) onClose(); }} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: busy ? 'not-allowed' : 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
            One company per line, or paste a whole table from Excel — columns are picked up and you say which Table View field each one lands in. Anything already in Table View is skipped, never overwritten.
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
            placeholder={'Acme Properties\nGlobex Realty\nInitech Capital'}
            style={{ width: '100%', minHeight: isTable ? 130 : 200, padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box', background: busy ? '#F8FAFC' : '#fff' }}
          />

          {table && (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.75rem', color: '#1E293B' }}>Columns</strong>
                <span style={{ fontSize: '0.72rem', color: '#475569' }}>{table.dataRows.length} rows · {table.colCount} columns</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#475569', cursor: busy ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={table.hasHeader}
                    disabled={busy}
                    onChange={e => setHeaderOverride(e.target.checked)}
                  />
                  First row is a header
                </label>
                {!companyMapped && <span style={{ fontSize: '0.72rem', color: '#991B1B', fontWeight: 700 }}>Map a column to Company to enable the add</span>}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <tbody>
                    <tr>
                      {mapping.map((dest, i) => (
                        <td key={i} style={{ padding: '0 0.4rem 0.3rem 0', verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 700, color: '#1E293B', whiteSpace: 'nowrap', marginBottom: 2 }}>
                            {table.hasHeader && table.headers[i] ? table.headers[i] : `Column ${i + 1}`}
                          </div>
                          <select
                            value={dest || ''}
                            disabled={busy}
                            onChange={e => setMapOverrides(m => ({ ...m, [i]: e.target.value }))}
                            style={{ padding: '0.25rem 0.4rem', border: `1px solid ${dest ? '#CBD5E1' : '#FCD34D'}`, borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 150, background: dest ? '#fff' : '#FFFBEB' }}
                          >
                            <option value="">(Skip)</option>
                            {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          <div style={{ color: '#64748B', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={table.dataRows[0]?.[i] || ''}>
                            {table.dataRows[0]?.[i] || <span style={{ color: '#CBD5E1' }}>-</span>}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.72rem', color: '#475569' }}>
              Applied to every company added{table ? ', where the paste doesn\u2019t supply its own value' : ''}:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
            {SHARED_FIELDS.map(f => {
              const options = f.dynamic === 'cdm' ? cdmOptions : f.dynamic === 'type' ? typeOptions : f.options;
              const overridden = mapping.includes(f.key);
              return (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                  {f.label}{overridden && <span style={{ fontWeight: 400, fontStyle: 'italic' }}> (paste wins)</span>}
                  <select
                    value={shared[f.key] || ''}
                    disabled={busy}
                    onChange={e => setShared(s => ({ ...s, [f.key]: e.target.value }))}
                    style={{ padding: '0.3rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', minWidth: 130, background: '#fff', color: '#1E293B', fontWeight: 400 }}
                  >
                    <option value="">(blank)</option>
                    {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              );
            })}
            {extras.map(({ key, value }) => {
              const field = EXTRA_FIELDS.find(f => f.key === key);
              if (!field) return null;
              return (
                <ExtraSharedField
                  key={key}
                  field={field}
                  value={value}
                  disabled={busy}
                  overridden={mapping.includes(key)}
                  prospects={existingProspects}
                  vocab={vocab}
                  onChange={v => setExtras(list => list.map(e => (e.key === key ? { ...e, value: v } : e)))}
                  onRemove={() => setExtras(list => list.filter(e => e.key !== key))}
                />
              );
            })}
            {availableExtras.length > 0 && (
              <select
                value=""
                disabled={busy}
                onChange={e => { if (e.target.value) setExtras(list => [...list, { key: e.target.value, value: '' }]); }}
                aria-label="Add another field to apply to every company"
                style={{ padding: '0.3rem 0.4rem', border: '1px dashed #94A3B8', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#F8FAFC', color: '#475569', cursor: busy ? 'not-allowed' : 'pointer', alignSelf: 'flex-end' }}
              >
                <option value="">+ Add another field…</option>
                {availableExtras.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            )}
            </div>
          </div>

          {plan.rows.length > 0 && (
            <>
              <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                <span style={{ color: '#166534', fontWeight: 700 }}>{plan.toAdd.length} new</span>
                {plan.existing > 0 && <> · <span style={{ color: '#92400E' }}>{plan.existing} already in Table View</span></>}
                {plan.repeats > 0 && <> · <span style={{ color: '#92400E' }}>{plan.repeats} repeated in the list</span></>}
                {plan.skipped > 0 && <> · <span style={{ color: '#991B1B' }}>{plan.skipped} unusable</span></>}
              </div>
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                  {extraFields.length > 0 && (
                    <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ ...cell, textAlign: 'left', color: '#475569', width: 52 }}></th>
                        <th style={{ ...cell, textAlign: 'left', color: '#475569' }}>Company</th>
                        {extraFields.map(f => <th key={f.key} style={{ ...cell, textAlign: 'left', color: '#475569', whiteSpace: 'nowrap' }}>{f.label}</th>)}
                        <th style={{ ...cell, textAlign: 'left', color: '#475569' }}></th>
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {plan.rows.map((r, i) => {
                      const s = stateStyles[r.state];
                      return (
                        <tr key={i} style={{ background: r.state === 'new' ? '#fff' : s.background }}>
                          <td style={{ ...cell, width: 52 }}>
                            <span style={{ color: s.color, fontWeight: 700, fontSize: '0.66rem', textTransform: 'uppercase' }}>{s.label}</span>
                          </td>
                          <td style={{ ...cell, fontWeight: 600, color: '#1E293B' }}>{r.name || <span style={{ color: '#CBD5E1' }}>-</span>}</td>
                          {extraFields.map(f => {
                            const v = r.record[f.key];
                            const shown = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
                            return <td key={f.key} style={{ ...cell, color: '#475569', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shown}>{shown || <span style={{ color: '#CBD5E1' }}>-</span>}</td>;
                          })}
                          <td style={{ ...cell, color: '#64748B' }}>{r.note}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div style={{ padding: '0.45rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', background: result.failed.length ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${result.failed.length ? '#FCA5A5' : '#86EFAC'}`, color: result.failed.length ? '#991B1B' : '#166534' }}>
              Added {result.added} compan{result.added === 1 ? 'y' : 'ies'}.
              {result.failed.length > 0 && ` ${result.failed.length} failed: ${result.failed.join(', ')}.`}
            </div>
          )}
        </div>

        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {progress && (
            <span style={{ marginRight: 'auto', fontSize: '0.72rem', color: '#475569' }}>Adding {progress.done + 1}/{progress.total}…</span>
          )}
          <button onClick={() => { if (!busy) onClose(); }} disabled={busy} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {result ? 'Done' : 'Cancel'}
          </button>
          <button
            onClick={handleAdd}
            disabled={busy || !canAdd}
            style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (busy || !canAdd) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (busy || !canAdd) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >
            {busy ? 'Adding…' : `Add ${plan.toAdd.length} compan${plan.toAdd.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
