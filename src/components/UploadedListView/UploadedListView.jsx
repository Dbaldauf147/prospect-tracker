import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { saveList as saveListToIDB, loadList as loadListFromIDB, clearList as clearListFromIDB } from '../../utils/uploadedListStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import styles from './UploadedListView.module.css';

function loadMapping(key) {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Normalize a company name for fuzzy matching:
// lowercase, strip accents, drop punctuation, collapse whitespace, drop
// common corporate suffixes. Two names that normalize to the same token
// are treated as the same company.
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickNameKey(headers) {
  const key = headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k));
  return key || headers[0];
}

const TIER_COLORS = {
  'Tier 1': { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' },
  'Tier 2': { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A' },
  'Tier 3': { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155' },
};

function renderMappingCell({ row, scope, mapping, dismissed, suggestionFor, prospectsByNorm, onPick, onDismiss }) {
  const matchKey = row.__matchKey__;
  const confirmedName = mapping[matchKey];
  const prospect = confirmedName
    ? prospectsByNorm.get(normalizeCompany(confirmedName))
    : null;
  const handleClick = (e) => onPick(row, e.currentTarget, scope);
  const confirmTitle = scope === 'myAccounts'
    ? 'Mapped to a My Accounts company · click to change'
    : 'Mapped to a Table View prospect · click to change';
  const suggestTitle = scope === 'myAccounts'
    ? 'Suggested My Accounts match · click to confirm or pick a different account'
    : 'Suggested Table View match · click to confirm or pick a different prospect';
  const emptyTitle = scope === 'myAccounts'
    ? 'Click to map to a My Accounts company'
    : 'Click to map to a Table View prospect';
  const confirmBg = scope === 'myAccounts' ? '#DBEAFE' : '#DCFCE7';
  const confirmBorder = scope === 'myAccounts' ? '#93C5FD' : '#86EFAC';
  const confirmText = scope === 'myAccounts' ? '#1E3A8A' : '#166534';
  const confirmIcon = scope === 'myAccounts' ? '★' : '✓';

  if (prospect) {
    return (
      <button
        type="button"
        data-mapping-cell={scope}
        onClick={handleClick}
        style={{ background: confirmBg, border: `1px solid ${confirmBorder}`, borderRadius: 12, padding: '2px 8px', fontSize: '0.7rem', color: confirmText, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25 }}
        title={`${confirmTitle} · ${prospect.company}`}
      >{confirmIcon} {prospect.company}</button>
    );
  }
  const isDismissed = dismissed[matchKey];
  if (!isDismissed) {
    const suggestion = suggestionFor(row.__rawName__ || '');
    if (suggestion) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 2, maxWidth: '100%' }}>
          <button
            type="button"
            data-mapping-cell={scope}
            onClick={handleClick}
            style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', borderRadius: 12, padding: '2px 8px', fontSize: '0.7rem', color: '#92400E', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: 'calc(100% - 20px)', textAlign: 'left', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.25 }}
            title={`${suggestTitle} · ${suggestion.company}`}
          >? {suggestion.company}</button>
          <button
            type="button"
            data-mapping-cell={scope}
            onClick={e => { e.stopPropagation(); onDismiss(matchKey, scope); }}
            title="Dismiss this suggestion"
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
            onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
          >×</button>
        </span>
      );
    }
  }
  return (
    <button
      type="button"
      data-mapping-cell={scope}
      onClick={handleClick}
      style={{ background: 'transparent', border: '1px dashed #CBD5E1', borderRadius: 999, padding: '1px 8px', fontSize: '0.7rem', color: '#64748B', fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit' }}
      title={emptyTitle}
    >— Map —</button>
  );
}

function TextEditCell({ value, onChange, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  function startEdit(e) {
    e.stopPropagation();
    setDraft(value || '');
    setEditing(true);
  }
  function save() {
    setEditing(false);
    const next = draft.trim();
    if ((next || '') !== (value || '')) onChange(next);
  }
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff' }}
      />
    );
  }
  return (
    <span
      onClick={startEdit}
      title="Click to edit"
      style={{ display: 'inline-block', cursor: 'text', fontSize: '0.75rem', color: value ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '2px 6px', borderRadius: 4, minWidth: 80 }}
      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {value || placeholder || '—'}
    </span>
  );
}

function buildColumns(data, ctx) {
  if (!data.length) return [];
  const { prospectsByNorm, myAccountsByNorm, prospectSuggestionFor, myAccountSuggestionFor,
          mapping, dismissed, myAccountMapping, myAccountDismissed,
          textColumn, textValues, onTextChange,
          onPick, onDismiss } = ctx;
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id' && k !== '__matchKey__') keys.add(k);
  const baseCols = [...keys].map((k, i) => ({
    key: k,
    label: k,
    defaultWidth: i === 0 ? 240 : 140,
    ...(i === 0 ? { sticky: true } : {}),
  }));
  const textCol = textColumn
    ? [{
        key: `__text_${textColumn.key}__`,
        label: textColumn.label,
        defaultWidth: 160,
        render: (row) => (
          <TextEditCell
            value={textValues[row.__matchKey__] || ''}
            placeholder={textColumn.placeholder || `Add ${textColumn.label}…`}
            onChange={(v) => onTextChange(row.__matchKey__, v)}
          />
        ),
      }]
    : [];
  const myAccountsCol = {
    key: '__myAccountsList__',
    label: 'My Accounts',
    defaultWidth: 220,
    render: (row) => renderMappingCell({
      row, scope: 'myAccounts',
      mapping: myAccountMapping, dismissed: myAccountDismissed,
      suggestionFor: myAccountSuggestionFor, prospectsByNorm: myAccountsByNorm,
      onPick, onDismiss,
    }),
  };
  const myAccountsInfoCol = {
    key: '__myAccountsInfo__',
    label: 'Tier / Status',
    defaultWidth: 180,
    render: (row) => {
      const mapped = myAccountMapping[row.__matchKey__];
      const prospect = mapped ? myAccountsByNorm.get(normalizeCompany(mapped)) : null;
      if (!prospect) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>;
      const tierStyle = TIER_COLORS[prospect.tier] || { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155' };
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {prospect.tier && (
            <span
              style={{ background: tierStyle.bg, border: `1px solid ${tierStyle.border}`, color: tierStyle.text, borderRadius: 999, padding: '1px 8px', fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap' }}
              title={`${prospect.company} — ${prospect.tier}`}
            >{prospect.tier}</span>
          )}
          {prospect.status && (
            <span
              style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', borderRadius: 999, padding: '1px 8px', fontSize: '0.65rem', fontWeight: 600, whiteSpace: 'nowrap' }}
              title={`${prospect.company} — ${prospect.status}`}
            >{prospect.status}</span>
          )}
          {!prospect.tier && !prospect.status && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>
          )}
        </span>
      );
    },
  };
  const matchCol = {
    key: '__myAccount__',
    label: 'Table View Mapping',
    defaultWidth: 240,
    render: (row) => renderMappingCell({
      row, scope: 'tableView',
      mapping, dismissed,
      suggestionFor: prospectSuggestionFor, prospectsByNorm,
      onPick, onDismiss,
    }),
  };
  return [...baseCols, ...textCol, myAccountsCol, myAccountsInfoCol, matchCol];
}

export function UploadedListView({
  storageKey,
  title,
  tableIdPrefix,
  singular = 'entry',
  plural = 'entries',
  prospects = [],
  onSelectProspect,
  textColumn, // { key: string, label: string, placeholder?: string }
}) {
  const [store, setStore] = useState({ data: [], source: 'empty' });
  const mappingKey = storageKey ? `${storageKey}:account-mapping` : '';
  const dismissedKey = storageKey ? `${storageKey}:account-dismissed` : '';
  const myAccountMappingKey = storageKey ? `${storageKey}:my-accounts-mapping` : '';
  const myAccountDismissedKey = storageKey ? `${storageKey}:my-accounts-dismissed` : '';
  const textValuesKey = storageKey && textColumn ? `${storageKey}:${textColumn.key}-values` : '';
  const [mapping, setMapping] = useState(() => loadMapping(mappingKey));
  const [dismissed, setDismissed] = useState(() => loadMapping(dismissedKey));
  const [myAccountMapping, setMyAccountMapping] = useState(() => loadMapping(myAccountMappingKey));
  const [myAccountDismissed, setMyAccountDismissed] = useState(() => loadMapping(myAccountDismissedKey));
  const [textValues, setTextValues] = useState(() => loadMapping(textValuesKey));
  const [search, setSearch] = useState('');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [picker, setPicker] = useState(null); // { matchKey, raw, query, scope: 'tableView' | 'myAccounts' }
  const fileInputRef = useRef(null);
  const { data, source } = store;

  // Load list from IDB whenever the tab (storageKey) changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadListFromIDB(storageKey);
      if (!cancelled) {
        setStore(Array.isArray(loaded) && loaded.length > 0
          ? { data: loaded, source: 'override' }
          : { data: [], source: 'empty' });
      }
    })();
    setMapping(loadMapping(`${storageKey}:account-mapping`));
    setDismissed(loadMapping(`${storageKey}:account-dismissed`));
    setMyAccountMapping(loadMapping(`${storageKey}:my-accounts-mapping`));
    setMyAccountDismissed(loadMapping(`${storageKey}:my-accounts-dismissed`));
    setTextValues(textColumn ? loadMapping(`${storageKey}:${textColumn.key}-values`) : {});
    setSearch('');
    setSuggestedOnly(false);
    setUploadError(null);
    setPicker(null);
    return () => { cancelled = true; };
  }, [storageKey]);

  // Cross-tab sync is limited to the mapping + dismissed set
  // (localStorage). The list itself is in IDB so storage events don't
  // fire — that's fine, user re-uploads from the current tab anyway.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === mappingKey) setMapping(loadMapping(mappingKey));
      if (e.key === dismissedKey) setDismissed(loadMapping(dismissedKey));
      if (e.key === myAccountMappingKey) setMyAccountMapping(loadMapping(myAccountMappingKey));
      if (e.key === myAccountDismissedKey) setMyAccountDismissed(loadMapping(myAccountDismissedKey));
      if (textValuesKey && e.key === textValuesKey) setTextValues(loadMapping(textValuesKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mappingKey, dismissedKey, myAccountMappingKey, myAccountDismissedKey, textValuesKey]);

  // Persist mapping + dismissed set back to localStorage whenever
  // either changes.
  useEffect(() => {
    if (!mappingKey) return;
    try {
      if (Object.keys(mapping).length === 0) localStorage.removeItem(mappingKey);
      else localStorage.setItem(mappingKey, JSON.stringify(mapping));
    } catch {}
  }, [mapping, mappingKey]);
  useEffect(() => {
    if (!dismissedKey) return;
    try {
      if (Object.keys(dismissed).length === 0) localStorage.removeItem(dismissedKey);
      else localStorage.setItem(dismissedKey, JSON.stringify(dismissed));
    } catch {}
  }, [dismissed, dismissedKey]);
  useEffect(() => {
    if (!myAccountMappingKey) return;
    try {
      if (Object.keys(myAccountMapping).length === 0) localStorage.removeItem(myAccountMappingKey);
      else localStorage.setItem(myAccountMappingKey, JSON.stringify(myAccountMapping));
    } catch {}
  }, [myAccountMapping, myAccountMappingKey]);
  useEffect(() => {
    if (!myAccountDismissedKey) return;
    try {
      if (Object.keys(myAccountDismissed).length === 0) localStorage.removeItem(myAccountDismissedKey);
      else localStorage.setItem(myAccountDismissedKey, JSON.stringify(myAccountDismissed));
    } catch {}
  }, [myAccountDismissed, myAccountDismissedKey]);
  useEffect(() => {
    if (!textValuesKey) return;
    try {
      if (Object.keys(textValues).length === 0) localStorage.removeItem(textValuesKey);
      else localStorage.setItem(textValuesKey, JSON.stringify(textValues));
    } catch {}
  }, [textValues, textValuesKey]);

  // Close the picker dropdown when clicking outside it.
  useEffect(() => {
    if (!picker) return;
    function onDocClick(e) {
      if (e.target.closest('[data-picker="my-account"]')) return;
      // A click on any mapping cell button replaces this picker rather
      // than just closing it — letting the button handler run is fine,
      // openPicker will set new state.
      if (e.target.closest('button[data-mapping-cell]')) return;
      setPicker(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [picker]);

  // Build normalized prospect lookup + a list of normalized names for
  // substring fallbacks. Keeps the matching O(rows + prospects) rather
  // than O(rows * prospects).
  const { prospectsByNorm, prospectNorms } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    for (const p of prospects) {
      const name = (p.company || '').trim();
      if (!name) continue;
      const norm = normalizeCompany(name);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, p);
      norms.push({ norm, prospect: p });
    }
    return { prospectsByNorm: byNorm, prospectNorms: norms };
  }, [prospects]);

  // Track the MyAccountsView's resolved company-name list so suggestions
  // target the exact ~132 accounts the user sees on that tab instead of
  // the broader Baldauf-CDM prospect pool. MyAccountsView writes the
  // names to localStorage; we re-read on 'storage' events so a user who
  // had both tabs open sees fresh data.
  const [myAccountNames, setMyAccountNames] = useState(() => {
    try {
      const raw = localStorage.getItem('my-accounts:active-names');
      return raw ? (JSON.parse(raw) || null) : null;
    } catch { return null; }
  });
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'my-accounts:active-names') {
        try {
          const raw = localStorage.getItem('my-accounts:active-names');
          setMyAccountNames(raw ? (JSON.parse(raw) || null) : null);
        } catch { setMyAccountNames(null); }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Build the fuzzy-match index for the My Accounts column + filter.
  // Prefer the resolved list when MyAccountsView has published it
  // (exact 132 companies); fall back to the Baldauf-CDM prospect pool
  // so the first-ever visit still works before My Accounts is opened.
  const { myAccountsByNorm, myAccountNorms } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    const add = (name, prospect) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const norm = normalizeCompany(trimmed);
      if (!norm) return;
      if (!byNorm.has(norm)) byNorm.set(norm, prospect || { company: trimmed });
      norms.push({ norm, prospect: prospect || { company: trimmed } });
    };
    if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
      // Prefer resolving to a full prospect when we have one (so the
      // picker surfaces tier / CDM metadata); fall back to a minimal
      // { company } object when the prospect isn't in the current pool.
      const byLower = new Map();
      for (const p of prospects) {
        const key = (p.company || '').toLowerCase().trim();
        if (key) byLower.set(key, p);
      }
      for (const name of myAccountNames) {
        const p = byLower.get(String(name || '').toLowerCase().trim());
        add(name, p);
      }
    } else {
      for (const p of prospects) {
        if (!(p.cdm || '').toLowerCase().includes('baldauf')) continue;
        add(p.company, p);
      }
    }
    return { myAccountsByNorm: byNorm, myAccountNorms: norms };
  }, [prospects, myAccountNames]);

  function suggestFrom(raw, byNorm, norms) {
    const norm = normalizeCompany(raw);
    if (!norm) return null;
    const exact = byNorm.get(norm);
    if (exact) return exact;
    let best = null;
    for (const { norm: pn, prospect } of norms) {
      if (pn === norm) return prospect;
      if (pn.length < 3) continue;
      if (norm.includes(pn) || pn.includes(norm)) {
        if (!best || pn.length < best.pn.length) best = { pn, prospect };
      }
    }
    return best?.prospect || null;
  }

  const prospectSuggestionFor = useMemo(
    () => (raw) => suggestFrom(raw, prospectsByNorm, prospectNorms),
    [prospectsByNorm, prospectNorms]
  );

  const myAccountSuggestionFor = useMemo(
    () => (raw) => suggestFrom(raw, myAccountsByNorm, myAccountNorms),
    [myAccountsByNorm, myAccountNorms]
  );

  const rows = useMemo(() => {
    if (!data.length) return [];
    const headers = [];
    const seen = new Set();
    for (const row of data) for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
    const nameKey = pickNameKey(headers);
    return data.map((r, i) => {
      const rawName = nameKey ? String(r[nameKey] || '') : '';
      // Match key is the normalized company name — survives a re-upload
      // with different row ordering or added/removed rows. Falls back
      // to the row index when we can't extract a name so each row is
      // still unique.
      const norm = normalizeCompany(rawName);
      const matchKey = norm ? `name::${norm}` : `row::${i}`;
      return { ...r, id: i, __rawName__: rawName, __matchKey__: matchKey };
    });
  }, [data]);

  function openPicker(row, anchorEl, scope = 'tableView') {
    const rect = anchorEl?.getBoundingClientRect?.();
    const width = 320;
    const pos = rect
      ? {
          top: Math.min(rect.bottom + 4, window.innerHeight - 380),
          left: Math.min(rect.left, window.innerWidth - width - 8),
        }
      : { top: 80, left: 80 };
    setPicker({ matchKey: row.__matchKey__, raw: row.__rawName__ || '', query: '', pos, width, scope });
  }
  function confirmMapping(matchKey, prospectCompany) {
    const scope = picker?.scope || 'tableView';
    const setMap = scope === 'myAccounts' ? setMyAccountMapping : setMapping;
    const setDis = scope === 'myAccounts' ? setMyAccountDismissed : setDismissed;
    setMap(prev => ({ ...prev, [matchKey]: prospectCompany }));
    // Confirming implicitly un-dismisses, so switching accounts later
    // still shows suggestions.
    setDis(prev => {
      if (!prev[matchKey]) return prev;
      const next = { ...prev };
      delete next[matchKey];
      return next;
    });
    setPicker(null);
  }
  function clearMapping(matchKey) {
    const scope = picker?.scope || 'tableView';
    const setMap = scope === 'myAccounts' ? setMyAccountMapping : setMapping;
    setMap(prev => {
      const next = { ...prev };
      delete next[matchKey];
      return next;
    });
    setPicker(null);
  }
  function dismissSuggestion(matchKey, scope = 'tableView') {
    const setDis = scope === 'myAccounts' ? setMyAccountDismissed : setDismissed;
    setDis(prev => ({ ...prev, [matchKey]: true }));
  }
  function setTextValue(matchKey, value) {
    setTextValues(prev => {
      const next = { ...prev };
      if (!value) delete next[matchKey];
      else next[matchKey] = value;
      return next;
    });
  }

  const columns = useMemo(
    () => buildColumns(rows, {
      prospectsByNorm, myAccountsByNorm,
      prospectSuggestionFor, myAccountSuggestionFor,
      mapping, dismissed, myAccountMapping, myAccountDismissed,
      textColumn, textValues, onTextChange: setTextValue,
      onPick: openPicker, onDismiss: dismissSuggestion,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, myAccountsByNorm, prospectSuggestionFor, myAccountSuggestionFor, mapping, dismissed, myAccountMapping, myAccountDismissed, textColumn, textValues]
  );
  const tableId = useMemo(
    () => `${tableIdPrefix}:` + columns.map(c => c.key).sort().join('|'),
    [columns, tableIdPrefix]
  );
  const alwaysVisible = useMemo(() => {
    const first = columns[0];
    const keys = [];
    if (first) keys.push(first.key);
    for (const c of columns) {
      if (
        c.key === '__myAccountsList__' ||
        c.key === '__myAccountsInfo__' ||
        c.key === '__myAccount__' ||
        c.key.startsWith('__text_')
      ) keys.push(c.key);
    }
    return keys;
  }, [columns]);

  // A row "matches My Accounts" if it's either confirmed-mapped to a My
  // Accounts prospect, or it has a non-dismissed suggestion. Confirmed
  // rows stay visible under the filter because they're still My
  // Accounts; dismissed un-mapped suggestions drop out.
  const isMyAccountsRow = useMemo(() => (r) => {
    if (myAccountMapping[r.__matchKey__]) return true;
    if (myAccountDismissed[r.__matchKey__]) return false;
    return !!myAccountSuggestionFor(r.__rawName__ || '');
  }, [myAccountMapping, myAccountDismissed, myAccountSuggestionFor]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(r =>
        Object.entries(r).some(([k, v]) => k !== '__matchKey__' && String(v).toLowerCase().includes(term))
      );
    }
    if (suggestedOnly) {
      result = result.filter(isMyAccountsRow);
    }
    return result;
  }, [search, suggestedOnly, rows, isMyAccountsRow]);

  const myAccountsMatchCount = useMemo(
    () => rows.reduce((n, r) => n + (isMyAccountsRow(r) ? 1 : 0), 0),
    [rows, isMyAccountsRow]
  );

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const { rows: parsed } = parseBestSheet(new Uint8Array(buf));
      await saveListToIDB(storageKey, parsed);
      setStore({ data: parsed, source: 'override' });
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload exceeded the browser storage quota. Try a smaller file or trim unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  async function handleRevert() {
    if (!window.confirm(`Remove the uploaded ${title} list?`)) return;
    await clearListFromIDB(storageKey);
    setStore({ data: [], source: 'empty' });
  }

  const matchStats = useMemo(() => {
    // Only count mappings whose row is actually in the current list —
    // an older mapping for a company that's no longer uploaded should
    // still be preserved in storage but doesn't belong in the count.
    let confirmed = 0;
    let suggested = 0;
    for (const r of rows) {
      if (mapping[r.__matchKey__]) { confirmed++; continue; }
      if (dismissed[r.__matchKey__]) continue;
      if (r.__rawName__ && prospectSuggestionFor(r.__rawName__)) suggested++;
    }
    return { confirmed, suggested };
  }, [rows, mapping, dismissed, prospectSuggestionFor]);

  // Coverage of the user's resolved My Accounts set against this list.
  // A My Account is considered "matched" when any list row is either
  // confirmed-mapped to it or fuzzy-suggests it (not dismissed). Used
  // to surface '23/132 My Accounts matched (17%)' in the header so the
  // user sees how much of their portfolio the list touches at a glance.
  const myAccountsCoverage = useMemo(() => {
    // Build the account set — prefer the resolved MyAccountsView list,
    // fall back to the Baldauf-CDM prospect pool.
    let accountSet;
    if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
      accountSet = new Set(
        myAccountNames.map(n => String(n || '').toLowerCase().trim()).filter(Boolean)
      );
    } else {
      accountSet = new Set();
      for (const p of prospects) {
        if (!(p.cdm || '').toLowerCase().includes('baldauf')) continue;
        const k = (p.company || '').toLowerCase().trim();
        if (k) accountSet.add(k);
      }
    }
    const total = accountSet.size;
    if (total === 0) return { matched: 0, total: 0, pct: 0 };

    const matched = new Set();
    for (const r of rows) {
      const mk = r.__matchKey__;
      if (myAccountDismissed[mk]) continue;
      const confirmedName = myAccountMapping[mk];
      if (typeof confirmedName === 'string' && confirmedName) {
        const key = confirmedName.toLowerCase().trim();
        if (accountSet.has(key)) matched.add(key);
        continue;
      }
      const suggestion = r.__rawName__ ? myAccountSuggestionFor(r.__rawName__) : null;
      if (suggestion) {
        const key = (suggestion.company || '').toLowerCase().trim();
        if (accountSet.has(key)) matched.add(key);
      }
    }
    const pct = total > 0 ? Math.round((matched.size / total) * 100) : 0;
    return { matched: matched.size, total, pct };
  }, [rows, myAccountNames, prospects, myAccountMapping, myAccountDismissed, myAccountSuggestionFor]);

  // Picker search results — top 30 prospects matching the query, or the
  // auto-suggestion + first 30 prospects when the query is empty.
  // The picker is scoped: 'myAccounts' restricts the list to the user's
  // resolved My Accounts set (exact ~132 companies when MyAccountsView
  // has published its list to localStorage, else fall back to Baldauf
  // CDM). 'tableView' uses every prospect.
  const pickerResults = useMemo(() => {
    if (!picker) return [];
    const q = (picker.query || '').toLowerCase().trim();
    let source;
    if (picker.scope === 'myAccounts') {
      if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
        const nameSet = new Set(myAccountNames.map(n => String(n || '').toLowerCase().trim()).filter(Boolean));
        source = prospects.filter(p => nameSet.has((p.company || '').toLowerCase().trim()));
      } else {
        source = prospects.filter(p => (p.cdm || '').toLowerCase().includes('baldauf'));
      }
    } else {
      source = prospects;
    }
    const suggestFn = picker.scope === 'myAccounts' ? myAccountSuggestionFor : prospectSuggestionFor;
    const auto = picker.raw ? suggestFn(picker.raw) : null;
    const list = source.filter(p => p.company && (!q || p.company.toLowerCase().includes(q)));
    list.sort((a, b) => a.company.localeCompare(b.company));
    const out = [];
    const seen = new Set();
    if (auto && !q) { out.push(auto); seen.add(auto.id); }
    for (const p of list) {
      if (seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
      if (out.length >= 30) break;
    }
    return out;
  }, [picker, prospects, prospectSuggestionFor, myAccountSuggestionFor, myAccountNames]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.subtitle}>
            {rows.length} {rows.length === 1 ? singular : plural}{source === 'override' ? ' · uploaded list active' : ''}
            {rows.length > 0 && (
              <span style={{ marginLeft: '0.75rem', color: 'var(--color-text-muted)' }}>
                · <strong style={{ color: '#166534' }}>{matchStats.confirmed}</strong> mapped
                {matchStats.suggested > 0 && (
                  <> · <strong style={{ color: '#92400E' }}>{matchStats.suggested}</strong> suggested</>
                )}
                {myAccountsCoverage.total > 0 && (
                  <> · <strong style={{ color: '#1E3A8A' }}>{myAccountsCoverage.matched}/{myAccountsCoverage.total}</strong> My Accounts matched (<strong style={{ color: '#1E3A8A' }}>{myAccountsCoverage.pct}%</strong>)</>
                )}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={`Upload an Excel file to populate the ${title} table.`}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Upload Excel
          </button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title={`Remove the uploaded ${title} list`}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Remove list
            </button>
          )}
        </div>
      </div>
      {uploadError && (
        <div style={{ margin: '0.5rem 1.25rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={`Search ${title}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setSuggestedOnly(v => !v)}
          title="Show only list rows that match a company on My Accounts (live — based on current prospect data)"
          style={{
            padding: '0.35rem 0.7rem',
            border: `1px solid ${suggestedOnly ? '#3B82F6' : 'var(--color-border)'}`,
            borderRadius: 6,
            background: suggestedOnly ? '#DBEAFE' : '#fff',
            color: suggestedOnly ? '#1E3A8A' : 'var(--color-text-secondary)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          ★ {suggestedOnly ? 'Showing My Accounts only' : 'My Accounts only'}
          {myAccountsMatchCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.68rem', color: suggestedOnly ? '#1E3A8A' : '#94A3B8' }}>
              {myAccountsMatchCount}
            </span>
          )}
        </button>
        {(search || suggestedOnly) && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No {title} loaded. Click <strong>Upload Excel</strong> to add your list.
        </div>
      ) : (
        <DataTable
          key={tableId}
          tableId={tableId}
          columns={columns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          emptyMessage={`No matching ${plural} found`}
        />
      )}
      {picker && createPortal(
        <div
          data-picker="my-account"
          style={{ position: 'fixed', top: picker.pos.top, left: picker.pos.left, width: picker.width, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.3rem', maxHeight: 350, zIndex: 9999, display: 'flex', flexDirection: 'column' }}
          onClick={e => e.stopPropagation()}
        >
          <input
            autoFocus
            value={picker.query}
            onChange={e => setPicker(p => ({ ...p, query: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Escape') setPicker(null); }}
            placeholder={picker.scope === 'myAccounts' ? 'Search My Accounts…' : 'Search Table View prospects…'}
            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', marginBottom: '0.25rem', boxSizing: 'border-box' }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {pickerResults.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => confirmMapping(picker.matchKey, p.company)}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.35rem 0.5rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{p.company}</div>
                {(p.tier || p.cdm) && (
                  <div style={{ fontSize: '0.65rem', color: '#64748B', marginTop: 1 }}>
                    {[p.tier, p.cdm].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            ))}
            {pickerResults.length === 0 && (
              <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#64748B', textAlign: 'center' }}>
                No matching accounts found.
              </div>
            )}
          </div>
          {((picker.scope === 'myAccounts' ? myAccountMapping : mapping)[picker.matchKey]) && (
            <button
              type="button"
              onClick={() => clearMapping(picker.matchKey)}
              style={{ marginTop: '0.25rem', padding: '0.3rem 0.5rem', background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit', textAlign: 'left' }}
            >Clear mapping</button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
