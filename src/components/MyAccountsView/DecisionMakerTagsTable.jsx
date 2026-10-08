// My Accounts > "DM Tags" subtab: the My Accounts list down the side, one
// column per contact tag, and in each cell the decision makers at that
// account who also carry that tag. Above each tag, how much of Tier 1, 2
// and 3 has at least one. The matching lives in
// utils/decisionMakerTagMatrix.js; this file lays it out.
//
// It is a DataTable, so the columns can be renamed, reordered, resized,
// hidden and starred from the Columns menu, and the layout persists under
// settings.tablePrefs['my-accounts-dm-tags'].
import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { makeDecisionMakerLookup } from '../../utils/decisionMakerCoverage';
import { tagMatrixColumns, tagColumnKey, tagMatrixRows, tagMatrixCoverage } from '../../utils/decisionMakerTagMatrix';
import { TIERS } from '../../data/enums';

const TIER_INK = { 'Tier 1': '#DC2626', 'Tier 2': '#3B82F6', 'Tier 3': '#F59E0B' };

const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');
const namesOf = (list) => (list || []).map(nameOf).join(', ');

// The three tier percentages under a tag's name.
function TierCoverage({ coverage }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 3, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
      {TIERS.map(tier => {
        const c = coverage?.[tier];
        const pct = c?.pct;
        return (
          <span
            key={tier}
            title={c?.total ? `${tier}: ${c.mapped} of ${c.total} accounts have a decision maker with this tag` : `No ${tier} accounts on screen`}
            style={{ fontSize: '0.64rem', color: pct == null ? '#CBD5E1' : TIER_INK[tier], fontVariantNumeric: 'tabular-nums' }}
          >
            T{tier.slice(-1)} {pct == null ? '-' : `${pct}%`}
          </span>
        );
      })}
    </div>
  );
}

export function DecisionMakerTagsTable({ accounts, contacts, settings, updateSettings, onSelect }) {
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const dmLookup = useMemo(
    () => (contacts ? makeDecisionMakerLookup(contacts, { localFields, links, exclusions }) : null),
    [contacts, localFields, links, exclusions],
  );
  const tags = useMemo(() => tagMatrixColumns(contacts || []), [contacts]);
  const rows = useMemo(() => tagMatrixRows(accounts, dmLookup, tags), [accounts, dmLookup, tags]);
  const coverage = useMemo(() => tagMatrixCoverage(rows, tags), [rows, tags]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Account', defaultWidth: 220, sticky: true,
      render: r => (
        <span style={{ fontWeight: 600, color: '#1E293B' }}>
          {r.company}
          {r.status === 'Client' && <span style={{ marginLeft: 6, fontSize: '0.6rem', fontWeight: 700, color: '#059669' }}>CLIENT</span>}
        </span>
      ),
    },
    {
      key: 'myTier', label: 'Tier', defaultWidth: 80,
      render: r => <span style={{ fontWeight: 600, color: TIER_INK[r.myTier] || '#64748B' }}>{r.myTier || '-'}</span>,
    },
    {
      key: 'dmCount', label: 'Decision Makers', defaultWidth: 110,
      headerTitle: 'Contacts at the account tagged Decision Maker, whatever else they are tagged',
      render: r => <span style={{ color: r.dmCount ? '#1E293B' : '#CBD5E1' }}>{r.dmCount || '-'}</span>,
    },
    ...tags.map(tag => {
      const key = tagColumnKey(tag);
      const value = r => namesOf(r.byTag[key]);
      return {
        key,
        label: tag,
        defaultWidth: 160,
        headerTitle: `Decision makers also tagged ${tag}`,
        renderHeader: label => (
          <div style={{ display: 'inline-block', verticalAlign: 'top' }}>
            <div>{label}</div>
            <TierCoverage coverage={coverage[key]} />
          </div>
        ),
        getFilterValue: value,
        exportValue: value,
        getSortValue: r => r.byTag[key].length || null,
        render: r => {
          const list = r.byTag[key];
          if (!list.length) return <span style={{ color: '#CBD5E1' }}>-</span>;
          return (
            <span title={list.map(c => [nameOf(c), c.jobtitle].filter(Boolean).join(', ')).join('\n')}>
              {namesOf(list)}
            </span>
          );
        },
      };
    }),
  ], [tags, coverage]);

  if (!contacts) {
    return <div style={{ fontSize: '0.75rem', color: '#94A3B8', padding: '1rem' }}>Loading contacts…</div>;
  }
  return (
    <DataTable
      tableId="my-accounts-dm-tags"
      exportFileName="My Accounts DM Tags"
      columns={columns}
      rows={rows}
      defaultSort={{ key: 'company', direction: 'asc' }}
      alwaysVisible={['company']}
      enableColumnFilters
      gridLines
      onRowClick={r => { if (!r._oppsOnly) onSelect(r); }}
      emptyMessage="No accounts match these filters"
      settings={settings}
      updateSettings={updateSettings}
    />
  );
}
