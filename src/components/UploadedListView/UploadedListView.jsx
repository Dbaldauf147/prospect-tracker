import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { saveList as saveListToIDB, loadList as loadListFromIDB, clearList as clearListFromIDB } from '../../utils/uploadedListStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import { matchesCdm, resolveTargetAccountCdm } from '../../utils/cdmMatch';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { dbGet } from '../../utils/db';
import { userLsGet, userLsSet, userLsRemove } from '../../utils/userLs';
import styles from './UploadedListView.module.css';

function loadMapping(key) {
  if (!key) return {};
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Format a cell value as a short-form date (M/D/YYYY). The xlsx parser
// reads with raw:true (no cellDates), so spreadsheet dates arrive as
// Excel serial numbers; CSVs arrive as strings. Handle both, and return
// the original value untouched when it isn't a recognizable date.
function formatShortDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    // Excel serial: days since 1899-12-30. 25569 = days to the Unix epoch.
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (!isNaN(d.getTime())) return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  // ISO-ish "2025-12-31" / "2025-12-31T..." — format from the literal
  // parts so a timezone offset can't shift the displayed day.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return s;
}

// Tokenize a name to a lowercased alphanumeric token set so "Daniel
// Baldauf", "Baldauf, Daniel" and "DANIEL BALDAUF" all compare equal.
function nameTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

// True when `cellVal` contains every token of at least one target name —
// order-independent, punctuation-insensitive.
function matchesAnyName(cellVal, targets) {
  const cellSet = new Set(nameTokens(cellVal));
  if (cellSet.size === 0) return false;
  return (targets || []).some(t => {
    const toks = nameTokens(t);
    return toks.length > 0 && toks.every(tok => cellSet.has(tok));
  });
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
    >(Map)</button>
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
      {value || placeholder || '-'}
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
  if (!best) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
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

// Resolve a list row's value for a header name, case-insensitively and
// ignoring the internal bookkeeping keys. Returns undefined when the
// column isn't present.
function valueFromColumn(row, colName) {
  if (!colName) return undefined;
  const target = String(colName).trim().toLowerCase();
  for (const k of Object.keys(row)) {
    if (k === 'id' || k === '__matchKey__' || k === '__rawName__') continue;
    if (String(k).trim().toLowerCase() === target) return row[k];
  }
  return undefined;
}

// Looks up the Table View prospect that best matches a list row and
// either shows that prospect's existing field value (e.g. its BFO
// Company Name) or, when the prospect has a similar name but no value
// yet, offers a one-click button to fill it. The value written is the
// row's matched name by default, or — when `fillFromColumn` is set — the
// value of that named list column (e.g. "Account Name").
function ProspectFillCell({ row, mapping, dismissed, prospectSuggestionFor, prospectsByNorm, field, label, fillFromColumn, onFill }) {
  const [busy, setBusy] = useState(false);
  const mk = row.__matchKey__;
  const raw = row.__rawName__ || '';
  // The value we'd write into Table View: a specific list column when
  // configured (resolved case-insensitively), otherwise the matched name.
  const fillValue = fillFromColumn
    ? String(valueFromColumn(row, fillFromColumn) ?? '').trim()
    : raw;
  // Prefer a confirmed Table View mapping; otherwise fall back to the
  // best live similar-name suggestion (unless the row was dismissed).
  let prospect = null;
  const confirmed = mapping[mk];
  if (confirmed) prospect = prospectsByNorm.get(normalizeCompany(confirmed));
  if (!prospect && !dismissed[mk]) {
    const s = raw ? prospectSuggestionFor(raw) : null;
    prospect = s?.prospect || null;
  }
  if (!prospect) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
  const current = prospect[field];
  if (current != null && String(current).trim() !== '') {
    // Already populated in Table View — show the looked-up value.
    return (
      <span title={`${label} from Table View · ${prospect.company}`} style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
        {String(current)}
      </span>
    );
  }
  if (!fillValue) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
  // Blank in Table View — offer to set it to this row's fill value.
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try { await onFill(prospect.id, fillValue); } finally { setBusy(false); }
      }}
      title={`Set ${prospect.company}'s ${label} to "${fillValue}"`}
      style={{
        padding: '1px 8px', borderRadius: 999, border: '1px solid #FCD34D',
        background: '#FEF3C7', color: '#92400E', fontSize: '0.65rem', fontWeight: 700,
        cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? 'Saving…' : `+ Set on ${prospect.company}`}
    </button>
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
          selectedKeys, onToggleSelect, shortDateColumns,
          prospectFieldFill, onFillProspectField,
          accountLabel = 'My Accounts', accountSource = 'myAccounts' } = ctx;
  const keys = new Set();
  for (const row of data) for (const k of Object.keys(row)) if (k !== 'id' && k !== '__matchKey__') keys.add(k);
  // Headers (case-insensitive) whose values should render as short dates.
  const dateColSet = new Set((shortDateColumns || []).map(h => String(h).trim().toLowerCase()));
  const baseCols = [...keys].map((k, i) => {
    const col = {
      key: k,
      label: k,
      defaultWidth: i === 0 ? 240 : 140,
      ...(i === 0 ? { sticky: true } : {}),
    };
    if (dateColSet.has(String(k).trim().toLowerCase())) {
      col.getFilterValue = (row) => formatShortDate(row[k]);
      col.render = (row) => formatShortDate(row[k]);
    }
    return col;
  });
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
        getFilterValue: (row) => textValues[row.__matchKey__] || '',
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
    label: accountLabel,
    defaultWidth: 220,
    // Filter by the company name actually displayed in the cell — either
    // the confirmed mapping or, if none, the live yellow suggestion.
    getFilterValue: (row) => {
      const mk = row.__matchKey__;
      const confirmed = myAccountMapping[mk];
      if (confirmed) {
        const p = myAccountsByNorm.get(normalizeCompany(confirmed));
        return p?.company || confirmed;
      }
      if (myAccountDismissed[mk]) return '';
      const s = row.__rawName__ ? myAccountSuggestionFor(row.__rawName__) : null;
      return s?.prospect?.company || '';
    },
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
    // Filter on the visible chips, e.g. "Tier 1 Qualifying".
    getFilterValue: (row) => {
      const mapped = myAccountMapping[row.__matchKey__];
      const prospect = mapped ? myAccountsByNorm.get(normalizeCompany(mapped)) : null;
      if (!prospect) return '';
      return `${prospect.tier || ''} ${prospect.status || ''}`.trim();
    },
    render: (row) => {
      const mapped = myAccountMapping[row.__matchKey__];
      const prospect = mapped ? myAccountsByNorm.get(normalizeCompany(mapped)) : null;
      if (!prospect) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
      const tierStyle = TIER_COLORS[prospect.tier] || { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155' };
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {prospect.tier && (
            <span
              style={{ background: tierStyle.bg, border: `1px solid ${tierStyle.border}`, color: tierStyle.text, borderRadius: 999, padding: '1px 8px', fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap' }}
              title={`${prospect.company} · ${prospect.tier}`}
            >{prospect.tier}</span>
          )}
          {prospect.status && (
            <span
              style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', borderRadius: 999, padding: '1px 8px', fontSize: '0.65rem', fontWeight: 600, whiteSpace: 'nowrap' }}
              title={`${prospect.company} · ${prospect.status}`}
            >{prospect.status}</span>
          )}
          {!prospect.tier && !prospect.status && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>
          )}
        </span>
      );
    },
  };
  // CDM / salesperson who owns the matched Target Account. Only added
  // when this list matches against the Target Accounts workbook — the
  // matched entry carries its own `cdm`. Mirrors the confirmed-then-
  // suggested resolution used by the info/owner columns.
  const resolveAccountEntry = (row) => {
    const mk = row.__matchKey__;
    const confirmed = myAccountMapping[mk];
    if (confirmed) return { entry: myAccountsByNorm.get(normalizeCompany(confirmed)), fromSuggestion: false };
    if (myAccountDismissed[mk]) return { entry: null, fromSuggestion: false };
    const s = row.__rawName__ ? myAccountSuggestionFor(row.__rawName__) : null;
    return { entry: s?.prospect || null, fromSuggestion: !!s?.prospect };
  };
  const accountCdmCol = {
    key: '__accountCdm__',
    label: 'CDM',
    defaultWidth: 150,
    getFilterValue: (row) => resolveAccountEntry(row).entry?.cdm || '',
    render: (row) => {
      const { entry, fromSuggestion } = resolveAccountEntry(row);
      if (!entry || !entry.cdm) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
      return (
        <span
          title={fromSuggestion ? `CDM for suggested match "${entry.company}": confirm to lock it in` : `CDM for ${entry.company}`}
          style={{ fontSize: '0.72rem', color: fromSuggestion ? '#92400E' : 'var(--color-text-secondary)', fontStyle: fromSuggestion ? 'italic' : 'normal' }}
        >{entry.cdm}</span>
      );
    },
  };
  const portfolioCol = {
    key: '__portfolioList__',
    label: 'Portfolio Companies',
    defaultWidth: 220,
    // Filter on the visible portfolio company name (confirmed or
    // suggested), so typing "Acme" surfaces every list row mapped or
    // suggested to "Acme Holdings".
    getFilterValue: (row) => {
      const mk = row.__matchKey__;
      const confirmed = portfolioMapping[mk];
      if (confirmed) {
        const p = portfolioByNorm.get(normalizeCompany(confirmed));
        return p?.company || confirmed;
      }
      if (portfolioDismissed[mk]) return '';
      const s = row.__rawName__ ? portfolioSuggestionFor(row.__rawName__) : null;
      return s?.prospect?.company || '';
    },
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
    // Filter on the parent (PE owner) name shown in the cell — either
    // from the confirmed mapping or from a live suggestion.
    getFilterValue: (row) => {
      const mk = row.__matchKey__;
      const confirmed = portfolioMapping[mk];
      let entry = confirmed ? portfolioByNorm.get(normalizeCompany(confirmed)) : null;
      if (!entry && !portfolioDismissed[mk]) {
        const s = row.__rawName__ ? portfolioSuggestionFor(row.__rawName__) : null;
        entry = s ? s.prospect : null;
      }
      return entry?.parent || '';
    },
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
      if (!entry || !entry.parent) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>-</span>;
      return (
        <span
          title={fromSuggestion
            ? `Owner of suggested match "${entry.company}": confirm the mapping to lock it in`
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
    getFilterValue: (row) => row.__matchPct__ != null ? `${row.__matchPct__}%` : '',
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
  // Optional write-back column: look up the matched Table View
  // prospect's field (e.g. BFO Company Name) and let the user fill it
  // when a similar-named prospect is missing it.
  const prospectFillCol = prospectFieldFill?.field
    ? [{
        key: '__prospectFill__',
        label: `${prospectFieldFill.label || prospectFieldFill.field} (Table View)`,
        defaultWidth: 200,
        getFilterValue: (row) => {
          const mk = row.__matchKey__;
          const confirmed = mapping[mk];
          let prospect = confirmed ? prospectsByNorm.get(normalizeCompany(confirmed)) : null;
          if (!prospect && !dismissed[mk]) {
            const s = row.__rawName__ ? prospectSuggestionFor(row.__rawName__) : null;
            prospect = s?.prospect || null;
          }
          const v = prospect?.[prospectFieldFill.field];
          return v != null ? String(v) : '';
        },
        render: (row) => (
          <ProspectFillCell
            row={row}
            mapping={mapping}
            dismissed={dismissed}
            prospectSuggestionFor={prospectSuggestionFor}
            prospectsByNorm={prospectsByNorm}
            field={prospectFieldFill.field}
            label={prospectFieldFill.label || prospectFieldFill.field}
            fillFromColumn={prospectFieldFill.fillFromColumn}
            onFill={onFillProspectField}
          />
        ),
      }]
    : [];
  const accountCdmCols = accountSource === 'targetAccounts' ? [accountCdmCol] : [];
  return [selectCol, ...baseCols, ...textCol, myAccountsCol, myAccountsInfoCol, ...accountCdmCols, portfolioCol, portfolioInfoCol, matchPctCol, ...prospectFillCol];
}

export function UploadedListView({
  storageKey,
  title,
  tableIdPrefix,
  singular = 'entry',
  plural = 'entries',
  prospects = [],
  onSelectProspect,
  cdmName,
  // Which set the account-match column fuzzy-matches against:
  // 'myAccounts' (default — the current user's My Accounts / CDM pool)
  // or 'targetAccounts' (the full Target Accounts workbook, across every
  // CDM). When 'targetAccounts', the column is relabeled via accountLabel
  // and a CDM column is added showing which salesperson owns the match.
  accountSource = 'myAccounts',
  accountLabel = 'My Accounts',
  textColumn, // { key: string, label: string, placeholder?: string }
  shortDateColumns, // array of header names to render as M/D/YYYY
  defaultHideWhere, // { column, values: string[], label } — default-on row exclusion
  prospectFieldFill, // { field, label } — adds a Table View write-back column
  updateProspect, // (id, patch) => Promise — required for prospectFieldFill
  settings,
  updateSettings,
  updateSettingsPath,
}) {
  const [store, setStore] = useState({ data: [], source: 'empty' });
  const mappingKey = storageKey ? `${storageKey}:account-mapping` : '';
  const dismissedKey = storageKey ? `${storageKey}:account-dismissed` : '';
  const myAccountMappingKey = storageKey ? `${storageKey}:my-accounts-mapping` : '';
  const myAccountDismissedKey = storageKey ? `${storageKey}:my-accounts-dismissed` : '';
  const portfolioMappingKey = storageKey ? `${storageKey}:portfolio-mapping` : '';
  const portfolioDismissedKey = storageKey ? `${storageKey}:portfolio-dismissed` : '';
  // Per-list block sets, keyed by normalized company name. Suppress a
  // suggested account from showing as a yellow pill on every row of
  // this list (without affecting confirmed mappings or other lists).
  const tableViewBlockedKey = storageKey ? `${storageKey}:table-view-blocked` : '';
  const myAccountBlockedKey = storageKey ? `${storageKey}:my-accounts-blocked` : '';
  const portfolioBlockedKey = storageKey ? `${storageKey}:portfolio-blocked` : '';
  const textValuesKey = storageKey && textColumn ? `${storageKey}:${textColumn.key}-values` : '';

  // Firestore-backed mappings — these survive a browser "Clear site
  // data" and sync across devices. Written via updateSettingsPath when
  // available so two lists (or two tabs) editing different paths can't
  // clobber each other. Localstorage continues to be mirrored every
  // save as a fast/offline cache. On read we prefer Firestore once
  // settings has loaded; fall back to localStorage otherwise.
  const settingsLoaded = !!(settings && settings._lastWriteAt);
  const remoteMappings = settings?.listMappings?.[storageKey];
  const initFromRemote = (field, lsKey) => {
    if (remoteMappings && remoteMappings[field] && typeof remoteMappings[field] === 'object') {
      return remoteMappings[field];
    }
    return loadMapping(lsKey);
  };
  const [mapping, setMapping] = useState(() => initFromRemote('mapping', mappingKey));
  const [dismissed, setDismissed] = useState(() => initFromRemote('dismissed', dismissedKey));
  const [myAccountMapping, setMyAccountMapping] = useState(() => initFromRemote('myAccountMapping', myAccountMappingKey));
  const [myAccountDismissed, setMyAccountDismissed] = useState(() => initFromRemote('myAccountDismissed', myAccountDismissedKey));
  const [portfolioMapping, setPortfolioMapping] = useState(() => initFromRemote('portfolioMapping', portfolioMappingKey));
  const [portfolioDismissed, setPortfolioDismissed] = useState(() => initFromRemote('portfolioDismissed', portfolioDismissedKey));
  const [tableViewBlocked, setTableViewBlocked] = useState(() => initFromRemote('tableViewBlocked', tableViewBlockedKey));
  const [myAccountBlocked, setMyAccountBlocked] = useState(() => initFromRemote('myAccountBlocked', myAccountBlockedKey));
  const [portfolioBlocked, setPortfolioBlocked] = useState(() => initFromRemote('portfolioBlocked', portfolioBlockedKey));
  const [textValues, setTextValues] = useState(() => {
    if (!textColumn) return {};
    const remote = remoteMappings?.textValues?.[textColumn.key];
    if (remote && typeof remote === 'object') return remote;
    return loadMapping(textValuesKey);
  });

  // Persist any state change to BOTH localStorage (instant, offline)
  // and Firestore (durable, cross-device). Firestore writes use
  // updateSettingsPath so we touch only the specific list/field path
  // and don't risk clobbering another list's mappings if the local
  // settings snapshot is stale.
  function persistMapping(field, lsKey, value) {
    try {
      if (Object.keys(value).length === 0) userLsRemove(lsKey);
      else userLsSet(lsKey, JSON.stringify(value));
    } catch {}
    if (!storageKey) return;
    if (updateSettingsPath) {
      updateSettingsPath({ [`listMappings.${storageKey}.${field}`]: value });
    } else if (updateSettings) {
      const currentList = settings?.listMappings?.[storageKey] || {};
      updateSettings({
        listMappings: {
          ...(settings?.listMappings || {}),
          [storageKey]: { ...currentList, [field]: value },
        },
      });
    }
  }
  function persistTextValues(value) {
    try {
      if (Object.keys(value).length === 0 && textValuesKey) userLsRemove(textValuesKey);
      else if (textValuesKey) userLsSet(textValuesKey, JSON.stringify(value));
    } catch {}
    if (!storageKey || !textColumn) return;
    if (updateSettingsPath) {
      updateSettingsPath({ [`listMappings.${storageKey}.textValues.${textColumn.key}`]: value });
    } else if (updateSettings) {
      const currentList = settings?.listMappings?.[storageKey] || {};
      const currentText = currentList.textValues || {};
      updateSettings({
        listMappings: {
          ...(settings?.listMappings || {}),
          [storageKey]: {
            ...currentList,
            textValues: { ...currentText, [textColumn.key]: value },
          },
        },
      });
    }
  }
  const [search, setSearch] = useState('');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [mappedOnly, setMappedOnly] = useState(false);
  // "Select all suggested" turns this on so the table narrows to just the
  // rows showing a live yellow suggestion pill (My Accounts or Portfolio).
  const [suggestedPillsOnly, setSuggestedPillsOnly] = useState(false);
  // Default-on exclusion (e.g. hide rows whose Opportunity Leader is
  // Daniel Baldauf). Starts hidden; the user can toggle them back in.
  const [hideExcluded, setHideExcluded] = useState(true);
  const [uploadError, setUploadError] = useState(null);
  const [uploadInfo, setUploadInfo] = useState(null); // { total, preservedTableView, preservedMyAccounts }
  const [picker, setPicker] = useState(null); // { matchKey, raw, query, scope: 'tableView' | 'myAccounts' }
  // Bulk-mapping picker — like `picker` but applies the chosen company
  // to every currently selected row in the given scope.
  const [bulkPicker, setBulkPicker] = useState(null); // { scope, query }
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  // Manual "Add row" modal — { [header]: draftValue }, or null when closed.
  const [addRowDraft, setAddRowDraft] = useState(null);
  const fileInputRef = useRef(null);
  const { data, source } = store;

  // Column names offered in the Add-row form: the union of headers across
  // the current list (document order). When the list is still empty there
  // are no headers yet, so seed a single company-name field the matching
  // logic understands.
  const manualHeaders = useMemo(() => {
    const hs = [];
    const seen = new Set();
    for (const row of data) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) { seen.add(k); hs.push(k); }
      }
    }
    return hs.length ? hs : ['Company Name'];
  }, [data]);

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
    // Re-init mappings for the new storageKey. Prefer Firestore when it
    // has data for this list; otherwise fall back to localStorage.
    const newRemote = settings?.listMappings?.[storageKey];
    const pickRemote = (field, lsKey) => {
      if (newRemote && newRemote[field] && typeof newRemote[field] === 'object') return newRemote[field];
      return loadMapping(lsKey);
    };
    setMapping(pickRemote('mapping', `${storageKey}:account-mapping`));
    setDismissed(pickRemote('dismissed', `${storageKey}:account-dismissed`));
    setMyAccountMapping(pickRemote('myAccountMapping', `${storageKey}:my-accounts-mapping`));
    setMyAccountDismissed(pickRemote('myAccountDismissed', `${storageKey}:my-accounts-dismissed`));
    setPortfolioMapping(pickRemote('portfolioMapping', `${storageKey}:portfolio-mapping`));
    setPortfolioDismissed(pickRemote('portfolioDismissed', `${storageKey}:portfolio-dismissed`));
    setTableViewBlocked(pickRemote('tableViewBlocked', `${storageKey}:table-view-blocked`));
    setMyAccountBlocked(pickRemote('myAccountBlocked', `${storageKey}:my-accounts-blocked`));
    setPortfolioBlocked(pickRemote('portfolioBlocked', `${storageKey}:portfolio-blocked`));
    if (textColumn) {
      const remoteText = newRemote?.textValues?.[textColumn.key];
      setTextValues(remoteText && typeof remoteText === 'object' ? remoteText : loadMapping(`${storageKey}:${textColumn.key}-values`));
    } else {
      setTextValues({});
    }
    setSearch('');
    setSuggestedOnly(false);
    setPortfolioOnly(false);
    setMappedOnly(false);
    setUploadError(null);
    setUploadInfo(null);
    setPicker(null);
    setBulkPicker(null);
    setSelectedKeys(new Set());
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
      if (e.key === tableViewBlockedKey) setTableViewBlocked(loadMapping(tableViewBlockedKey));
      if (e.key === myAccountBlockedKey) setMyAccountBlocked(loadMapping(myAccountBlockedKey));
      if (e.key === portfolioBlockedKey) setPortfolioBlocked(loadMapping(portfolioBlockedKey));
      if (textValuesKey && e.key === textValuesKey) setTextValues(loadMapping(textValuesKey));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mappingKey, dismissedKey, myAccountMappingKey, myAccountDismissedKey, portfolioMappingKey, portfolioDismissedKey, tableViewBlockedKey, myAccountBlockedKey, portfolioBlockedKey, textValuesKey]);

  // Persist every mapping change to BOTH localStorage AND Firestore via
  // persistMapping / persistTextValues defined above. Firestore is the
  // durable source of truth across devices and survives clear-site-data;
  // localStorage is the fast/offline mirror.
  useEffect(() => { persistMapping('mapping', mappingKey, mapping); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mapping, mappingKey]);
  useEffect(() => { persistMapping('dismissed', dismissedKey, dismissed); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dismissed, dismissedKey]);
  useEffect(() => {
    persistMapping('myAccountMapping', myAccountMappingKey, myAccountMapping);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAccountMapping, myAccountMappingKey]);
  useEffect(() => {
    persistMapping('myAccountDismissed', myAccountDismissedKey, myAccountDismissed);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAccountDismissed, myAccountDismissedKey]);
  useEffect(() => {
    persistMapping('portfolioMapping', portfolioMappingKey, portfolioMapping);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioMapping, portfolioMappingKey]);
  useEffect(() => {
    persistMapping('portfolioDismissed', portfolioDismissedKey, portfolioDismissed);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioDismissed, portfolioDismissedKey]);
  useEffect(() => { persistMapping('tableViewBlocked', tableViewBlockedKey, tableViewBlocked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tableViewBlocked, tableViewBlockedKey]);
  useEffect(() => {
    persistMapping('myAccountBlocked', myAccountBlockedKey, myAccountBlocked);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAccountBlocked, myAccountBlockedKey]);
  useEffect(() => {
    persistMapping('portfolioBlocked', portfolioBlockedKey, portfolioBlocked);
    window.dispatchEvent(new Event('my-accounts-coverage-changed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioBlocked, portfolioBlockedKey]);
  useEffect(() => { persistTextValues(textValues); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [textValues, textValuesKey]);

  // Sync local state from Firestore when it loads or changes
  // cross-device. Gated on settings._lastWriteAt so an early
  // settings={} render can't be mistaken for "no remote data."
  useEffect(() => {
    if (!settingsLoaded || !remoteMappings) return;
    const sameJson = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    if (remoteMappings.mapping && !sameJson(remoteMappings.mapping, mapping)) setMapping(remoteMappings.mapping);
    if (remoteMappings.dismissed && !sameJson(remoteMappings.dismissed, dismissed)) setDismissed(remoteMappings.dismissed);
    if (remoteMappings.myAccountMapping && !sameJson(remoteMappings.myAccountMapping, myAccountMapping)) setMyAccountMapping(remoteMappings.myAccountMapping);
    if (remoteMappings.myAccountDismissed && !sameJson(remoteMappings.myAccountDismissed, myAccountDismissed)) setMyAccountDismissed(remoteMappings.myAccountDismissed);
    if (remoteMappings.portfolioMapping && !sameJson(remoteMappings.portfolioMapping, portfolioMapping)) setPortfolioMapping(remoteMappings.portfolioMapping);
    if (remoteMappings.portfolioDismissed && !sameJson(remoteMappings.portfolioDismissed, portfolioDismissed)) setPortfolioDismissed(remoteMappings.portfolioDismissed);
    if (remoteMappings.tableViewBlocked && !sameJson(remoteMappings.tableViewBlocked, tableViewBlocked)) setTableViewBlocked(remoteMappings.tableViewBlocked);
    if (remoteMappings.myAccountBlocked && !sameJson(remoteMappings.myAccountBlocked, myAccountBlocked)) setMyAccountBlocked(remoteMappings.myAccountBlocked);
    if (remoteMappings.portfolioBlocked && !sameJson(remoteMappings.portfolioBlocked, portfolioBlocked)) setPortfolioBlocked(remoteMappings.portfolioBlocked);
    if (textColumn) {
      const remoteText = remoteMappings.textValues?.[textColumn.key];
      if (remoteText && !sameJson(remoteText, textValues)) setTextValues(remoteText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, remoteMappings, textColumn?.key]);

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
      const raw = userLsGet('my-accounts:active-names');
      return raw ? (JSON.parse(raw) || null) : null;
    } catch { return null; }
  });
  useEffect(() => {
    function onStorage(e) {
      if (e.key && e.key.endsWith(':my-accounts:active-names')) {
        try {
          const raw = userLsGet('my-accounts:active-names');
          setMyAccountNames(raw ? (JSON.parse(raw) || null) : null);
        } catch { setMyAccountNames(null); }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Set of lower-trimmed account names the user has blocked from
  // fuzzy-match suggestions on the Target Accounts page. Refreshed on
  // 'target-accounts:blocked-changed' (same window) and 'storage'
  // (cross-window) so toggling a block updates suggestions live.
  const [blockedAccountNames, setBlockedAccountNames] = useState(() => {
    try {
      const raw = userLsGet('target-accounts:blocked-names');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(s => String(s).toLowerCase().trim()).filter(Boolean) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    function refresh() {
      try {
        const raw = userLsGet('target-accounts:blocked-names');
        const arr = raw ? JSON.parse(raw) : [];
        setBlockedAccountNames(new Set(Array.isArray(arr) ? arr.map(s => String(s).toLowerCase().trim()).filter(Boolean) : []));
      } catch { setBlockedAccountNames(new Set()); }
    }
    function onStorage(e) { if (e.key && e.key.endsWith(':target-accounts:blocked-names')) refresh(); }
    window.addEventListener('target-accounts:blocked-changed', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('target-accounts:blocked-changed', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // When this list matches against the Target Accounts workbook instead
  // of My Accounts, load that workbook straight from IndexedDB (the same
  // 'data' record the Target Accounts page writes). Self-contained so the
  // Largest tab works even if the user never opened the Target tab.
  const [targetAccountData, setTargetAccountData] = useState(null);
  useEffect(() => {
    if (accountSource !== 'targetAccounts') { setTargetAccountData(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const payload = await dbGet('target-accounts', 'data');
        if (!cancelled) setTargetAccountData(payload || null);
      } catch { if (!cancelled) setTargetAccountData(null); }
    })();
    return () => { cancelled = true; };
  }, [accountSource]);

  // Flatten the Target Accounts workbook into { company, tier, cdm }
  // entries — every row across every sheet, with NO CDM/tier filter, so
  // the Largest list can match against the full target universe and the
  // CDM column can show whose account each firm is. Mirrors the column
  // resolution used on the My Accounts page (company/tier keyword scan,
  // CDM via the user-mapped column).
  const targetAccountEntries = useMemo(() => {
    if (accountSource !== 'targetAccounts' || !targetAccountData?.sheets) return [];
    const findCol = (r, keywords) => {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
        }
      }
      return '';
    };
    const out = [];
    let idx = 0;
    for (const sheetName of targetAccountData.sheetNames || []) {
      const sheet = targetAccountData.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        const company = findCol(r, ['Account Name', 'Account', 'Company', 'Client', 'Name']);
        if (!company) continue;
        const cdm = resolveTargetAccountCdm(r, settings?.targetCdmColumn);
        let tierRaw = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
        if (!tierRaw) tierRaw = String(Object.values(r).find(v => /Tier\s*[123]/i.test(String(v || ''))) || '');
        const tier = /1/.test(tierRaw) ? 'Tier 1' : /2/.test(tierRaw) ? 'Tier 2' : (/3/.test(tierRaw) ? 'Tier 3' : tierRaw);
        out.push({ company: company.trim(), tier, status: '', cdm: cdm || '', id: `ta::${idx++}` });
      }
    }
    return out;
  }, [accountSource, targetAccountData, settings?.targetCdmColumn]);

  // Build the fuzzy-match index for the account-match column + filter.
  // Prefer the resolved list when MyAccountsView has published it
  // (exact 132 companies); fall back to the Baldauf-CDM prospect pool
  // so the first-ever visit still works before My Accounts is opened.
  // When accountSource is 'targetAccounts', index the Target Accounts
  // workbook entries instead.
  const { myAccountsByNorm, myAccountNorms } = useMemo(() => {
    const byNorm = new Map();
    const norms = [];
    const add = (name, prospect) => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      // Skip accounts the user has blocked on the Target Accounts page.
      if (blockedAccountNames.has(trimmed.toLowerCase())) return;
      const norm = normalizeCompany(trimmed);
      if (!norm) return;
      if (!byNorm.has(norm)) byNorm.set(norm, prospect || { company: trimmed });
      norms.push({ norm, prospect: prospect || { company: trimmed } });
    };
    if (accountSource === 'targetAccounts') {
      // Index the Target Accounts workbook; each entry carries its own
      // company / tier / cdm, so no prospect lookup is needed.
      for (const e of targetAccountEntries) add(e.company, e);
    } else if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
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
        if (!matchesCdm(p.cdm, cdmName)) continue;
        add(p.company, p);
      }
    }
    return { myAccountsByNorm: byNorm, myAccountNorms: norms };
  }, [prospects, myAccountNames, blockedAccountNames, cdmName, accountSource, targetAccountEntries]);

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

  // A suggestion is dropped when the normalized matched company name is
  // listed in the scope's per-list block set. Confirmed mappings ignore
  // the block — only the auto-suggestion yellow pill is suppressed.
  const filterBlocked = (s, blocked) => {
    if (!s) return null;
    const norm = normalizeCompany(s.prospect?.company || '');
    if (norm && blocked[norm]) return null;
    return s;
  };

  const prospectSuggestionFor = useMemo(
    () => (raw) => filterBlocked(suggestFrom(raw, prospectsByNorm, prospectNorms), tableViewBlocked),
    [prospectsByNorm, prospectNorms, tableViewBlocked]
  );

  const myAccountSuggestionFor = useMemo(
    () => (raw) => filterBlocked(suggestFrom(raw, myAccountsByNorm, myAccountNorms), myAccountBlocked),
    [myAccountsByNorm, myAccountNorms, myAccountBlocked]
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
    () => (raw) => filterBlocked(suggestFrom(raw, portfolioByNorm, portfolioNorms), portfolioBlocked),
    [portfolioByNorm, portfolioNorms, portfolioBlocked]
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
  function blockSuggestedCompany(scope, companyName) {
    const norm = normalizeCompany(companyName || '');
    if (!norm) return;
    const setBlocked = scope === 'myAccounts'
      ? setMyAccountBlocked
      : scope === 'portfolio'
        ? setPortfolioBlocked
        : setTableViewBlocked;
    setBlocked(prev => (prev[norm] ? prev : { ...prev, [norm]: true }));
    setPicker(null);
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
  // Count of selected rows that already carry a confirmed mapping in
  // `scope` — i.e. rows that "Clear mapping" would actually act on.
  function mappedCountFor(scope) {
    const mappingState = scope === 'myAccounts' ? myAccountMapping : portfolioMapping;
    let n = 0;
    for (const mk of selectedKeys) {
      if (mappingState[mk]) n++;
    }
    return n;
  }
  // Clears every selected row's confirmed mapping in `scope`, leaving
  // dismissals alone so previously-suppressed suggestions stay hidden.
  function bulkClearMapping(scope) {
    const { setMap } = mapSettersFor(scope);
    setMap(prev => {
      let changed = false;
      const next = { ...prev };
      for (const mk of selectedKeys) {
        if (next[mk] != null) { delete next[mk]; changed = true; }
      }
      return changed ? next : prev;
    });
  }
  // Maps every selected row to `prospectCompany` in `scope`. Replaces any
  // existing mapping and un-dismisses the row so the new pick is visible.
  function bulkSetMapping(scope, prospectCompany) {
    if (!prospectCompany) return;
    const { setMap, setDis } = mapSettersFor(scope);
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    setMap(prev => {
      const next = { ...prev };
      for (const mk of keys) next[mk] = prospectCompany;
      return next;
    });
    setDis(prev => {
      let changed = false;
      const next = { ...prev };
      for (const mk of keys) {
        if (next[mk]) { delete next[mk]; changed = true; }
      }
      return changed ? next : prev;
    });
    setBulkPicker(null);
  }
  function openBulkPicker(scope) {
    setBulkPicker({ scope, query: '' });
  }
  // Wipes every mapping + dismissal on the selected rows across all
  // scopes so they look like a freshly-uploaded list — yellow auto
  // suggestions reappear, confirmed picks are gone.
  function bulkRefreshMappings() {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    const drop = (prev) => {
      let changed = false;
      const next = { ...prev };
      for (const mk of keys) {
        if (next[mk] != null) { delete next[mk]; changed = true; }
      }
      return changed ? next : prev;
    };
    setMapping(drop);
    setDismissed(drop);
    setMyAccountMapping(drop);
    setMyAccountDismissed(drop);
    setPortfolioMapping(drop);
    setPortfolioDismissed(drop);
  }
  // True for selected rows that carry any mapping or dismissal in any
  // scope — i.e. rows the refresh action would actually touch.
  function dirtyCount() {
    let n = 0;
    for (const mk of selectedKeys) {
      if (mapping[mk] || dismissed[mk]
        || myAccountMapping[mk] || myAccountDismissed[mk]
        || portfolioMapping[mk] || portfolioDismissed[mk]) n++;
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

  // Write the list row's name into a Table View prospect's field (e.g.
  // bfoCompanyName). The live prospects subscription refreshes the cell.
  async function fillProspectField(prospectId, value) {
    if (!updateProspect || !prospectFieldFill?.field || !prospectId) return;
    try {
      await updateProspect(prospectId, { [prospectFieldFill.field]: value });
    } catch (err) {
      console.warn('Failed to set prospect field:', err?.message || err);
    }
  }

  const columns = useMemo(
    () => buildColumns(rows, {
      prospectsByNorm, myAccountsByNorm, portfolioByNorm,
      prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor,
      mapping, dismissed, myAccountMapping, myAccountDismissed,
      portfolioMapping, portfolioDismissed,
      textColumn, textValues, onTextChange: setTextValue,
      onPick: openPicker, onDismiss: dismissSuggestion,
      selectedKeys, onToggleSelect: toggleSelectKey, shortDateColumns,
      prospectFieldFill, onFillProspectField: fillProspectField,
      accountLabel, accountSource,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, prospectsByNorm, myAccountsByNorm, portfolioByNorm, prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor, mapping, dismissed, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, textColumn, textValues, selectedKeys, shortDateColumns, prospectFieldFill, accountLabel, accountSource]
  );
  // Per uploaded list, but no longer per column lineup — see the note on
  // DealsView's tableId.
  const tableId = tableIdPrefix;
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

  // Resolve the configured exclusion column to the actual uploaded header
  // (case-insensitive) and build a predicate matching the rows to hide.
  const excludeColKey = useMemo(() => {
    if (!defaultHideWhere?.column || !rows.length) return null;
    const want = String(defaultHideWhere.column).trim().toLowerCase();
    return Object.keys(rows[0]).find(k => String(k).trim().toLowerCase() === want) || null;
  }, [defaultHideWhere, rows]);
  const isExcludedRow = useMemo(() => (r) => (
    !!excludeColKey && matchesAnyName(r[excludeColKey], defaultHideWhere?.values)
  ), [excludeColKey, defaultHideWhere]);
  const excludedCount = useMemo(
    () => (excludeColKey ? rows.reduce((n, r) => n + (isExcludedRow(r) ? 1 : 0), 0) : 0),
    [rows, excludeColKey, isExcludedRow]
  );

  // A row shows a live yellow suggestion pill when it has a fuzzy match in
  // a scope where it isn't already mapped or dismissed. Shared by the
  // "suggested only" filter and the "Select all suggested" button so both
  // target exactly the same rows.
  const hasLiveSuggestion = useCallback((r) => {
    const mk = r.__matchKey__;
    const raw = r.__rawName__ || '';
    const maLive = !myAccountMapping[mk] && !myAccountDismissed[mk] && !!myAccountSuggestionFor(raw);
    const pcLive = !portfolioMapping[mk] && !portfolioDismissed[mk] && !!portfolioSuggestionFor(raw);
    return maLive || pcLive;
  }, [myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, myAccountSuggestionFor, portfolioSuggestionFor]);

  const filtered = useMemo(() => {
    let result = rows;
    // Default-on exclusion (e.g. hide Daniel Baldauf's opportunities).
    if (excludeColKey && hideExcluded) {
      result = result.filter(r => !isExcludedRow(r));
    }
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
    // "Select all suggested" narrows the view to just the rows showing a
    // live yellow suggestion pill, ANDing with whatever else is on.
    if (suggestedPillsOnly) {
      result = result.filter(hasLiveSuggestion);
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
  }, [search, suggestedOnly, portfolioOnly, mappedOnly, suggestedPillsOnly, hasLiveSuggestion, hideExcluded, excludeColKey, isExcludedRow, rows, isMyAccountsRow, isPortfolioRow, isMappedRow, myAccountMapping, myAccountDismissed, portfolioMapping, portfolioDismissed, myAccountSuggestionFor, portfolioSuggestionFor]);

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

  // Append a manually entered row to the list and persist it. The new row
  // carries every current header (blank where unspecified) so it lines up
  // with the rest of the table; existing name-keyed mappings re-attach to
  // it automatically via the shared `rows` memo.
  async function handleAddRow() {
    const fields = manualHeaders;
    const nameKey = pickNameKey(fields);
    const newRow = {};
    for (const h of fields) newRow[h] = String(addRowDraft?.[h] ?? '').trim();
    if (!String(newRow[nameKey] || '').trim()) return;
    const next = [...data, newRow];
    try {
      await saveListToIDB(storageKey, next);
      setStore({ data: next, source: 'override' });
      setUploadError(null);
      setAddRowDraft(null);
    } catch (err) {
      setUploadError(err?.name === 'QuotaExceededError'
        ? 'Adding the row exceeded the browser storage quota.'
        : (err?.message || 'Failed to add the row'));
    }
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
    if (accountSource === 'targetAccounts') {
      accountSet = new Set(
        targetAccountEntries
          .map(e => (e.company || '').toLowerCase().trim())
          .filter(k => k && !blockedAccountNames.has(k))
      );
    } else if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
      accountSet = new Set(
        myAccountNames
          .map(n => String(n || '').toLowerCase().trim())
          .filter(k => k && !blockedAccountNames.has(k))
      );
    } else {
      accountSet = new Set();
      for (const p of prospects) {
        if (!matchesCdm(p.cdm, cdmName)) continue;
        const k = (p.company || '').toLowerCase().trim();
        if (k && !blockedAccountNames.has(k)) accountSet.add(k);
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
  }, [rows, myAccountNames, prospects, myAccountMapping, myAccountDismissed, myAccountSuggestionFor, blockedAccountNames, cdmName, accountSource, targetAccountEntries]);

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
      if (accountSource === 'targetAccounts') {
        source = targetAccountEntries.filter(e => !blockedAccountNames.has((e.company || '').toLowerCase().trim()));
      } else if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
        const nameSet = new Set(
          myAccountNames
            .map(n => String(n || '').toLowerCase().trim())
            .filter(k => k && !blockedAccountNames.has(k))
        );
        source = prospects.filter(p => nameSet.has((p.company || '').toLowerCase().trim()));
      } else {
        source = prospects.filter(p =>
          matchesCdm(p.cdm, cdmName)
          && !blockedAccountNames.has((p.company || '').toLowerCase().trim())
        );
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
  }, [picker, prospects, allPortfolioCompanies, prospectSuggestionFor, myAccountSuggestionFor, portfolioSuggestionFor, myAccountNames, blockedAccountNames, accountSource, targetAccountEntries]);

  // Search results for the bulk-mapping picker. Same source rules as
  // the per-row picker, just driven off `bulkPicker.query` instead.
  const bulkPickerResults = useMemo(() => {
    if (!bulkPicker) return [];
    const q = (bulkPicker.query || '').toLowerCase().trim();
    let source;
    if (bulkPicker.scope === 'myAccounts') {
      if (accountSource === 'targetAccounts') {
        source = targetAccountEntries.filter(e => !blockedAccountNames.has((e.company || '').toLowerCase().trim()));
      } else if (Array.isArray(myAccountNames) && myAccountNames.length > 0) {
        const nameSet = new Set(
          myAccountNames
            .map(n => String(n || '').toLowerCase().trim())
            .filter(k => k && !blockedAccountNames.has(k))
        );
        source = prospects.filter(p => nameSet.has((p.company || '').toLowerCase().trim()));
      } else {
        source = prospects.filter(p =>
          matchesCdm(p.cdm, cdmName)
          && !blockedAccountNames.has((p.company || '').toLowerCase().trim())
        );
      }
    } else {
      source = allPortfolioCompanies;
    }
    const list = source.filter(p => p.company && (!q || p.company.toLowerCase().includes(q)));
    list.sort((a, b) => a.company.localeCompare(b.company));
    const out = [];
    const seen = new Set();
    for (const p of list) {
      const id = p.id || p.company;
      if (seen.has(id)) continue;
      out.push(p);
      seen.add(id);
      if (out.length >= 30) break;
    }
    return out;
  }, [bulkPicker, prospects, allPortfolioCompanies, myAccountNames, blockedAccountNames, cdmName, accountSource, targetAccountEntries]);

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
                    {accountLabel} mapped (
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
            title={`Upload an Excel or CSV of ${title}. Existing My Accounts / Table View mappings are preserved across re-uploads: rows whose company name matches an earlier mapping pick it up automatically.`}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Upload Excel
          </button>
          <button
            type="button"
            onClick={() => setAddRowDraft({})}
            title={`Manually add one ${singular} to the ${title} list`}
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add row
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
          title="Show only list rows that match a company on My Accounts (live: based on current prospect data)"
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
          title="Show only list rows that match a company on Portfolio Companies (live: across every prospect)"
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
        {excludeColKey && (
          <button
            type="button"
            onClick={() => setHideExcluded(v => !v)}
            title={`Hide rows where ${defaultHideWhere.column} is ${defaultHideWhere.label || (defaultHideWhere.values || []).join(', ')}. On by default.`}
            style={{
              padding: '0.35rem 0.7rem',
              border: `1px solid ${hideExcluded ? '#DC2626' : 'var(--color-border)'}`,
              borderRadius: 6,
              background: hideExcluded ? '#FEE2E2' : '#fff',
              color: hideExcluded ? '#991B1B' : 'var(--color-text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {hideExcluded
              ? `Hiding ${defaultHideWhere.label || (defaultHideWhere.values || []).join(', ')}`
              : `Show ${defaultHideWhere.label || (defaultHideWhere.values || []).join(', ')}`}
            {excludedCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: '0.68rem', color: hideExcluded ? '#991B1B' : '#94A3B8' }}>
                {excludedCount}
              </span>
            )}
          </button>
        )}
        {(() => {
          // Only count rows that currently show a yellow suggestion pill
          // in at least one scope — i.e. not already mapped and not
          // dismissed. The button targets exactly those rows so a single
          // click teases up everything that still needs a decision. When
          // the suggested-only filter is on, `filtered` is already these
          // rows; when it's off we look at the whole filtered set so the
          // count and selection cover every suggestion in view.
          const suggestedKeys = filtered
            .filter(hasLiveSuggestion)
            .map(r => r.__matchKey__);
          if (suggestedKeys.length === 0 && !suggestedPillsOnly) return null;
          const suggestedSet = new Set(suggestedKeys);
          // "Active" once the table is filtered to the suggested rows and
          // the selection is exactly that set. Clicking again clears both,
          // so a stale prior selection can't survive into a bulk action.
          const isActive = suggestedPillsOnly
            && selectedKeys.size === suggestedSet.size
            && [...selectedKeys].every(k => suggestedSet.has(k));
          const toggle = () => {
            if (isActive) {
              setSelectedKeys(new Set());
              setSuggestedPillsOnly(false);
            } else {
              setSelectedKeys(suggestedSet);
              setSuggestedPillsOnly(true);
            }
          };
          return (
            <button
              type="button"
              onClick={toggle}
              title={isActive
                ? 'Clear the selection and show all rows again'
                : 'Filter the table to rows showing a yellow suggestion (My Accounts or Portfolio) and select them all'}
              style={{
                padding: '0.35rem 0.7rem',
                border: `1px solid ${isActive ? '#F59E0B' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: isActive ? '#FEF3C7' : '#fff',
                color: isActive ? '#92400E' : 'var(--color-text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {isActive ? 'Deselect suggested' : 'Select all suggested'}
              <span style={{ marginLeft: 6, fontSize: '0.68rem', color: isActive ? '#92400E' : '#94A3B8' }}>
                {suggestedKeys.length}
              </span>
            </button>
          );
        })()}
        {(() => {
          // Selects every row currently visible after filters/search,
          // so the bulk-edit toolbar can act on the entire filtered set
          // (not just rows showing yellow suggestion pills).
          if (filtered.length === 0) return null;
          const filteredKeys = filtered.map(r => r.__matchKey__);
          const filteredSet = new Set(filteredKeys);
          // Replace-not-union: clicking sets the selection to exactly
          // the filtered keys, dropping any earlier selection from a
          // different filter so bulk actions can't accidentally hit
          // rows that aren't currently visible.
          const isActive = selectedKeys.size === filteredSet.size
            && [...selectedKeys].every(k => filteredSet.has(k));
          const toggle = () => {
            if (isActive) setSelectedKeys(new Set());
            else setSelectedKeys(filteredSet);
          };
          return (
            <button
              type="button"
              onClick={toggle}
              title={isActive
                ? 'Deselect: clears the entire selection'
                : 'Replace the current selection with every row currently visible after filters and search: bulk actions will only touch these rows'}
              style={{
                padding: '0.35rem 0.7rem',
                border: `1px solid ${isActive ? '#3B82F6' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: isActive ? '#DBEAFE' : '#fff',
                color: isActive ? '#1E3A8A' : 'var(--color-text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {isActive ? 'Deselect filtered' : 'Select all filtered'}
              <span style={{ marginLeft: 6, fontSize: '0.68rem', color: isActive ? '#1E3A8A' : '#94A3B8' }}>
                {filteredKeys.length}
              </span>
            </button>
          );
        })()}
        {(() => {
          // Selects every row in the entire list — independent of any
          // active filters/search. Pairs with "Select all filtered" so
          // the user can pick "everything visible" or "everything in the
          // list" without having to clear filters first.
          if (rows.length === 0) return null;
          const allKeys = rows.map(r => r.__matchKey__);
          const visibleSelected = allKeys.filter(k => selectedKeys.has(k)).length;
          const allSelected = visibleSelected === allKeys.length && allKeys.length > 0;
          const toggle = () => {
            if (allSelected) {
              setSelectedKeys(new Set());
            } else {
              setSelectedKeys(new Set(allKeys));
            }
          };
          return (
            <button
              type="button"
              onClick={toggle}
              title={allSelected
                ? 'Deselect every row in the list'
                : 'Select every row in the entire list, ignoring any active filters or search'}
              style={{
                padding: '0.35rem 0.7rem',
                border: `1px solid ${allSelected ? '#16A34A' : 'var(--color-border)'}`,
                borderRadius: 6,
                background: allSelected ? '#DCFCE7' : '#fff',
                color: allSelected ? '#166534' : 'var(--color-text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {allSelected ? 'Deselect all' : 'Select all'}
              <span style={{ marginLeft: 6, fontSize: '0.68rem', color: allSelected ? '#166534' : '#94A3B8' }}>
                {allKeys.length}
              </span>
            </button>
          );
        })()}
        {(search || suggestedOnly || portfolioOnly || mappedOnly || (excludeColKey && hideExcluded && excludedCount > 0)) && <span className={styles.resultCount}>{filtered.length} results</span>}
      </div>
      {selectedKeys.size > 0 && (() => {
        const acceptMa = pendingCountFor('myAccounts');
        const acceptPc = pendingCountFor('portfolio');
        const mappedMa = mappedCountFor('myAccounts');
        const mappedPc = mappedCountFor('portfolio');
        const dirty = dirtyCount();
        const baseBtn = { padding: '0.35rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
        const accentBtn = (active) => ({ ...baseBtn, border: `1px solid ${active ? '#16A34A' : 'var(--color-border)'}`, background: active ? '#DCFCE7' : '#fff', color: active ? '#166534' : '#94A3B8' });
        const dismissBtn = (active) => ({ ...baseBtn, border: `1px solid ${active ? '#DC2626' : 'var(--color-border)'}`, background: active ? '#FEE2E2' : '#fff', color: active ? '#991B1B' : '#94A3B8' });
        const setMaBtn = { ...baseBtn, border: '1px solid #3B82F6', background: '#DBEAFE', color: '#1E3A8A' };
        const setPcBtn = { ...baseBtn, border: '1px solid #8B5CF6', background: '#EDE9FE', color: '#5B21B6' };
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem 1.25rem', background: '#F1F5F9', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1E293B' }}>
              {selectedKeys.size} selected
            </span>
            {(() => {
              // Count selected rows that the current filters/search are
              // hiding. Bulk actions still hit those rows, so surface
              // them clearly with a one-click "drop hidden" escape hatch.
              const visibleKeys = new Set(filtered.map(r => r.__matchKey__));
              let hidden = 0;
              for (const k of selectedKeys) if (!visibleKeys.has(k)) hidden++;
              if (hidden === 0) return null;
              const dropHidden = () => {
                setSelectedKeys(prev => {
                  const next = new Set();
                  for (const k of prev) if (visibleKeys.has(k)) next.add(k);
                  return next;
                });
              };
              return (
                <span
                  title="These selected rows aren't visible after the current filter/search. Bulk actions will still hit them: click to drop them from the selection."
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.55rem', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 999, fontSize: '0.7rem', color: '#92400E', fontWeight: 600 }}
                >
                  ⚠ {hidden} hidden by filter
                  <button
                    type="button"
                    onClick={dropHidden}
                    style={{ background: 'transparent', border: '1px solid #F59E0B', borderRadius: 4, padding: '0.05rem 0.35rem', fontSize: '0.65rem', color: '#92400E', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                  >Drop hidden</button>
                </span>
              );
            })()}
            <button type="button" style={accentBtn(acceptMa > 0)} disabled={acceptMa === 0} onClick={() => bulkAccept('myAccounts')}
              title="Confirm each selected row's suggested My Accounts mapping (skips rows already mapped or with no live suggestion)">
              ★ Accept My Accounts {acceptMa > 0 && `(${acceptMa})`}
            </button>
            <button type="button" style={accentBtn(acceptPc > 0)} disabled={acceptPc === 0} onClick={() => bulkAccept('portfolio')}
              title="Confirm each selected row's suggested Portfolio Companies mapping">
              ◆ Accept Portfolio {acceptPc > 0 && `(${acceptPc})`}
            </button>
            <button type="button" style={setMaBtn} onClick={() => openBulkPicker('myAccounts')}
              title="Map every selected row to one specific My Accounts company (overwrites any existing mapping)">
              ★ Set My Accounts…
            </button>
            <button type="button" style={setPcBtn} onClick={() => openBulkPicker('portfolio')}
              title="Map every selected row to one specific Portfolio Company (overwrites any existing mapping)">
              ◆ Set Portfolio…
            </button>
            <button type="button" style={dismissBtn(acceptMa > 0)} disabled={acceptMa === 0} onClick={() => bulkDismiss('myAccounts')}
              title="Hide the My Accounts suggestion on every selected row that currently shows one">
              Dismiss MA suggestion
            </button>
            <button type="button" style={dismissBtn(acceptPc > 0)} disabled={acceptPc === 0} onClick={() => bulkDismiss('portfolio')}
              title="Hide the Portfolio Companies suggestion on every selected row that currently shows one">
              Dismiss PC suggestion
            </button>
            <button type="button" style={dismissBtn(mappedMa > 0)} disabled={mappedMa === 0} onClick={() => bulkClearMapping('myAccounts')}
              title="Remove the confirmed My Accounts mapping from every selected row that has one">
              Clear MA mapping {mappedMa > 0 && `(${mappedMa})`}
            </button>
            <button type="button" style={dismissBtn(mappedPc > 0)} disabled={mappedPc === 0} onClick={() => bulkClearMapping('portfolio')}
              title="Remove the confirmed Portfolio Companies mapping from every selected row that has one">
              Clear PC mapping {mappedPc > 0 && `(${mappedPc})`}
            </button>
            <button
              type="button"
              style={{ ...baseBtn, border: `1px solid ${dirty > 0 ? '#F59E0B' : 'var(--color-border)'}`, background: dirty > 0 ? '#FEF3C7' : '#fff', color: dirty > 0 ? '#92400E' : '#94A3B8' }}
              disabled={dirty === 0}
              onClick={() => {
                if (!window.confirm(`Refresh mapping on ${dirty} selected row${dirty === 1 ? '' : 's'}? This wipes every confirmed mapping and dismissal across My Accounts, Portfolio Companies and Table View, putting those rows back to their first-load state with auto suggestions.`)) return;
                bulkRefreshMappings();
              }}
              title="Wipe every confirmed mapping and dismissal on the selected rows so the auto-suggestions reappear, exactly like the first time the list was loaded"
            >
              ↻ Refresh mapping {dirty > 0 && `(${dirty})`}
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
          // Without this the export falls back to tableId for its file name —
          // and tableId is the prefix plus every column key joined by "|", so
          // the CSRD list downloaded as "csrd-list-__sel-cdm-company-country-
          // employees-…​ - 2026-07-30.xlsx". Name it after the list instead;
          // DataTable appends " - <today>" itself.
          exportFileName={`${title} export`}
          columns={columns}
          rows={filtered}
          alwaysVisible={alwaysVisible}
          enableColumnFilters
          emptyMessage={`No matching ${plural} found`}
          settings={settings}
          updateSettings={updateSettings}
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
          {(() => {
            const scopeMap = picker.scope === 'myAccounts' ? myAccountMapping : picker.scope === 'portfolio' ? portfolioMapping : mapping;
            if (scopeMap[picker.matchKey]) return null;
            const suggestFn = picker.scope === 'myAccounts' ? myAccountSuggestionFor : picker.scope === 'portfolio' ? portfolioSuggestionFor : prospectSuggestionFor;
            const sugg = suggestFn(picker.raw || '');
            const suggCompany = sugg?.prospect?.company;
            if (!suggCompany) return null;
            return (
              <button
                type="button"
                onClick={() => blockSuggestedCompany(picker.scope, suggCompany)}
                style={{ marginTop: '0.25rem', padding: '0.3rem 0.5rem', background: 'none', border: 'none', color: '#92400E', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'inherit', textAlign: 'left' }}
                title={`Stop suggesting "${suggCompany}" on every row of this list. Confirmed mappings to this company aren't affected.`}
              >⛔ Don't suggest "{suggCompany}" on this list</button>
            );
          })()}
        </div>,
        document.body
      )}
      {bulkPicker && createPortal(
        <div
          data-picker="bulk"
          onClick={() => setBulkPicker(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 360, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '0.6rem', display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.4rem' }}>
              {bulkPicker.scope === 'myAccounts'
                ? `Map ${selectedKeys.size} selected row${selectedKeys.size === 1 ? '' : 's'} to a My Accounts company`
                : `Map ${selectedKeys.size} selected row${selectedKeys.size === 1 ? '' : 's'} to a Portfolio Company`}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748B', marginBottom: '0.4rem' }}>
              This overwrites any existing {bulkPicker.scope === 'myAccounts' ? 'My Accounts' : 'Portfolio'} mapping on the selected rows.
            </div>
            <input
              autoFocus
              value={bulkPicker.query}
              onChange={e => setBulkPicker(p => ({ ...p, query: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Escape') setBulkPicker(null); }}
              placeholder={bulkPicker.scope === 'myAccounts' ? 'Search My Accounts…' : 'Search Portfolio Companies…'}
              style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', marginBottom: '0.35rem', boxSizing: 'border-box' }}
            />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {bulkPickerResults.map(p => (
                <button
                  key={p.id || p.company}
                  type="button"
                  onClick={() => bulkSetMapping(bulkPicker.scope, p.company)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '0.4rem 0.5rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{p.company}</div>
                  {(p.tier || p.cdm || p.parent) && (
                    <div style={{ fontSize: '0.66rem', color: '#64748B', marginTop: 1 }}>
                      {[p.parent ? `Owner: ${p.parent}` : null, p.tier, p.cdm].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </button>
              ))}
              {bulkPickerResults.length === 0 && (
                <div style={{ padding: '0.75rem', fontSize: '0.78rem', color: '#64748B', textAlign: 'center' }}>
                  No matching {bulkPicker.scope === 'myAccounts' ? 'accounts' : 'portfolio companies'} found.
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBulkPicker(null)}
              style={{ marginTop: '0.4rem', padding: '0.35rem 0.5rem', background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}
            >Cancel</button>
          </div>
        </div>,
        document.body
      )}
      {addRowDraft && createPortal(
        <div
          onClick={() => setAddRowDraft(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}
        >
          {(() => {
            const nameKey = pickNameKey(manualHeaders);
            const canAdd = String(addRowDraft[nameKey] || '').trim().length > 0;
            return (
              <div
                onClick={e => e.stopPropagation()}
                style={{ width: 420, maxWidth: '92vw', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '0.9rem', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.2rem' }}>
                  Add {singular} to {title}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem' }}>
                  Fill in the fields below. The <strong>{nameKey}</strong> is required; other columns are optional.
                </div>
                <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {manualHeaders.map((h, i) => (
                    <label key={h} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#64748B' }}>
                        {h}{h === nameKey ? ' *' : ''}
                      </span>
                      <input
                        autoFocus={i === 0}
                        type="text"
                        value={addRowDraft[h] || ''}
                        onChange={e => setAddRowDraft(d => ({ ...d, [h]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && canAdd) handleAddRow();
                          if (e.key === 'Escape') setAddRowDraft(null);
                        }}
                        style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.8rem' }}>
                  <button
                    type="button"
                    onClick={() => setAddRowDraft(null)}
                    style={{ padding: '0.4rem 0.8rem', background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={handleAddRow}
                    disabled={!canAdd}
                    style={{ padding: '0.4rem 0.9rem', background: canAdd ? 'var(--color-accent, #2563eb)' : '#CBD5E1', color: '#fff', border: 'none', borderRadius: 6, cursor: canAdd ? 'pointer' : 'default', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit' }}
                  >Add row</button>
                </div>
              </div>
            );
          })()}
        </div>,
        document.body
      )}
    </div>
  );
}
