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
    : scope === 'portfolio'
      ? 'Mapped to a Portfolio Company · click to change'
      : 'Mapped to a Table View prospect · click to change';
  const suggestTitle = scope === 'myAccounts'
    ? 'Suggested My Accounts match · click to confirm or pick a different account'
    : scope === 'portfolio'
      ? 'Suggested Portfolio Company match · click to confirm or pick a different one'
      : 'Suggested Table View match · click to confirm or pick a different prospect';
  const emptyTitle = scope === 'myAccounts'
    ? 'Click to map to a My Accounts company'
    : scope === 'portfolio'
      ? 'Click to map to a Portfolio Company'
      : 'Click to map to a Table View prospect';
  const confirmBg = scope === 'myAccounts' ? '#DBEAFE' : scope === 'portfolio' ? '#EDE9FE' : '#DCFCE7';
  const confirmBorder = scope === 'myAccounts' ? '#93C5FD' : scope === 'portfolio' ? '#C4B5FD' : '#86EFAC';
  const confirmText = scope === 'myAccounts' ? '#1E3A8A' : scope === 'portfolio' ? '#5B21B6' : '#166534';
  const confirmIcon = scope === 'myAccounts' ? '★' : scope === 'portfolio' ? '◆' : '✓';

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
          >{suggestion.company}</button>
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
  const { prospectsByNorm, myAccountsByNorm, portfolioByNorm,
          prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor,
          mapping, dismissed, myAccountMapping, myAccountDismissed,
          portfolioMapping, portfolioDismissed,
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
  const portfolioCol = {
    key: '__portfolioList__',
    label: 'Portfolio Companies',
    defaultWidth: 220,
    render: (row) => renderMappingCell({
      row, scope: 'portfolio',
      mapping: portfolioMapping, dismissed: portfolioDismissed,
      suggestionFor: portfolioSuggestionFor, prospectsByNorm: portfolioByNorm,
      onPick, onDismiss,
    }),
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
  return [...baseCols, ...textCol, myAccountsCol, myAccountsInfoCol, portfolioCol, matchCol];
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
  const portfolioMappingKey = storageKey ? `${storageKey}:portfolio-mapping` : '';
  const portfolioDismissedKey = storageKey ? `${storageKey}:portfolio-dismissed` : '';
  const textValuesKey = storageKey && textColumn ? `${storageKey}:${textColumn.key}-values` : '';
  const [mapping, setMapping] = useState(() => loadMapping(mappingKey));
  const [dismissed, setDismissed] = useState(() => loadMapping(dismissedKey));
  const [myAccountMapping, setMyAccountMapping] = useState(() => loadMapping(myAccountMappingKey));
  const [myAccountDismissed, setMyAccountDismissed] = useState(() => loadMapping(myAccountDismissedKey));
  const [portfolioMapping, setPortfolioMapping] = useState(() => loadMapping(portfolioMappingKey));
  const [portfolioDismissed, setPortfolioDismissed] = useState(() => loadMapping(portfolioDismissedKey));
  const [textValues, setTextValues] = useState(() => loadMapping(textValuesKey));
  const [search, setSearch] = useState('');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadInfo, setUploadInfo] = useState(null); // { total, preservedTableView, preservedMyAccounts }
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
    setPortfolioMapping(loadMapping(`${storageKey}:portfolio-mapping`));
    setPortfolioDismissed(loadMapping(`${storageKey}:portfolio-dismissed`));
    setTextValues(textColumn ? loadMapping(`${storageKey}:${textColumn.key}-values`) : {});
    setSearch('');
    setSuggestedOnly(false);
    setUploadError(null);
    setUploadInfo(null);
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
      if (e.key === portfolioMappingKey) setPortfolioMapping(loadMapping(portfolioMappingKey));
      if (e.key === portfolioDismissedKey) setPortfolioDismissed(loadMapping(portfolioDismissedKey));
      if (textValuesKey && e.key === textValuesKey) setTextValues(loadMapping(textValuesKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mappingKey, dismissedKey, myAccountMappingKey, myAccountDismissedKey, portfolioMappingKey, portfolioDismissedKey, textValuesKey]);

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
      // Let ListsView (and anyone else watching) recompute coverage.
      // storage events don't fire in the originating tab, so the
      // custom bump is the reliable signal.
      window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    } catch {}
  }, [myAccountMapping, myAccountMappingKey]);
  useEffect(() => {
    if (!myAccountDismissedKey) return;
    try {
      if (Object.keys(myAccountDismissed).length === 0) localStorage.removeItem(myAccountDismissedKey);
      else localStorage.setItem(myAccountDismissedKey, JSON.stringify(myAccountDismissed));
      window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    } catch {}
  }, [myAccountDismissed, myAccountDismissedKey]);
  useEffect(() => {
    if (!portfolioMappingKey) return;
    try {
      if (Object.keys(portfolioMapping).length === 0) localStorage.removeItem(portfolioMappingKey);
      else localStorage.setItem(portfolioMappingKey, JSON.stringify(portfolioMapping));
      window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    } catch {}
  }, [portfolioMapping, portfolioMappingKey]);
  useEffect(() => {
    if (!portfolioDismissedKey) return;
    try {
      if (Object.keys(portfolioDismissed).length === 0) localStorage.removeItem(portfolioDismissedKey);
      else localStorage.setItem(portfolioDismissedKey, JSON.stringify(portfolioDismissed));
      window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    } catch {}
  }, [portfolioDismissed, portfolioDismissedKey]);
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

  // Union of portfolio companies across every prospect. Duplicates by
  // company name collapse to the first-seen parent so the picker
  // stays clean — good enough for fuzzy matching, and the exact
  // parent is always reachable by drilling into the owning prospect.
  const { portfolioByNorm, portfolioNorms, allPortfolioCompanies } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    const all = [];
    for (const p of prospects) {
      const portfolio = p.portfolioCompanies || [];
      for (const pc of portfolio) {
        const name = String(pc?.companyName || '').trim();
        if (!name) continue;
        const entry = { company: name, parent: p.company, tier: p.tier, cdm: p.cdm, id: `${p.id || p.company}::${name}` };
        const norm = normalizeCompany(name);
        if (!norm) continue;
        if (!byNorm.has(norm)) byNorm.set(norm, entry);
        norms.push({ norm, prospect: entry });
        all.push(entry);
      }
    }
    return { portfolioByNorm: byNorm, portfolioNorms: norms, allPortfolioCompanies: all };
  }, [prospects]);

  const portfolioSuggestionFor = useMemo(
    () => (raw) => suggestFrom(raw, portfolioByNorm, portfolioNorms),
    [portfolioByNorm, portfolioNorms]
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
  function mapSettersFor(scope) {
    if (scope === 'myAccounts') return { setMap: setMyAccountMapping, setDis: setMyAccountDismissed };
    if (scope === 'portfolio') return { setMap: setPortfolioMapping, setDis: setPortfolioDismissed };
    return { setMap: setMapping, setDis: setDismissed };
  }
  function confirmMapping(matchKey, prospectCompany) {
    const scope = picker?.scope || 'tableView';
    const { setMap, setDis } = mapSettersFor(scope);
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
    const { setMap } = mapSettersFor(scope);
    setMap(prev => {
      const next = { ...prev };
      delete next[matchKey];
      return next;
    });
    setPicker(null);
  }
  function dismissSuggestion(matchKey, scope = 'tableView') {
    const { setDis } = mapSettersFor(scope);
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
      prospectsByNorm, myAccountsByNorm, portfolioByNorm,
      prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor,
      mapping, dismissed, myAccountMapping, myAccountDismissed,
      portfolioMapping, portfolioDismissed,
      textColumn, textValues, onTextChange: setTextValue,
      onPick: openPicker, onDismiss: dismissSuggestion,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, myAccountsByNorm, portfolioByNorm, prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor, mapping, dismissed, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, textColumn, textValues]
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
        c.key === '__portfolioList__' ||
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
    setUploadInfo(null);
    try {
      const buf = await file.arrayBuffer();
      const { rows: parsed } = parseBestSheet(new Uint8Array(buf));
      await saveListToIDB(storageKey, parsed);
      setStore({ data: parsed, source: 'override' });
      // Mappings and dismissals are keyed by the row's normalized
      // company name and live in localStorage, so they survive a
      // re-upload automatically — count how many re-attach so the user
      // can see their work wasn't lost.
      const nameKey = parsed.length ? pickNameKey(Object.keys(parsed[0])) : null;
      const newKeys = new Set();
      if (nameKey) {
        for (const row of parsed) {
          const raw = String(row[nameKey] ?? '').trim();
          const norm = normalizeCompany(raw);
          if (norm) newKeys.add(`name::${norm}`);
        }
      }
      const preservedTableView = Object.keys(mapping || {}).filter(k => newKeys.has(k)).length;
      const preservedMyAccounts = Object.keys(myAccountMapping || {}).filter(k => newKeys.has(k)).length;
      setUploadInfo({
        total: parsed.length,
        preservedTableView,
        preservedMyAccounts,
      });
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

  // Progress tracker for the user's My-Account mapping work on this
  // list. The numerator counts accounts that have at least one
  // confirmed mapping; the denominator is the accounts that have any
  // match on the list (confirmed OR non-dismissed suggestion). Once
  // every suggestion has been confirmed (or dismissed), the percentage
  // reads 100 % — which the user reads as "no more suggestions left
  // to resolve".
  const myAccountsCoverage = useMemo(() => {
    // Build the My Accounts set — prefer the resolved MyAccountsView
    // list, fall back to the Baldauf-CDM prospect pool.
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
    const totalAccounts = accountSet.size;

    const confirmedAccounts = new Set();
    const suggestedAccounts = new Set();
    for (const r of rows) {
      const mk = r.__matchKey__;
      if (myAccountDismissed[mk]) continue;
      const confirmedName = myAccountMapping[mk];
      if (typeof confirmedName === 'string' && confirmedName) {
        const key = confirmedName.toLowerCase().trim();
        if (accountSet.has(key)) confirmedAccounts.add(key);
        continue;
      }
      const suggestion = r.__rawName__ ? myAccountSuggestionFor(r.__rawName__) : null;
      if (suggestion) {
        const key = (suggestion.company || '').toLowerCase().trim();
        if (accountSet.has(key)) suggestedAccounts.add(key);
      }
    }
    // Accounts that still have an unresolved suggestion (i.e. show a
    // yellow chip on at least one row) count as pending — even if a
    // different row has already been confirmed we treat that row as
    // resolved and track per-row / per-account separately.
    const pendingAccounts = new Set(
      [...suggestedAccounts].filter(a => !confirmedAccounts.has(a))
    );
    const touched = confirmedAccounts.size + pendingAccounts.size;
    const pct = touched > 0 ? Math.round((confirmedAccounts.size / touched) * 100) : 0;
    return {
      mapped: confirmedAccounts.size,
      pending: pendingAccounts.size,
      touched,
      pct,
      totalAccounts,
    };
  }, [rows, myAccountNames, prospects, myAccountMapping, myAccountDismissed, myAccountSuggestionFor]);

  // Portfolio Companies mapping progress — same denominator /
  // numerator shape as myAccountsCoverage, but counted against the
  // union of portfolio companies across every prospect.
  const portfolioCoverage = useMemo(() => {
    const portfolioSet = new Set(
      allPortfolioCompanies
        .map(pc => String(pc.company || '').toLowerCase().trim())
        .filter(Boolean)
    );
    const totalPortfolio = portfolioSet.size;
    if (totalPortfolio === 0) return { mapped: 0, pending: 0, touched: 0, pct: 0, totalPortfolio: 0 };

    const confirmed = new Set();
    const suggested = new Set();
    for (const r of rows) {
      const mk = r.__matchKey__;
      if (portfolioDismissed[mk]) continue;
      const confirmedName = portfolioMapping[mk];
      if (typeof confirmedName === 'string' && confirmedName) {
        const key = confirmedName.toLowerCase().trim();
        if (portfolioSet.has(key)) confirmed.add(key);
        continue;
      }
      const suggestion = r.__rawName__ ? portfolioSuggestionFor(r.__rawName__) : null;
      if (suggestion) {
        const key = (suggestion.company || '').toLowerCase().trim();
        if (portfolioSet.has(key)) suggested.add(key);
      }
    }
    const pendingSet = new Set([...suggested].filter(k => !confirmed.has(k)));
    const touched = confirmed.size + pendingSet.size;
    const pct = touched > 0 ? Math.round((confirmed.size / touched) * 100) : 0;
    return {
      mapped: confirmed.size,
      pending: pendingSet.size,
      touched,
      pct,
      totalPortfolio,
    };
  }, [rows, allPortfolioCompanies, portfolioMapping, portfolioDismissed, portfolioSuggestionFor]);

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
    } else if (picker.scope === 'portfolio') {
      source = allPortfolioCompanies;
    } else {
      source = prospects;
    }
    const suggestFn = picker.scope === 'myAccounts'
      ? myAccountSuggestionFor
      : picker.scope === 'portfolio'
        ? portfolioSuggestionFor
        : prospectSuggestionFor;
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
  }, [picker, prospects, allPortfolioCompanies, prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor, myAccountNames]);

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
                {myAccountsCoverage.touched > 0 && (
                  <>
                    {' '}·
                    {' '}<strong style={{ color: myAccountsCoverage.pct === 100 ? '#166534' : '#1E3A8A' }}>
                      {myAccountsCoverage.mapped}/{myAccountsCoverage.touched}
                    </strong>{' '}
                    My Accounts mapped (
                    <strong style={{ color: myAccountsCoverage.pct === 100 ? '#166534' : '#1E3A8A' }}>
                      {myAccountsCoverage.pct}%
                    </strong>
                    )
                    {myAccountsCoverage.pending > 0 && (
                      <> · <strong style={{ color: '#92400E' }}>{myAccountsCoverage.pending}</strong> still suggested</>
                    )}
                  </>
                )}
                {portfolioCoverage.touched > 0 && (
                  <>
                    {' '}·
                    {' '}<strong style={{ color: portfolioCoverage.pct === 100 ? '#166534' : '#5B21B6' }}>
                      {portfolioCoverage.mapped}/{portfolioCoverage.touched}
                    </strong>{' '}
                    Portfolio Companies mapped (
                    <strong style={{ color: portfolioCoverage.pct === 100 ? '#166534' : '#5B21B6' }}>
                      {portfolioCoverage.pct}%
                    </strong>
                    )
                    {portfolioCoverage.pending > 0 && (
                      <> · <strong style={{ color: '#92400E' }}>{portfolioCoverage.pending}</strong> still suggested</>
                    )}
                  </>
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
            title={`Upload an Excel or CSV of ${title}. Existing My Accounts / Table View mappings are preserved across re-uploads — rows whose company name matches an earlier mapping pick it up automatically.`}
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
      {uploadInfo && (
        <div style={{ margin: '0.5rem 1.25rem', padding: '0.5rem 0.75rem', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 6, color: '#166534', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span>
            ✓ <strong>{uploadInfo.total.toLocaleString()}</strong> {uploadInfo.total === 1 ? 'row' : 'rows'} loaded.
            {(uploadInfo.preservedTableView + uploadInfo.preservedMyAccounts) > 0 ? (
              <>
                {' '}
                <strong>{uploadInfo.preservedMyAccounts}</strong> My Account mapping{uploadInfo.preservedMyAccounts === 1 ? '' : 's'}
                {' '}and <strong>{uploadInfo.preservedTableView}</strong> Table View mapping{uploadInfo.preservedTableView === 1 ? '' : 's'} re-attached from the previous file.
              </>
            ) : (
              <> No existing mappings matched the new rows.</>
            )}
          </span>
          <button
            type="button"
            onClick={() => setUploadInfo(null)}
            title="Dismiss"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#166534', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}
          >×</button>
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
            placeholder={picker.scope === 'myAccounts'
              ? 'Search My Accounts…'
              : picker.scope === 'portfolio'
                ? 'Search Portfolio Companies…'
                : 'Search Table View prospects…'}
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
          {((picker.scope === 'myAccounts'
              ? myAccountMapping
              : picker.scope === 'portfolio'
                ? portfolioMapping
                : mapping)[picker.matchKey]) && (
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
