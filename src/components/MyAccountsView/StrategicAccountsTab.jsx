// My Accounts > Strategic Accounts: every Tier 2 account on My Accounts,
// plus every company this CDM is on that the Strategic Accounts list
// (Lists > Strategic Accounts) names, with who owns it there. A Tier 1
// account is here only when the list names it. The list's NAM Strategic
// Account rows do not count here: only its other rows (the Global
// Strategic Accounts) put a company on this subtab.
//
// A company is "on the list" by the same rule as the red strip at the top
// of the company popup (utils/strategicAccounts.js), so the two agree.
//
// Two views of that one set of accounts: the list itself, and Account MRI
// (AccountMriTab), the same accounts laid out as the Account MRI intake
// template with an export that fills it in.

import { useEffect, useMemo, useState } from 'react';
import { TIERS } from '../../data/enums.js';
import { loadList } from '../../utils/uploadedListStore';
import { readListField } from '../../utils/listAccountMapping';
import { matchesCdm } from '../../utils/cdmMatch';
import { STRATEGIC_STORAGE_KEY, ON_STRATEGIC_LIST, strategicLookup, strategicAccountRows, withoutNamStrategicRows } from '../../utils/strategicAccounts';
import { DataTable } from '../common/DataTable';
import { AccountMriTab } from './AccountMriTab';
import { LISTED_ROW_STYLE, LISTED_COMPANY_CELL, LISTED_NAME_INK } from './strategicListedStyle';

const VIEWS = [
  { key: 'accounts', label: 'Accounts', title: 'The strategic accounts and why each one is here. A Tier 1 account shows only when it is on the Strategic Accounts list. NAM Strategic Accounts are left off.' },
  { key: 'mri', label: 'Account MRI', title: 'The same accounts as the Account MRI intake template, with an export that fills it in' },
];
const VIEW_KEY = 'my-accounts-strategic-view';
function readSavedView() {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return VIEWS.some(x => x.key === v) ? v : 'accounts';
  } catch { return 'accounts'; }
}

// The Tier pill's colours, the same ones the Deal Size subtab uses.
const TIER_TINTS = {
  'Tier 1': { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  'Tier 2': { bg: '#F5F3FF', border: '#DDD6FE', ink: '#6D28D9' },
  'Tier 3': { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' },
};
const LIST_TINT = { bg: '#FEF2F2', border: '#FECACA', ink: '#B91C1C' };
// A company the Strategic Accounts list names reads differently from the
// Tier 2 accounts around it, in both views (strategicListedStyle.js).
const onList = r => r.reasons.includes(ON_STRATEGIC_LIST);
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const pill = (text, tint) => (
  <span key={text} style={{ fontSize: '0.68rem', fontWeight: 700, color: tint.ink, background: tint.bg, border: `1px solid ${tint.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{text}</span>
);

export function StrategicAccountsTab({ accounts, prospects, cdmName, keep, settings, updateSettings, updateSettingsPath, onSelect, filterBar, hubspotContacts, targetAccountsData }) {
  // Which of the two views is open; remembered on this machine.
  const [view, setView] = useState(readSavedView);
  const pickView = (key) => {
    setView(key);
    try { window.localStorage.setItem(VIEW_KEY, key); } catch { /* private window: the choice just isn't remembered */ }
  };
  // The uploaded list lives in IndexedDB; null until it has been read.
  const [listRows, setListRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadList(STRATEGIC_STORAGE_KEY)
      .then(rows => { if (!cancelled) setListRows(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setListRows([]); });
    return () => { cancelled = true; };
  }, []);

  // NAM Strategic Account rows are left out before anything is matched, so
  // a company only they name is not "on the list" here and shows no owner.
  const lookup = useMemo(() => strategicLookup(
    withoutNamStrategicRows(listRows || []),
    readListField(settings, STRATEGIC_STORAGE_KEY, 'mapping'),
    readListField(settings, STRATEGIC_STORAGE_KEY, 'dismissed'),
    [
      readListField(settings, STRATEGIC_STORAGE_KEY, 'myAccountMapping'),
      readListField(settings, STRATEGIC_STORAGE_KEY, 'portfolioMapping'),
    ],
  ), [listRows, settings]);

  const allRows = useMemo(() => strategicAccountRows({
    accounts, prospects, lookup, isCdm: cdm => matchesCdm(cdm, cdmName),
  }), [accounts, prospects, lookup, cdmName]);
  const rows = useMemo(() => (keep ? allRows.filter(keep) : allRows), [allRows, keep]);

  const count = (reason) => rows.filter(r => r.reasons.includes(reason)).length;

  const columns = useMemo(() => {
    const text = (key, label, defaultWidth, extra = {}) => ({
      key, label, defaultWidth,
      getSortValue: r => (r[key] ? String(r[key]).toLowerCase() : null),
      getFilterValue: r => r[key] || '',
      exportValue: r => r[key] || '',
      render: r => (r[key] ? <span style={{ color: '#475569' }}>{r[key]}</span> : blank),
      ...extra,
    });
    return [
      {
        key: 'company', label: 'Company', defaultWidth: 260,
        getSortValue: r => r.company.toLowerCase(),
        getFilterValue: r => r.company,
        exportValue: r => r.company,
        cellStyle: r => (onList(r) ? LISTED_COMPANY_CELL : undefined),
        render: r => (r.record && onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(r.record)}
            title="Open the company"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: onList(r) ? 700 : 600, color: onList(r) ? LISTED_NAME_INK : '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
          >{r.company}</button>
        ) : <span style={{ fontWeight: onList(r) ? 700 : 600, color: onList(r) ? LISTED_NAME_INK : undefined }}>{r.company}</span>),
      },
      {
        key: 'tier', label: 'Tier', defaultWidth: 130,
        getSortValue: r => {
          const i = TIERS.indexOf(r.tier);
          return i >= 0 ? i : TIERS.length;
        },
        getFilterValue: r => r.tier,
        exportValue: r => r.tier,
        render: r => {
          if (!r.tier) return blank;
          const tint = TIER_TINTS[r.tier];
          return tint ? pill(r.tier, tint) : <span style={{ color: '#94A3B8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{r.tier}</span>;
        },
      },
      {
        key: 'reasons', label: 'Here Because', defaultWidth: 230,
        headerTitle: 'Why the company is on this subtab: it is a Tier 2 account, or you are its CDM and the Strategic Accounts list names it. A Tier 1 account shows only when the list names it. NAM Strategic Account rows on the list do not count.',
        getSortValue: r => r.reasons.join(', ').toLowerCase(),
        getFilterValue: r => r.reasons.join(', '),
        exportValue: r => r.reasons.join(', '),
        render: r => (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {r.reasons.map(reason => pill(reason, reason === ON_STRATEGIC_LIST ? LIST_TINT : TIER_TINTS[reason] || TIER_TINTS['Tier 3']))}
          </span>
        ),
      },
      {
        key: 'owners', label: 'Strategic Account Owner', defaultWidth: 250,
        headerTitle: 'Who owns the company on the Strategic Accounts list. Blank when the list does not name the company, names it only as a NAM Strategic Account, or names no owner for it.',
        getSortValue: r => (r.owners.length ? r.owners.join(', ').toLowerCase() : null),
        getFilterValue: r => r.owners.join(', '),
        exportValue: r => r.owners.join(', '),
        render: r => (r.owners.length ? <span style={{ color: '#7F1D1D', fontWeight: 600 }}>{r.owners.join(', ')}</span> : blank),
      },
      {
        key: 'listNames', label: 'Listed As', defaultWidth: 220,
        headerTitle: 'The company\'s name on the Strategic Accounts list.',
        getSortValue: r => (r.listNames.length ? r.listNames.join(', ').toLowerCase() : null),
        getFilterValue: r => r.listNames.join(', '),
        exportValue: r => r.listNames.join(', '),
        render: r => (r.listNames.length ? <span style={{ color: '#475569' }}>{r.listNames.join(', ')}</span> : blank),
      },
      text('status', 'Status', 140),
      text('type', 'Type', 160),
      text('cdm', 'CDM', 150),
    ];
  }, [onSelect]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              title={v.title}
              aria-pressed={view === v.key}
              onClick={() => pickView(v.key)}
              style={{ padding: '0.25rem 0.7rem', border: 'none', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: view === v.key ? '#1D4ED8' : '#FFFFFF', color: view === v.key ? '#FFFFFF' : '#475569' }}
            >{v.label}</button>
          ))}
        </span>
        {filterBar}
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {rows.length} account{rows.length === 1 ? '' : 's'} · {count('Tier 2')} Tier 2 · {count(ON_STRATEGIC_LIST)} on the Strategic Accounts list
        </span>
        {count(ON_STRATEGIC_LIST) > 0 && (
          <span
            title="Rows tinted red with a red bar and a red company name are on the Strategic Accounts list (NAM Strategic Accounts aside). The other rows are here as Tier 2 accounts only."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: '#7F1D1D' }}
          >
            <span aria-hidden="true" style={{ width: 16, height: 12, borderRadius: 2, background: LISTED_ROW_STYLE.background, border: '1px solid #FECACA', boxShadow: 'inset 3px 0 0 #DC2626' }} />
            On the Strategic Accounts list
          </span>
        )}
      </div>
      {listRows && listRows.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: '#B45309' }}>No Strategic Accounts list is uploaded yet (Lists, Strategic Accounts), so only the Tier 2 accounts show.</div>
      )}
      {view === 'mri' ? (
        <AccountMriTab
          rows={rows}
          isListed={onList}
          hubspotContacts={hubspotContacts}
          targetAccountsData={targetAccountsData}
          settings={settings}
          updateSettings={updateSettings}
          updateSettingsPath={updateSettingsPath}
          onSelect={onSelect}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="my-accounts-strategic-accounts"
            exportFileName="My Accounts Strategic Accounts"
            columns={columns}
            rows={rows}
            rowStyle={r => (onList(r) ? LISTED_ROW_STYLE : undefined)}
            defaultSort={{ key: 'company', direction: 'asc' }}
            fitWidth
            alwaysVisible={['company']}
            emptyMessage="No accounts match"
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
