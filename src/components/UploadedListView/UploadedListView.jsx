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
        style={{ background: confirmBg, border: `1px solid ${confirmBorder}`, borderRadius: 12, padding: '2px 8px', fontSize: '0.7rem', color: confirmText, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.25 }}
        title={`${confirmTitle} · ${prospect.company}`}
      >{confirmIcon} {prospect.company}</button>
    );
  }
  const isDismissed = dismissed[matchKey];
  if (!isDismissed) {
    const suggestion = suggestionFor(row.__rawName__ || '');
    if (suggestion) {
      const sProspect = suggestion.prospect;
      const pct = Math.round((suggestion.score || 0) * 100);
      return (
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 2, width: '100%', minWidth: 0 }}>
          <button
            type="button"
            data-mapping-cell={scope}
            onClick={handleClick}
            style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', borderRadius: 12, padding: '2px 8px', fontSize: '0.7rem', color: '#92400E', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flex: '0 1 auto', minWidth: 0, maxWidth: 'calc(100% - 20px)', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.25 }}
            title={`${suggestTitle} · ${sProspect.company} · ${pct}% match`}
          >{sProspect.company}</button>
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

function MatchPctCell({ row, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, myAccountSuggestionFor, portfolioSuggestionFor }) {
  const mk = row.__matchKey__;
  const raw = row.__rawName__ || '';
  // Only consider a scope's suggestion if it would actually be visible
  // in that scope's mapping cell — i.e. the row isn't already mapped
  // and the suggestion hasn't been dismissed. Otherwise the % column
  // would advertise a "match" that the user no longer sees on the row.
  const maAvailable = !myAccountMapping[mk] && !myAccountDismissed[mk];
  const pcAvailable = !portfolioMapping[mk] && !portfolioDismissed[mk];
  const ma = maAvailable ? myAccountSuggestionFor(raw) : null;
  const pc = pcAvailable ? portfolioSuggestionFor(raw) : null;
  // Show the higher of the two scopes' confidence so a single column
  // surfaces the best match available to the row regardless of where
  // it ends up getting mapped.
  const best = [ma, pc].filter(Boolean).reduce((acc, s) => (acc && acc.score >= s.score ? acc : s), null);
  if (!best) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>;
  const pct = Math.round((best.score || 0) * 100);
  // Color tracks confidence: green ≥80%, amber 60–79%, red <60%.
  const bg = pct >= 80 ? '#DCFCE7' : pct >= 60 ? '#FEF3C7' : '#FEE2E2';
  const border = pct >= 80 ? '#86EFAC' : pct >= 60 ? '#FCD34D' : '#FCA5A5';
  const color = pct >= 80 ? '#166534' : pct >= 60 ? '#92400E' : '#991B1B';
  return (
    <span
      title={`Match confidence: ${pct}% · best of My Accounts and Portfolio Companies suggestions`}
      style={{ background: bg, border: `1px solid ${border}`, color, borderRadius: 999, padding: '1px 8px', fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap' }}
    >{pct}%</span>
  );
}

function buildColumns(data, ctx) {
  if (!data.length) return [];
  const { prospectsByNorm, myAccountsByNorm, portfolioByNorm,
          prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor,
          mapping, dismissed, myAccountMapping, myAccountDismissed,
          portfolioMapping, portfolioDismissed,
          textColumn, textValues, onTextChange,
          onPick, onDismiss,
          selectedKeys, onToggleSelect } = ctx;
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id' && k !== '__matchKey__') keys.add(k);
  const baseCols = [...keys].map((k, i) => ({
    key: k,
    label: k,
    defaultWidth: i === 0 ? 240 : 140,
    ...(i === 0 ? { sticky: true } : {}),
  }));
  const selectCol = {
    key: '__select__',
    label: '',
    defaultWidth: 32,
    render: (row) => (
      <input
        type="checkbox"
        checked={!!selectedKeys?.has?.(row.__matchKey__)}
        onChange={(e) => { e.stopPropagation(); onToggleSelect?.(row.__matchKey__); }}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: 'pointer' }}
        aria-label="Select row for bulk actions"
      />
    ),
  };
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
  const portfolioInfoCol = {
    key: '__portfolioInfo__',
    label: 'PE Owner',
    defaultWidth: 180,
    render: (row) => {
      const mk = row.__matchKey__;
      // Prefer the confirmed mapping's owner; fall back to a live
      // fuzzy suggestion's owner so the user can see the context
      // before confirming.
      const confirmedName = portfolioMapping[mk];
      let entry = confirmedName ? portfolioByNorm.get(normalizeCompany(confirmedName)) : null;
      let fromSuggestion = false;
      if (!entry && !portfolioDismissed[mk]) {
        const s = row.__rawName__ ? portfolioSuggestionFor(row.__rawName__) : null;
        entry = s ? s.prospect : null;
        fromSuggestion = !!entry;
      }
      if (!entry || !entry.parent) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>—</span>;
      return (
        <span
          title={fromSuggestion
            ? `Owner of suggested match "${entry.company}" — confirm the mapping to lock it in`
            : `Owner of ${entry.company}`}
          style={{ fontSize: '0.72rem', color: fromSuggestion ? '#92400E' : 'var(--color-text-secondary)', fontStyle: fromSuggestion ? 'italic' : 'normal' }}
        >{entry.parent}</span>
      );
    },
  };
  const matchPctCol = {
    key: '__matchPct__',
    label: '% Match',
    defaultWidth: 90,
    render: (row) => (
      <MatchPctCell
        row={row}
        myAccountMapping={myAccountMapping}
        myAccountDismissed={myAccountDismissed}
        portfolioMapping={portfolioMapping}
        portfolioDismissed={portfolioDismissed}
        myAccountSuggestionFor={myAccountSuggestionFor}
        portfolioSuggestionFor={portfolioSuggestionFor}
      />
    ),
  };
  return [selectCol, ...baseCols, ...textCol, myAccountsCol, myAccountsInfoCol, portfolioCol, portfolioInfoCol, matchPctCol];
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
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [mappedOnly, setMappedOnly] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadInfo, setUploadInfo] = useState(null); // { total, preservedTableView, preservedMyAccounts }
  const [picker, setPicker] = useState(null); // { matchKey, raw, query, scope: 'tableView' | 'myAccounts' }
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
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
    setPortfolioOnly(false);
    setMappedOnly(false);
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

  // Returns { prospect, score } where score is 0–1. Score is 1 for exact
  // normalized matches, and the shorter/longer length ratio for substring
  // containment matches — so "tiaa" against "tiaa cref" scores higher
  // than "tiaa" against "(tiaa) teachers insurance and annuity association".
  function suggestFrom(raw, byNorm, norms) {
    const norm = normalizeCompany(raw);
    if (!norm) return null;
    const exact = byNorm.get(norm);
    if (exact) return { prospect: exact, score: 1 };
    let best = null;
    for (const { norm: pn, prospect } of norms) {
      if (pn === norm) return { prospect, score: 1 };
      if (pn.length < 3) continue;
      if (norm.includes(pn) || pn.includes(norm)) {
        if (!best || pn.length < best.pn.length) best = { pn, prospect };
      }
    }
    if (!best) return null;
    const shorter = Math.min(norm.length, best.pn.length);
    const longer = Math.max(norm.length, best.pn.length);
    const score = longer > 0 ? shorter / longer : 0;
    return { prospect: best.prospect, score };
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
  function toggleSelectKey(matchKey) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(matchKey)) next.delete(matchKey);
      else next.add(matchKey);
      return next;
    });
  }
  function clearSelection() { setSelectedKeys(new Set()); }
  // Confirms each selected row's live suggestion in `scope` (skipping
  // rows that are already mapped, dismissed, or have no suggestion).
  function bulkAccept(scope) {
    const suggestFn = scope === 'myAccounts' ? myAccountSuggestionFor : portfolioSuggestionFor;
    const mappingState = scope === 'myAccounts' ? myAccountMapping : portfolioMapping;
    const dismissedState = scope === 'myAccounts' ? myAccountDismissed : portfolioDismissed;
    const { setMap, setDis } = mapSettersFor(scope);
    const updates = {};
    const unDismiss = [];
    for (const r of rows) {
      const mk = r.__matchKey__;
      if (!selectedKeys.has(mk)) continue;
      if (mappingState[mk]) continue;
      if (dismissedState[mk]) continue;
      const sugg = r.__rawName__ ? suggestFn(r.__rawName__) : null;
      if (sugg?.prospect?.company) {
        updates[mk] = sugg.prospect.company;
      }
    }
    if (Object.keys(updates).length === 0) return;
    setMap(prev => ({ ...prev, ...updates }));
    setDis(prev => {
      let changed = false;
      const next = { ...prev };
      for (const mk of Object.keys(updates)) {
        if (next[mk]) { delete next[mk]; changed = true; }
      }
      return changed ? next : prev;
    });
    // Drop the now-confirmed rows from the selection so a follow-up
    // "Dismiss" doesn't accidentally hit them.
    setSelectedKeys(prev => {
      const next = new Set(prev);
      for (const mk of Object.keys(updates)) next.delete(mk);
      return next;
    });
  }
  // Dismisses each selected row's live suggestion in `scope` (skipping
  // rows that are already mapped or have no live suggestion).
  function bulkDismiss(scope) {
    const suggestFn = scope === 'myAccounts' ? myAccountSuggestionFor : portfolioSuggestionFor;
    const mappingState = scope === 'myAccounts' ? myAccountMapping : portfolioMapping;
    const dismissedState = scope === 'myAccounts' ? myAccountDismissed : portfolioDismissed;
    const { setDis } = mapSettersFor(scope);
    const updates = {};
    for (const r of rows) {
      const mk = r.__matchKey__;
      if (!selectedKeys.has(mk)) continue;
      if (mappingState[mk]) continue;
      if (dismissedState[mk]) continue;
      const sugg = r.__rawName__ ? suggestFn(r.__rawName__) : null;
      if (sugg?.prospect) updates[mk] = true;
    }
    if (Object.keys(updates).length === 0) return;
    setDis(prev => ({ ...prev, ...updates }));
  }
  // Counts of selected rows that currently show a live suggestion in
  // each scope, used to label the toolbar buttons and to disable them
  // when there's nothing to do.
  function pendingCountFor(scope) {
    const suggestFn = scope === 'myAccounts' ? myAccountSuggestionFor : portfolioSuggestionFor;
    const mappingState = scope === 'myAccounts' ? myAccountMapping : portfolioMapping;
    const dismissedState = scope === 'myAccounts' ? myAccountDismissed : portfolioDismissed;
    let n = 0;
    for (const r of rows) {
      if (!selectedKeys.has(r.__matchKey__)) continue;
      if (mappingState[r.__matchKey__]) continue;
      if (dismissedState[r.__matchKey__]) continue;
      if (r.__rawName__ && suggestFn(r.__rawName__)) n++;
    }
    return n;
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
      selectedKeys, onToggleSelect: toggleSelectKey,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, myAccountsByNorm, portfolioByNorm, prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor, mapping, dismissed, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, textColumn, textValues, selectedKeys]
  );
  const tableId = useMemo(
    () => `${tableIdPrefix}:` + columns.map(c => c.key).sort().join('|'),
    [columns, tableIdPrefix]
  );
  const alwaysVisible = useMemo(() => {
    // Pin the leftmost helper columns plus the first uploaded-data
    // column (the company name) so the user can't accidentally hide the
    // selection checkbox or the row identifier via the column toggle.
    const keys = [];
    keys.push('__select__');
    const firstDataCol = columns.find(c => !String(c.key || '').startsWith('__'));
    if (firstDataCol) keys.push(firstDataCol.key);
    for (const c of columns) {
      if (
        c.key === '__myAccountsList__' ||
        c.key === '__myAccountsInfo__' ||
        c.key === '__portfolioList__' ||
        c.key === '__portfolioInfo__' ||
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

  const isPortfolioRow = useMemo(() => (r) => {
    if (portfolioMapping[r.__matchKey__]) return true;
    if (portfolioDismissed[r.__matchKey__]) return false;
    return !!portfolioSuggestionFor(r.__rawName__ || '');
  }, [portfolioMapping, portfolioDismissed, portfolioSuggestionFor]);

  // "Mapped" = the row carries a confirmed My-Account or Portfolio
  // mapping. Non-dismissed suggestions aren't mapped yet.
  const isMappedRow = useMemo(() => (r) => (
    !!myAccountMapping[r.__matchKey__] || !!portfolioMapping[r.__matchKey__]
  ), [myAccountMapping, portfolioMapping]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(r =>
        Object.entries(r).some(([k, v]) => k !== '__matchKey__' && String(v).toLowerCase().includes(term))
      );
    }
    // "My Accounts only" / "Portfolio only" OR together when both are
    // on so the user sees the union of everything they've flagged.
    if (suggestedOnly || portfolioOnly) {
      result = result.filter(r => (
        (suggestedOnly && isMyAccountsRow(r)) ||
        (portfolioOnly && isPortfolioRow(r))
      ));
    }
    // "Mapped only" ANDs with everything else — narrows whatever's
    // already on-screen down to rows with at least one confirmed
    // My-Account or Portfolio mapping.
    if (mappedOnly) {
      result = result.filter(isMappedRow);
    }
    // Stamp each row with its current best-suggestion confidence (the
    // same score the % Match column displays) so the table can sort by
    // it. Mirrors MatchPctCell's "skip dismissed / mapped scopes" rule
    // so the sort order matches what the user actually sees.
    return result.map(r => {
      const mk = r.__matchKey__;
      const raw = r.__rawName__ || '';
      const maAvailable = !myAccountMapping[mk] && !myAccountDismissed[mk];
      const pcAvailable = !portfolioMapping[mk] && !portfolioDismissed[mk];
      const ma = maAvailable ? myAccountSuggestionFor(raw) : null;
      const pc = pcAvailable ? portfolioSuggestionFor(raw) : null;
      const best = [ma, pc].filter(Boolean).reduce((acc, s) => (acc && acc.score >= s.score ? acc : s), null);
      return { ...r, __matchPct__: best ? Math.round(best.score * 100) : null };
    });
  }, [search, suggestedOnly, portfolioOnly, mappedOnly, rows, isMyAccountsRow, isPortfolioRow, isMappedRow, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, myAccountSuggestionFor, portfolioSuggestionFor]);

  const myAccountsMatchCount = useMemo(
    () => rows.reduce((n, r) => n + (isMyAccountsRow(r) ? 1 : 0), 0),
    [rows, isMyAccountsRow]
  );
  const portfolioMatchCount = useMemo(
    () => rows.reduce((n, r) => n + (isPortfolioRow(r) ? 1 : 0), 0),
    [rows, isPortfolioRow]
  );
  const mappedCount = useMemo(
    () => rows.reduce((n, r) => n + (isMappedRow(r) ? 1 : 0), 0),
    [rows, isMappedRow]
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
      if (suggestion?.prospect) {
        const key = (suggestion.prospect.company || '').toLowerCase().trim();
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
      if (suggestion?.prospect) {
        const key = (suggestion.prospect.company || '').toLowerCase().trim();
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
    const autoSuggestion = picker.raw ? suggestFn(picker.raw) : null;
    const auto = autoSuggestion?.prospect || null;
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
        <button
          type="button"
          onClick={() => setPortfolioOnly(v => !v)}
          title="Show only list rows that match a company on Portfolio Companies (live — across every prospect)"
          style={{
            padding: '0.35rem 0.7rem',
            border: `1px solid ${portfolioOnly ? '#8B5CF6' : 'var(--color-border)'}`,
            borderRadius: 6,
            background: portfolioOnly ? '#EDE9FE' : '#fff',
            color: portfolioOnly ? '#5B21B6' : 'var(--color-text-secondary)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          ◆ {portfolioOnly ? 'Showing Portfolio only' : 'Portfolio only'}
          {portfolioMatchCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.68rem', color: portfolioOnly ? '#5B21B6' : '#94A3B8' }}>
              {portfolioMatchCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMappedOnly(v => !v)}
          title="Show only list rows with a confirmed My Accounts or Portfolio Companies mapping. Combines with the other filters."
          style={{
            padding: '0.35rem 0.7rem',
            border: `1px solid ${mappedOnly ? '#16A34A' : 'var(--color-border)'}`,
            borderRadius: 6,
            background: mappedOnly ? '#DCFCE7' : '#fff',
            color: mappedOnly ? '#166534' : 'var(--color-text-secondary)',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          ✓ {mappedOnly ? 'Showing Mapped only' : 'Mapped only'}
          {mappedCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: '0.68rem', color: mappedOnly ? '#166534' : '#94A3B8' }}>
              {mappedCount}
            </span>
          )}
        </button>
        {(() => {
          // Only count rows that currently show a yellow suggestion pill
          // in at least one scope — i.e. not already mapped and not
          // dismissed. The button targets exactly those rows so a single
          // click teases up everything that still needs a decision.
          const suggestedKeys = filtered
            .filter(r => {
              const mk = r.__matchKey__;
              const raw = r.__rawName__ || '';
              const maLive = !myAccountMapping[mk] && !myAccountDismissed[mk] && !!myAccountSuggestionFor(raw);
              const pcLive = !portfolioMapping[mk] && !portfolioDismissed[mk] && !!portfolioSuggestionFor(raw);
              return maLive || pcLive;
            })
            .map(r => r.__matchKey__);
          if (suggestedKeys.length === 0) return null;
          const visibleSelected = suggestedKeys.filter(k => selectedKeys.has(k)).length;
          const allVisibleSelected = visibleSelected === suggestedKeys.length;
          const toggle = () => {
            if (allVisibleSelected) {
              setSelectedKeys(prev => {
                const next = new Set(prev);
                for (const k of suggestedKeys) next.delete(k);
                return next;
              });
            } else {
              setSelectedKeys(prev => {
                const next = new Set(prev);
                for (const k of suggestedKeys) next.add(k);
                return next;
              });
            }
          };
          return (
            <button
              type="button"
              onClick={toggle}
              title={allVisibleSelected
                ? 'Deselect all rows with a live suggestion (the yellow pills)'
                : 'Select every row showing a yellow suggestion in either My Accounts or Portfolio Companies'}
              style={{
                padding: '0.35rem 0.7rem',
                border: `1px solid ${allVisibleSelected ? '#F59E0B' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: allVisibleSelected ? '#FEF3C7' : '#fff',
                color: allVisibleSelected ? '#92400E' : 'var(--color-text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {allVisibleSelected ? 'Deselect suggested' : 'Select all suggested'}
              <span style={{ marginLeft: 6, fontSize: '0.68rem', color: allVisibleSelected ? '#92400E' : '#94A3B8' }}>
                {suggestedKeys.length}
              </span>
            </button>
          );
        })()}
        {(search || suggestedOnly || portfolioOnly || mappedOnly) && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      {selectedKeys.size > 0 && (() => {
        const acceptMa = pendingCountFor('myAccounts');
        const acceptPc = pendingCountFor('portfolio');
        const baseBtn = { padding: '0.35rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
        const accentBtn = (active) => ({ ...baseBtn, border: `1px solid ${active ? '#16A34A' : 'var(--color-border)'}`, background: active ? '#DCFCE7' : '#fff', color: active ? '#166534' : '#94A3B8' });
        const dismissBtn = (active) => ({ ...baseBtn, border: `1px solid ${active ? '#DC2626' : 'var(--color-border)'}`, background: active ? '#FEE2E2' : '#fff', color: active ? '#991B1B' : '#94A3B8' });
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem 1.25rem', background: '#F1F5F9', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1E293B' }}>
              {selectedKeys.size} selected
            </span>
            <button type="button" style={accentBtn(acceptMa > 0)} disabled={acceptMa === 0} onClick={() => bulkAccept('myAccounts')}>
              ★ Accept My Accounts {acceptMa > 0 && `(${acceptMa})`}
            </button>
            <button type="button" style={accentBtn(acceptPc > 0)} disabled={acceptPc === 0} onClick={() => bulkAccept('portfolio')}>
              ◆ Accept Portfolio {acceptPc > 0 && `(${acceptPc})`}
            </button>
            <button type="button" style={dismissBtn(acceptMa > 0)} disabled={acceptMa === 0} onClick={() => bulkDismiss('myAccounts')}>
              Dismiss MA suggestion
            </button>
            <button type="button" style={dismissBtn(acceptPc > 0)} disabled={acceptPc === 0} onClick={() => bulkDismiss('portfolio')}>
              Dismiss PC suggestion
            </button>
            <button type="button" style={{ ...baseBtn, border: 'none', background: 'transparent', color: 'var(--color-text-secondary)', textDecoration: 'underline', padding: '0.35rem 0.4rem' }} onClick={clearSelection}>
              Clear
            </button>
          </div>
        );
      })()}
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
