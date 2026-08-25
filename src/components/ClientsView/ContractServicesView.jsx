import { useEffect, useMemo, useRef, useState } from 'react';
import { SERVICE_STATUSES } from '../../data/enums';
import { buildServiceCatalog } from '../../utils/serviceCoverage';
import { mergeExtractedServices } from '../../utils/contractServices';
import { apiFetch } from '../../utils/apiFetch';
import { appendContractLanguage } from '../../utils/contractLanguageStore';
import { applyDealTerms, DEAL_TERM_FIELDS, loadDealsList, DEALS_LIST_EVENT } from '../../utils/dealsStore';
import { loadDealClientMap, resolveClientName } from '../../utils/dealClientMap';
import { fmtDate } from '../../utils/dealsFormat';

// Vercel caps a serverless request body at 4.5 MB and base64 adds a third,
// so this is the largest PDF that can be posted whole for Claude to read
// directly. Past it we fall back to whatever text the browser can pull out.
const MAX_PDF_BYTES = 3_100_000;

// One file's extraction plus the reviewer's overrides survive a trip to
// another subtab (this component unmounts when you leave it) but not a
// different browser. Only the analysis is kept — never the file bytes.
const STORAGE_KEY = 'clients-view:contract-services';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}
function save(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota — the analysis is re-runnable */ }
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Strip the "data:...;base64," prefix FileReader puts on the front. Reading
// as a data URL (rather than btoa over an ArrayBuffer) keeps a multi-megabyte
// PDF off the JS stack.
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const s = String(reader.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Turn a picked file into the payload /api/contract-services wants.
 * A PDF small enough to post goes over whole — Claude reading the document
 * itself is what copes with scanned pages and service-matrix exhibits.
 * Everything else is reduced to text in the browser first.
 */
async function buildPayload(file) {
  const ext = extOf(file.name);
  if (ext === 'pdf') {
    if (file.size <= MAX_PDF_BYTES) {
      return { fileName: file.name, mediaType: 'application/pdf', dataBase64: await toBase64(file), readAs: 'pdf' };
    }
    throw new Error(`That PDF is ${fmtBytes(file.size)} — over the ${fmtBytes(MAX_PDF_BYTES)} upload limit. Split it, or save the pages that carry the scope as a smaller PDF.`);
  }
  if (ext === 'docx') {
    const { default: mammoth } = await import('mammoth/mammoth.browser');
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = String(result?.value || '').trim();
    if (!text) throw new Error('No readable text in that .docx.');
    return { fileName: file.name, text, readAs: 'text' };
  }
  if (ext === 'doc') {
    throw new Error('Legacy .doc isn’t readable here — save it as .docx or PDF first.');
  }
  const text = (await file.text()).trim();
  if (!text) throw new Error('That file is empty.');
  return { fileName: file.name, text, readAs: 'text' };
}

// The commercial terms as the documents state them, merged across an
// agreement and its amendments: later documents win field by field, so an
// amendment that only moves the end date doesn't blank the escalator the
// master agreement set. A field no document stated stays empty.
function mergeContractTerms(doneFiles) {
  const out = { termStart: '', termEnd: '', autoRenewal: '', escalator: '', paymentTerms: '' };
  for (const f of doneFiles) {
    const r = f.result || {};
    for (const k of Object.keys(out)) {
      const v = String(r[k] ?? '').trim();
      if (v) out[k] = v;
    }
  }
  return out;
}

const CONFIDENCE_STYLE = {
  high: { bg: '#DCFCE7', color: '#166534' },
  medium: { bg: '#FEF3C7', color: '#92400E' },
  low: { bg: '#FEE2E2', color: '#B91C1C' },
};

function pill(text, palette, title) {
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: palette.bg, color: palette.color, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

// Type-ahead picker for the "Apply to client" field.
//
// A <select> was fine when the client list was short, but it forces you to
// either scroll it or know the first letter — and the roster is long enough
// now that "Acme" is faster to type than to find. Matching is
// prefix-then-substring, the same order the Opps company combobox uses, so
// the client whose name STARTS with what you typed leads.
//
// The field is a picker, not free text: it resolves to a client id, and
// blurring without choosing anything puts the current selection's name back
// rather than leaving whatever half-typed string is in the box.
function ClientCombobox({ clients, value, onChange }) {
  // null = show the current selection; a string = the user is searching.
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  const items = useMemo(() => clients.map(c => ({
    id: c.id,
    company: String(c.company || ''),
    label: `${c.company}${String(c.status || '').toLowerCase() === 'old client' ? ' (old client)' : ''}`,
  })), [clients]);

  const selectedLabel = items.find(i => i.id === value)?.label || '';

  const matches = useMemo(() => {
    const q = String(draft ?? '').trim().toLowerCase();
    // Nothing typed yet — show the head of the list so the field advertises
    // that it predicts, rather than looking like an empty text box.
    if (!q) return items.slice(0, 8);
    const prefix = [];
    const sub = [];
    for (const it of items) {
      const lower = it.company.toLowerCase();
      if (lower.startsWith(q)) prefix.push(it);
      else if (lower.includes(q)) sub.push(it);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, items]);

  function pick(item) {
    if (!item) return;
    onChange(item.id);
    setDraft(null);
    setOpen(false);
    setHoverIdx(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="text"
        value={draft ?? selectedLabel}
        placeholder="Search clients…"
        onChange={e => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        // Focus shows the whole list and selects what's there, so the first
        // keystroke replaces the current client instead of appending to it.
        onFocus={e => { setDraft(selectedLabel); setOpen(true); setHoverIdx(0); e.target.select(); }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (wrapRef.current?.contains(document.activeElement)) return;
            setDraft(null);
            setOpen(false);
          });
        }}
        onKeyDown={e => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hoverIdx] || matches[0]); return; }
          }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null); setOpen(false); }
        }}
        style={{
          width: 260, padding: '0.35rem 0.5rem', border: '1px solid #E2E8F0',
          borderRadius: 6, fontSize: '0.75rem', fontFamily: 'inherit',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); setDraft(null); }}
          title="Clear the client"
          style={{
            background: 'transparent', border: 'none', color: '#94A3B8',
            cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px', fontFamily: 'inherit',
          }}
        >×</button>
      )}
      {open && (
        <div
          // mousedown would blur the input before the click lands, and the
          // blur handler closes this list.
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: 260, zIndex: 50,
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6,
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)', marginTop: 2,
            maxHeight: 240, overflowY: 'auto', fontSize: '0.75rem',
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '0.4rem 0.6rem', color: '#94A3B8' }}>No client matches that.</div>
          ) : matches.map((m, i) => (
            <div
              key={m.id}
              onClick={() => pick(m)}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.35rem 0.6rem', cursor: 'pointer',
                background: i === hoverIdx ? '#EFF6FF' : 'transparent',
                color: i === hoverIdx ? '#1E40AF' : '#1E293B',
                fontWeight: m.id === value ? 700 : 400,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Contract Services" subtab: upload a contract, have Claude transcribe the
 * services it puts in scope, map them onto the tracked service catalogue, and
 * — for the rows a human ticks — write them onto the client's Services
 * Explored. Nothing reaches a client record without an explicit Apply.
 *
 * The ticked rows can also be pushed the other way, into the Contract
 * Language library: the verbatim quote captured as evidence for a service IS
 * that service's contract language, and re-typing it into the other subtab
 * by hand would be copying text this page already has. That write is
 * client-independent — language belongs to the service — so it needs no
 * client picked, and it appends rather than replaces, because the library is
 * built up across many contracts.
 */
export function ContractServicesView({ prospects = [], settings = {}, updateProspect, user }) {
  const saved = useRef(loadSaved()).current;
  const [clientId, setClientId] = useState(() => saved?.clientId || '');
  // [{ fileName, readAs, status, error, result }] in the order analyzed —
  // oldest first, which is what makes an amendment's removals win.
  const [files, setFiles] = useState(() => (Array.isArray(saved?.files) ? saved.files : []));
  const [overrides, setOverrides] = useState(() => (saved?.overrides && typeof saved.overrides === 'object' ? saved.overrides : {}));
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [applyNote, setApplyNote] = useState('');
  const [languageNote, setLanguageNote] = useState('');
  const [languageError, setLanguageError] = useState({ error: '', code: '' });
  const [savingLanguage, setSavingLanguage] = useState(false);
  // Reviewer corrections to the extracted terms, by field. Held apart from
  // the extraction so re-reading a document doesn't silently drop a fix, and
  // so "reset" can put the document's own wording back.
  const [termEdits, setTermEdits] = useState(() => (saved?.termEdits && typeof saved.termEdits === 'object' ? saved.termEdits : {}));
  const [dealIdx, setDealIdx] = useState('');
  const [dealNote, setDealNote] = useState('');
  const [dealError, setDealError] = useState('');
  // The Deals roster, re-read when another tab uploads or edits it.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [dealClientMap, setDealClientMap] = useState(() => loadDealClientMap());
  const inputRef = useRef(null);

  const catalog = useMemo(() => buildServiceCatalog(settings), [settings]);

  const clients = useMemo(() => {
    const wanted = new Set(['client', 'old client']);
    return (prospects || [])
      .filter(p => wanted.has(String(p?.status || '').trim().toLowerCase()))
      .sort((a, b) => String(a.company || '').localeCompare(String(b.company || '')));
  }, [prospects]);
  const client = useMemo(() => clients.find(c => c.id === clientId) || null, [clients, clientId]);

  // Only the analysis is persisted; a re-render that changes nothing still
  // rewrites the same JSON, which is cheap next to re-running the model.
  useEffect(() => {
    save({ clientId, files, overrides, termEdits });
  }, [clientId, files, overrides, termEdits]);

  useEffect(() => {
    const refresh = () => { setDealsList(loadDealsList().data); setDealClientMap(loadDealClientMap()); };
    window.addEventListener(DEALS_LIST_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(DEALS_LIST_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const done = useMemo(() => files.filter(f => f.status === 'done' && f.result), [files]);
  const rows = useMemo(() => mergeExtractedServices(done, catalog), [done, catalog]);

  // A row's effective catalogue key / status / tick: the reviewer's override
  // when there is one, otherwise what the match implies. Removals default to
  // N/A and start unticked — dropping a service is the call you most want a
  // human to make deliberately.
  function rowState(row) {
    const o = overrides[row.key] || {};
    const catalogKey = o.catalogKey !== undefined ? o.catalogKey : (row.match?.key || '');
    const status = o.status !== undefined ? o.status : (row.removed ? 'N/A' : 'Sold');
    const checked = o.checked !== undefined ? o.checked : (!!catalogKey && !row.removed);
    return { catalogKey, status, checked };
  }
  function setRowState(row, patch) {
    setOverrides(prev => ({ ...prev, [row.key]: { ...rowState(row), ...patch } }));
  }

  async function analyze(fileList) {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    setBusy(true);
    setApplyNote('');
    setLanguageNote('');
    for (const file of picked) {
      // Own id rather than array position or filename: entries are patched
      // asynchronously and the reviewer can remove one mid-run, and two
      // amendments really can arrive with the same filename.
      const id = `f${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setFiles(prev => [...prev, { id, fileName: file.name, size: file.size, status: 'reading', error: '', result: null, readAs: '' }]);
      const mark = (patch) => setFiles(prev => {
        const i = prev.findIndex(f => f.id === id);
        if (i < 0) return prev;  // removed while it was running
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      });
      try {
        const payload = await buildPayload(file);
        mark({ status: 'analyzing', readAs: payload.readAs });
        const res = await apiFetch('/api/contract-services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
        mark({ status: 'done', result: data, readAs: data.readAs || payload.readAs });
      } catch (err) {
        mark({ status: 'error', error: err?.message || 'Could not read that contract.' });
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setApplyNote('');
  }
  // Clear ends the review, so everything the review put on screen goes with
  // it — including the client it was going to be applied to. Leaving the
  // picked company behind meant the next contract dropped onto this page
  // arrived already aimed at the last one's client, which is the wrong
  // default in the one direction that costs something: applying services to
  // an account that isn't in the document.
  //
  // Same for the reviewer's term corrections and the deal being linked: they
  // describe the documents being cleared, and carrying them onto the next
  // upload would put the last contract's edits on it.
  function clearAll() {
    setFiles([]);
    setOverrides({});
    setClientId('');
    setApplyNote('');
    setLanguageNote('');
    setLanguageError({ error: '', code: '' });
    setTermEdits({});
    setDealIdx('');
    setDealNote('');
    setDealError('');
  }

  const selectedRows = rows.filter(r => { const s = rowState(r); return s.checked && s.catalogKey; });
  // Only a row with a catalogue match can be ticked, so "all" means all of
  // those — a header box that never reaches "checked" because two unmapped
  // rows can't be ticked would read as broken.
  const selectableRows = rows.filter(r => rowState(r).catalogKey);
  const allSelected = selectableRows.length > 0 && selectedRows.length === selectableRows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;

  // One overrides write rather than one per row: setRowState in a loop is
  // as many renders as there are rows, and on a restated master agreement
  // that is a visible stall.
  function setAllChecked(checked) {
    const patch = {};
    for (const row of selectableRows) patch[row.key] = { ...rowState(row), checked };
    setOverrides(prev => ({ ...prev, ...patch }));
    setApplyNote('');
  }

  function applyToClient() {
    if (!client || !selectedRows.length || typeof updateProspect !== 'function') return;
    const next = { ...(client.servicesExplored || {}) };
    for (const row of selectedRows) {
      const { catalogKey, status } = rowState(row);
      if (!status || status === '-') delete next[catalogKey];
      else next[catalogKey] = status;
    }
    updateProspect(client.id, { servicesExplored: next });
    // No trailing period: plenty of company names already end in one ("Acme
    // Manufacturing Inc.") and the doubled stop reads like a typo.
    setApplyNote(`Wrote ${selectedRows.length} service${selectedRows.length === 1 ? '' : 's'} to ${client.company}`);
  }

  // What to call a clause that came out of a given file: the agreement's own
  // name when the document states one, its type if not, and the filename as a
  // last resort — so the library says "Master Services Agreement" rather than
  // "acme-msa-final-v3.pdf" wherever the contract gave it a name.
  const clauseLabelByFile = useMemo(() => {
    const m = new Map();
    for (const f of done) {
      const r = f.result || {};
      const label = String(r.agreementName || '').trim()
        || String(r.agreementType || '').trim()
        || String(f.fileName || '').trim();
      if (f.fileName) m.set(f.fileName, label);
    }
    return m;
  }, [done]);

  // Ticked rows that actually carry a quote. A row with a catalogue match but
  // no evidence has nothing to contribute to the library, so it isn't counted
  // in the button's number — a button offering to save 9 clauses that saves 6
  // is worse than one that says 6.
  // Computed plainly rather than memoized, the same way selectedRows above is:
  // it reads rowState, which closes over the overrides and is rebuilt every
  // render, so a dependency array would either be a lie or defeat the memo.
  // It is a handful of rows either way.
  const languageEntries = [];
  for (const row of selectedRows) {
    const { catalogKey } = rowState(row);
    const clauses = (row.evidence || [])
      .filter(e => e.quote)
      .map(e => ({
        label: clauseLabelByFile.get(e.fileName) || e.fileName || row.name,
        text: e.quote,
      }));
    if (clauses.length) languageEntries.push({ service: catalogKey, clauses });
  }
  const languageClauseCount = languageEntries.reduce((n, e) => n + e.clauses.length, 0);

  async function saveLanguage() {
    if (!languageEntries.length || savingLanguage) return;
    setSavingLanguage(true);
    setLanguageNote('');
    setLanguageError({ error: '', code: '' });
    const res = await appendContractLanguage(user?.uid, languageEntries);
    setSavingLanguage(false);
    if (!res.ok) {
      setLanguageError({ error: res.error, code: res.code });
      return;
    }
    if (res.added === 0) {
      setLanguageNote(res.skipped > 0
        ? 'Already in the library — nothing new to save'
        : 'Nothing to save');
      return;
    }
    const skipped = res.skipped > 0 ? `, ${res.skipped} already on file` : '';
    setLanguageNote(
      `Saved ${res.added} clause${res.added === 1 ? '' : 's'} to `
      + `${res.services} service${res.services === 1 ? '' : 's'} on Contract Language${skipped}`
    );
  }

  // What the documents said, with the reviewer's corrections on top.
  const extractedTerms = useMemo(() => mergeContractTerms(done), [done]);
  const terms = { ...extractedTerms, ...termEdits };
  const termsFilled = DEAL_TERM_FIELDS.filter(f => String(terms[f.from] || '').trim()).length;

  // Deals belonging to the picked client, carrying their index in the stored
  // roster because that is how a row is addressed for writing.
  const clientDeals = useMemo(() => {
    const target = String(client?.company || '').trim().toLowerCase();
    if (!target) return [];
    return dealsList
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        String(resolveClientName(row['Client Name'], dealClientMap) || '').trim().toLowerCase() === target);
  }, [dealsList, dealClientMap, client]);

  function setTerm(field, value) {
    setTermEdits(prev => ({ ...prev, [field]: value }));
    setDealNote('');
  }
  function resetTerms() {
    setTermEdits({});
    setDealNote('');
  }

  function writeTermsToDeal() {
    const picked = clientDeals.find(d => String(d.index) === String(dealIdx));
    if (!picked) return;
    setDealNote('');
    setDealError('');
    const res = applyDealTerms(picked.index, picked.row, terms);
    if (!res.ok) { setDealError(res.error); return; }
    setDealsList(loadDealsList().data);
    setDealNote(`Wrote ${res.written.length} field${res.written.length === 1 ? '' : 's'} to that deal: ${res.written.join(', ')}`);
  }

  const canApply = !!client && selectedRows.length > 0 && typeof updateProspect === 'function';
  const currentStatuses = client?.servicesExplored || {};

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '1rem 1.25rem 1.5rem' }}>
      <div style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Contract Services</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          Upload a contract and Claude transcribes the services it puts in scope, mapped onto the tracked service
          catalogue. Review the rows, then apply the ones you want to a client&apos;s <strong>Services Explored</strong>.
          The same ticked rows can have their contract wording saved to the <strong>Contract Language</strong> subtab,
          filed under each service. Nothing is written until you press a button.
        </div>
      </div>

      {/* --- upload ------------------------------------------------------- */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); analyze(e.dataTransfer?.files); }}
        style={{
          border: `2px dashed ${dragging ? '#3B82F6' : '#CBD5E1'}`,
          background: dragging ? '#EFF6FF' : '#F8FAFC',
          borderRadius: 8,
          padding: '1rem',
          textAlign: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          onChange={e => analyze(e.target.files)}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          style={{
            padding: '0.45rem 0.9rem', borderRadius: 6, border: '1px solid #2563EB',
            background: busy ? '#93C5FD' : '#2563EB', color: '#fff', fontSize: '0.78rem',
            fontWeight: 700, cursor: busy ? 'progress' : 'pointer', fontFamily: 'inherit',
          }}
        >{busy ? 'Reading…' : 'Choose contract files'}</button>
        <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 6 }}>
          …or drop them here. PDF, .docx, .txt — several at once is fine (an agreement plus its amendments).
          PDFs up to {fmtBytes(MAX_PDF_BYTES)} are read as documents, so scanned contracts work too.
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginBottom: '0.75rem', overflow: 'hidden' }}>
          {files.map((f, i) => (
            <div key={f.id || `${f.fileName}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.5rem 0.7rem', borderBottom: i === files.length - 1 ? 'none' : '1px solid #F1F5F9', fontSize: '0.72rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.fileName}
                  {f.readAs === 'pdf' && <span style={{ marginLeft: 6, fontWeight: 500, color: '#94A3B8' }}>read as PDF</span>}
                  {f.readAs === 'text' && <span style={{ marginLeft: 6, fontWeight: 500, color: '#94A3B8' }}>read as text</span>}
                </div>
                {f.status === 'error' ? (
                  <div style={{ color: '#B91C1C', marginTop: 2 }}>{f.error}</div>
                ) : f.status === 'done' ? (
                  <div style={{ color: '#64748B', marginTop: 2 }}>
                    {[f.result?.agreementType, f.result?.agreementName, f.result?.clientName].filter(Boolean).join(' · ') || 'No header details stated.'}
                    {(f.result?.termStart || f.result?.termEnd) && (
                      <> · term {f.result.termStart || '?'} → {f.result.termEnd || '?'}</>
                    )}
                    {f.result?.restatesFullScope && <> · <strong style={{ color: '#92400E' }}>restates full scope</strong></>}
                    {f.result?.scopeNote && <div style={{ marginTop: 2, fontStyle: 'italic' }}>{f.result.scopeNote}</div>}
                  </div>
                ) : (
                  <div style={{ color: '#2563EB', marginTop: 2 }}>{f.status === 'reading' ? 'Reading the file…' : 'Claude is reading the contract…'}</div>
                )}
              </div>
              <div style={{ color: '#94A3B8', whiteSpace: 'nowrap' }}>{f.status === 'done' ? `${f.result?.services?.length || 0} service${(f.result?.services?.length || 0) === 1 ? '' : 's'}` : fmtBytes(f.size)}</div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                title="Remove this file from the review"
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: 0, fontFamily: 'inherit' }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* --- review ------------------------------------------------------- */}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 700 }}>Apply to client</label>
            <ClientCombobox
              clients={clients}
              value={clientId}
              onChange={id => { setClientId(id); setApplyNote(''); }}
            />
            <button
              type="button"
              disabled={!canApply}
              onClick={applyToClient}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid',
                borderColor: canApply ? '#15803D' : '#CBD5E1',
                background: canApply ? '#16A34A' : '#F1F5F9',
                color: canApply ? '#fff' : '#94A3B8',
                fontSize: '0.75rem', fontWeight: 700, cursor: canApply ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              }}
              title={client ? '' : 'Pick the client these contracts belong to first.'}
            >Apply {selectedRows.length} service{selectedRows.length === 1 ? '' : 's'}</button>
            <button
              type="button"
              disabled={!languageClauseCount || savingLanguage}
              onClick={saveLanguage}
              title={languageClauseCount
                ? 'Append each ticked service\u2019s verbatim quote to that service on the Contract Language subtab. Wording already on file is skipped.'
                : 'Tick a service that has an evidence quote first.'}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid',
                borderColor: languageClauseCount ? '#2563EB' : '#CBD5E1',
                background: languageClauseCount ? '#EFF6FF' : '#F1F5F9',
                color: languageClauseCount ? '#1E40AF' : '#94A3B8',
                fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: languageClauseCount && !savingLanguage ? 'pointer' : 'not-allowed',
              }}
            >{savingLanguage
              ? 'Saving\u2026'
              : `Save ${languageClauseCount} clause${languageClauseCount === 1 ? '' : 's'} to Contract Language`}</button>
            <button
              type="button"
              onClick={clearAll}
              style={{ padding: '0.4rem 0.7rem', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
            {applyNote && <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>{applyNote}</span>}
            {languageNote && <span style={{ fontSize: '0.72rem', color: '#1E40AF', fontWeight: 600 }}>{languageNote}</span>}
          </div>

          {languageError.error && (
            <div style={{
              margin: '0 0 0.5rem', padding: '0.5rem 0.7rem', borderRadius: 6,
              background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
              fontSize: '0.72rem', lineHeight: 1.45,
            }}>
              <strong>Couldn’t save the contract language.</strong>{' '}
              {languageError.code === 'permission-denied'
                ? 'Firestore refused the write \u2014 the deployed rules are missing the userSettings/{uid}/contractLanguage path.'
                : 'Check your connection and try again. Nothing on this page was lost.'}
              <div style={{ marginTop: 4, opacity: 0.85 }}>{languageError.error}</div>
            </div>
          )}

          {/* --- commercial terms -------------------------------------- */}
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.7rem 0.8rem', marginBottom: '0.6rem', background: '#F8FAFC' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E293B' }}>
                Contract terms{' '}
                <span style={{ fontWeight: 500, color: '#94A3B8' }}>
                  {termsFilled} of {DEAL_TERM_FIELDS.length} stated
                </span>
              </div>
              <button
                type="button"
                onClick={resetTerms}
                disabled={Object.keys(termEdits).length === 0}
                title="Put the documents’ own wording back"
                style={{
                  padding: '0.25rem 0.6rem', borderRadius: 5, background: '#fff',
                  border: '1px solid #E2E8F0', fontFamily: 'inherit', fontSize: '0.7rem',
                  color: Object.keys(termEdits).length ? '#475569' : '#CBD5E1',
                  cursor: Object.keys(termEdits).length ? 'pointer' : 'default',
                }}
              >Reset edits</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.5rem' }}>
              {DEAL_TERM_FIELDS.map(f => {
                const edited = termEdits[f.from] !== undefined
                  && String(termEdits[f.from] ?? '') !== String(extractedTerms[f.from] ?? '');
                return (
                  <label key={f.from} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.66rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {f.label}
                    {edited && <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#92400E' }}>edited</span>}
                    <input
                      type="text"
                      value={terms[f.from] || ''}
                      placeholder="Not stated"
                      onChange={e => setTerm(f.from, e.target.value)}
                      style={{
                        padding: '0.3rem 0.45rem', border: '1px solid', borderRadius: 5,
                        borderColor: edited ? '#FCD34D' : '#E2E8F0',
                        background: '#fff', fontSize: '0.74rem', fontFamily: 'inherit',
                        fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#1E293B',
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>Map to deal</span>
              <select
                value={dealIdx}
                onChange={e => { setDealIdx(e.target.value); setDealNote(''); setDealError(''); }}
                disabled={!client || clientDeals.length === 0}
                style={{ padding: '0.3rem 0.45rem', border: '1px solid #E2E8F0', borderRadius: 5, fontSize: '0.72rem', fontFamily: 'inherit', maxWidth: 420 }}
              >
                <option value="">
                  {!client ? '\u2014 pick a client first \u2014'
                    : clientDeals.length === 0 ? `\u2014 no deals for ${client.company} \u2014`
                    : '\u2014 pick a deal \u2014'}
                </option>
                {clientDeals.map(({ row, index }) => (
                  <option key={index} value={index}>
                    {String(row['Agreement Name'] || '').trim() || '(no agreement name)'}
                    {row['Current Term Start Date'] ? ` \u00b7 from ${fmtDate(row['Current Term Start Date'])}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!dealIdx || termsFilled === 0}
                onClick={writeTermsToDeal}
                title={termsFilled === 0
                  ? 'None of the five terms has a value to write.'
                  : 'Write these terms onto the picked deal on the Deals subtab. Blank terms leave the deal\u2019s existing value alone.'}
                style={{
                  padding: '0.35rem 0.7rem', borderRadius: 6, border: '1px solid',
                  borderColor: dealIdx && termsFilled ? '#2563EB' : '#CBD5E1',
                  background: dealIdx && termsFilled ? '#EFF6FF' : '#F1F5F9',
                  color: dealIdx && termsFilled ? '#1E40AF' : '#94A3B8',
                  fontSize: '0.73rem', fontWeight: 700, fontFamily: 'inherit',
                  cursor: dealIdx && termsFilled ? 'pointer' : 'not-allowed',
                }}
              >Write terms to deal</button>
              {dealNote && <span style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 600 }}>{dealNote}</span>}
            </div>
            {dealError && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: '#991B1B', fontWeight: 600 }}>{dealError}</div>
            )}
            <div style={{ fontSize: '0.66rem', color: '#94A3B8', marginTop: '0.4rem', lineHeight: 1.45 }}>
              Read from the documents above and correctable here. Only fields with a value are written — a term the
              contract doesn’t state leaves the deal’s existing value alone.
            </div>
          </div>

          <div style={{ fontSize: '0.7rem', color: '#64748B', marginBottom: '0.4rem' }}>
            {rows.length} distinct service{rows.length === 1 ? '' : 's'} across {done.length} document{done.length === 1 ? '' : 's'}.
            Rows with no catalogue match need one picking before they can be applied.
            The box in the header row selects (or clears) every matched row at once.
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', width: '100%' }}>
              <thead>
                <tr style={{ background: '#F1F5F9' }}>
                  <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid #CBD5E1' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={selectableRows.length === 0}
                      // Indeterminate is a DOM property, not an attribute, so
                      // it can only be set on the node itself.
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={e => setAllChecked(e.target.checked)}
                      aria-label={allSelected ? 'Clear all' : 'Select all'}
                      title={selectableRows.length === 0
                        ? 'No row has a catalogue match yet — pick one first.'
                        : allSelected
                          ? `Clear all ${selectableRows.length}`
                          : `Select all ${selectableRows.length} matched service${selectableRows.length === 1 ? '' : 's'}`}
                    />
                  </th>
                  {['Service in the contract', 'Catalogue service', 'Type', 'Status to write', 'Current', 'Evidence'].map((h, i) => (
                    <th key={i} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.66rem', whiteSpace: 'nowrap', borderBottom: '1px solid #CBD5E1' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const st = rowState(row);
                  const current = st.catalogKey ? (currentStatuses[st.catalogKey] || '') : '';
                  return (
                    <tr key={row.key} style={{ borderBottom: '1px solid #F1F5F9', background: row.removed ? '#FEF2F2' : '#fff' }}>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top' }}>
                        <input
                          type="checkbox"
                          checked={st.checked}
                          disabled={!st.catalogKey}
                          onChange={e => setRowState(row, { checked: e.target.checked })}
                          title={st.catalogKey ? '' : 'Pick a catalogue service first.'}
                        />
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top', minWidth: 200 }}>
                        <div style={{ fontWeight: 600, color: '#1E293B' }}>{row.name}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                          {row.removed && pill('removed', { bg: '#FEE2E2', color: '#B91C1C' }, 'A document says this service type ceases')}
                          {pill(row.confidence, CONFIDENCE_STYLE[row.confidence] || CONFIDENCE_STYLE.medium, 'How sure the model is this is a named service')}
                          {row.match?.basis === 'alias' && pill('alias', { bg: '#E0E7FF', color: '#3730A3' }, 'Mapped through the hand-maintained wording table')}
                          {row.fee && pill(row.fee, { bg: '#F1F5F9', color: '#475569' }, 'Fee as written in the contract')}
                        </div>
                        <div style={{ color: '#94A3B8', marginTop: 3 }}>{row.sources.join(', ')}</div>
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top' }}>
                        <select
                          value={st.catalogKey}
                          onChange={e => setRowState(row, { catalogKey: e.target.value, checked: !!e.target.value && st.checked })}
                          style={{ padding: '0.25rem 0.4rem', border: '1px solid', borderColor: st.catalogKey ? '#E2E8F0' : '#FCA5A5', borderRadius: 5, fontSize: '0.72rem', fontFamily: 'inherit', maxWidth: 260 }}
                        >
                          <option value="">— no match —</option>
                          {catalog.map(cat => (
                            <optgroup key={cat.name} label={cat.name}>
                              {cat.items.map(it => <option key={it.key} value={it.key}>{it.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top', color: '#64748B', whiteSpace: 'nowrap' }}>
                        {row.kind === 'one_time' ? 'One-time' : 'Recurring'}
                        {row.effectiveDate && <div style={{ color: '#94A3B8' }}>{row.effectiveDate}</div>}
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top' }}>
                        <select
                          value={st.status}
                          onChange={e => setRowState(row, { status: e.target.value })}
                          style={{ padding: '0.25rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 5, fontSize: '0.72rem', fontFamily: 'inherit' }}
                        >
                          {SERVICE_STATUSES.map(s => <option key={s} value={s}>{s === '-' ? '— clear —' : s}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top', whiteSpace: 'nowrap', color: current ? '#1E293B' : '#94A3B8' }}>
                        {client ? (current || 'untouched') : '—'}
                      </td>
                      <td style={{ padding: '0.35rem 0.6rem', verticalAlign: 'top', color: '#475569', minWidth: 240 }}>
                        {row.evidence.length === 0 ? <span style={{ color: '#94A3B8' }}>—</span> : row.evidence.map((e, i) => (
                          <div key={i} style={{ marginBottom: i === row.evidence.length - 1 ? 0 : 4 }}>
                            <span style={{ fontStyle: 'italic' }}>“{e.quote}”</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {files.length > 0 && rows.length === 0 && !busy && done.length > 0 && (
        <div style={{ padding: '0.75rem 0', color: '#64748B', fontSize: '0.8rem', fontStyle: 'italic' }}>
          Nothing readable as a service in {done.length === 1 ? 'that document' : 'those documents'} — check the scope note above.
        </div>
      )}
    </div>
  );
}
