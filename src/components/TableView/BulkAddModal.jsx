import { useState, useMemo, useRef, useEffect } from 'react';
import { companyDedupeKey } from '../../utils/firestoreSync';
import { STATUSES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE } from '../../data/enums';
import { buildTypeOptions, buildCdmOptions } from '../../utils/prospectOptions';

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

// Fields the shared-values row offers. Whatever is picked here is
// stamped on every company in the list — the point of the bulk add is
// that a batch usually shares its CDM / type / status.
const SHARED_FIELDS = [
  { key: 'status', label: 'Status', options: STATUSES },
  { key: 'cdm', label: 'CDM', dynamic: 'cdm' },
  { key: 'type', label: 'Type', dynamic: 'type' },
  { key: 'tier', label: 'Tier', options: TIERS },
  { key: 'geography', label: 'Geography', options: GEOGRAPHIES },
  { key: 'publicPrivate', label: 'Pub/Priv', options: PUBLIC_PRIVATE },
];

// One pasted line -> one company name. Tolerates the shapes a name list
// actually arrives in: a spreadsheet column (tab-separated, extra cells
// ignored), a comma-separated list on one line, numbered or bulleted
// lists, and cells Excel wrapped in quotes.
function parseLine(line) {
  let s = String(line || '').trim();
  if (!s) return '';
  // A tabbed paste is a spreadsheet column: the company is the first cell.
  if (s.includes('\t')) s = s.split('\t')[0].trim();
  s = s.replace(/^[-*•·▪●]\s+/, '');   // bullet
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

// Split the textarea into candidate names. Newlines are the primary
// separator; a single line holding a comma list ("Acme, Globex, Initech")
// is split on commas so a one-line paste still works. A line with tabs is
// left to parseLine — that's a spreadsheet row, and its later cells are
// other fields, not other companies.
function parseNames(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!line.includes('\t') && line.includes(',')) {
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

// Mass-add companies by name. Sits behind the "+ Add" split button's
// "Multiple companies…" item, next to the single-company popup: paste a
// list of names, optionally stamp shared values (CDM, Status, Type, …)
// on all of them, and every name that isn't already in Table View is
// created. Companies already on the roster — and repeats inside the
// paste itself — are listed as skipped rather than duplicated; the
// heavier column-mapping import stays on Table View's "Paste from
// Excel" button.
export function BulkAddModal({ existingProspects = [], onAdd, onClose, settings }) {
  const [text, setText] = useState('');
  const [shared, setShared] = useState(BULK_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null);     // { added, failed: [] }
  const textareaRef = useRef(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const typeOptions = useMemo(() => buildTypeOptions(existingProspects, settings), [existingProspects, settings]);
  const cdmOptions = useMemo(() => buildCdmOptions(existingProspects, settings), [existingProspects, settings]);

  // Classify every pasted name against the roster (and against the
  // earlier lines of the paste) so the button can say exactly how many
  // companies it is about to create before it is clicked.
  const plan = useMemo(() => {
    const existing = new Map();
    for (const p of existingProspects || []) {
      const key = companyDedupeKey(p?.company);
      if (key && !existing.has(key)) existing.set(key, p.company);
    }
    const seen = new Set();
    const rows = [];
    for (const name of parseNames(text)) {
      const key = companyDedupeKey(name);
      let state = 'new';
      let note = '';
      if (!key) {
        state = 'skip';
        note = 'not a company name';
      } else if (existing.has(key)) {
        state = 'existing';
        note = `already in Table View as "${existing.get(key)}"`;
      } else if (seen.has(key)) {
        state = 'repeat';
        note = 'repeated in this list';
      } else {
        seen.add(key);
      }
      rows.push({ name, state, note });
    }
    return {
      rows,
      toAdd: rows.filter(r => r.state === 'new').map(r => r.name),
      existing: rows.filter(r => r.state === 'existing').length,
      repeats: rows.filter(r => r.state === 'repeat').length,
      skipped: rows.filter(r => r.state === 'skip').length,
    };
  }, [text, existingProspects]);

  async function handleAdd() {
    if (busy || plan.toAdd.length === 0) return;
    setBusy(true);
    setResult(null);
    const failed = [];
    let added = 0;
    try {
      for (const company of plan.toAdd) {
        setProgress({ done: added + failed.length, total: plan.toAdd.length });
        try {
          // Only the shared values actually picked are written, so a
          // blank dropdown leaves the field empty rather than stamping ''.
          const record = { company };
          for (const [key, val] of Object.entries(shared)) {
            if (String(val || '').trim()) record[key] = val;
          }
          await onAdd(record);
          added++;
        } catch (err) {
          console.error('Bulk add failed for', company, err);
          failed.push(company);
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

  return (
    <div onClick={() => { if (!busy) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(760px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>Add multiple companies</strong>
          <button onClick={() => { if (!busy) onClose(); }} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: busy ? 'not-allowed' : 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
            One company per line (a pasted spreadsheet column works too). Anything already in Table View is skipped, never overwritten. Values picked below are applied to every company added — leave one blank to leave that field empty, and everything else can be filled in on the table afterwards.
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
            placeholder={'Acme Properties\nGlobex Realty\nInitech Capital'}
            style={{ width: '100%', minHeight: 200, padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box', background: busy ? '#F8FAFC' : '#fff' }}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {SHARED_FIELDS.map(f => {
              const options = f.dynamic === 'cdm' ? cdmOptions : f.dynamic === 'type' ? typeOptions : f.options;
              return (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                  {f.label}
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
          </div>

          {plan.rows.length > 0 && (
            <>
              <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                <span style={{ color: '#166534', fontWeight: 700 }}>{plan.toAdd.length} new</span>
                {plan.existing > 0 && <> · <span style={{ color: '#92400E' }}>{plan.existing} already in Table View</span></>}
                {plan.repeats > 0 && <> · <span style={{ color: '#92400E' }}>{plan.repeats} repeated in the list</span></>}
                {plan.skipped > 0 && <> · <span style={{ color: '#991B1B' }}>{plan.skipped} unusable</span></>}
              </div>
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, maxHeight: 220, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                  <tbody>
                    {plan.rows.map((r, i) => {
                      const s = stateStyles[r.state];
                      return (
                        <tr key={i} style={{ background: r.state === 'new' ? '#fff' : s.background }}>
                          <td style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #E2E8F0', width: 52 }}>
                            <span style={{ color: s.color, fontWeight: 700, fontSize: '0.66rem', textTransform: 'uppercase' }}>{s.label}</span>
                          </td>
                          <td style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#1E293B' }}>{r.name}</td>
                          <td style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>{r.note}</td>
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
            disabled={busy || plan.toAdd.length === 0}
            style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (busy || plan.toAdd.length === 0) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (busy || plan.toAdd.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >
            {busy ? 'Adding…' : `Add ${plan.toAdd.length} compan${plan.toAdd.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
