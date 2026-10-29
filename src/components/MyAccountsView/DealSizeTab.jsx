// My Accounts > Deal Size: every account on My Accounts with its tier and
// its biggest deal, largest first. The deal is the company card's own
// Biggest Deal reading (hooks/useBiggestDeals.js), so the two never
// disagree; an account with nothing open that can be priced shows "-".
//
// The accounts come from MyAccountsView, already through its search box and
// inactive toggle, so this list is the same set the other subtabs show.

import { useMemo } from 'react';
import { TIERS } from '../../data/enums.js';
import { formatMoneyRange } from '../../utils/servicePricing';
import { useBiggestDeals } from '../../hooks/useBiggestDeals';
import { DataTable } from '../common/DataTable';

// The Tier pill's colours, the same ones the Prospecting lists use.
const TIER_TINTS = {
  'Tier 1': { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  'Tier 2': { bg: '#F5F3FF', border: '#DDD6FE', ink: '#6D28D9' },
  'Tier 3': { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' },
};
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;

export function DealSizeTab({ accounts, prospects, settings, updateSettings, onSelect, filterBar }) {
  // The tracker record behind each account, by id: the account row is a
  // copy with display fields added, and the deal is priced off the record.
  const byId = useMemo(() => new Map((prospects || []).map(p => [p.id, p])), [prospects]);
  const records = useMemo(
    () => accounts.map(a => byId.get(a.id)).filter(Boolean),
    [accounts, byId],
  );
  const deals = useBiggestDeals(records, settings);

  const rows = useMemo(() => accounts.map(a => ({
    id: a.id || a.company,
    company: a.company || '',
    tier: a.tierLabel || a.myTier || '',
    prospect: byId.get(a.id) || null,
    deal: deals.get(a.id) || null,
  })), [accounts, byId, deals]);

  const priced = rows.filter(r => r.deal);
  const total = priced.reduce((s, r) => s + r.deal.fee, 0);
  const totalHigh = priced.reduce((s, r) => s + r.deal.feeHigh, 0);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 260,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => (r.prospect && onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(r.prospect)}
          title="Open the company"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textAlign: 'left' }}
        >{r.company}</button>
      ) : <span style={{ fontWeight: 600 }}>{r.company}</span>),
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 110,
      getSortValue: r => {
        const i = TIERS.indexOf(r.tier);
        return i >= 0 ? i : TIERS.length;
      },
      getFilterValue: r => r.tier,
      exportValue: r => r.tier,
      render: r => {
        if (!r.tier) return blank;
        const tint = TIER_TINTS[r.tier];
        if (!tint) return <span style={{ color: '#94A3B8', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{r.tier}</span>;
        return <span style={{ fontSize: '0.68rem', fontWeight: 700, color: tint.ink, background: tint.bg, border: `1px solid ${tint.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.tier}</span>;
      },
    },
    {
      key: 'deal', label: 'Largest Deal Size', defaultWidth: 190,
      headerTitle: 'The biggest service still open on the company, first-year fee, priced off its Sites, Accounts and other Scale figures through the Services Pricing rate card. The same figure as Biggest Deal on the company card.',
      // Ranked by the top of the range: the most the company could be worth.
      getSortValue: r => (r.deal ? r.deal.feeHigh : null),
      getFilterValue: r => (r.deal ? formatMoneyRange(r.deal.fee, r.deal.feeHigh) : ''),
      exportValue: r => (r.deal ? formatMoneyRange(r.deal.fee, r.deal.feeHigh) : ''),
      render: r => (r.deal
        ? <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatMoneyRange(r.deal.fee, r.deal.feeHigh)}</span>
        : <span title={r.prospect ? 'Nothing still open on this company can be priced' : 'Not in the tracker yet'} style={{ color: '#CBD5E1' }}>-</span>),
    },
    {
      key: 'dealService', label: 'Service', defaultWidth: 220,
      headerTitle: 'The service that deal is for, plus any services its Auto-add cell sells with it.',
      getSortValue: r => (r.deal?.name ? r.deal.name.toLowerCase() : null),
      getFilterValue: r => r.deal?.name || '',
      exportValue: r => (r.deal ? [r.deal.name, ...r.deal.adds].join(', ') : ''),
      render: r => (r.deal ? (
        <span style={{ color: '#475569' }} title={r.deal.adds.length ? `Sold with ${r.deal.adds.join(', ')}` : undefined}>
          {r.deal.name}
          {r.deal.adds.length > 0 && <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}> +{r.deal.adds.length} with it</span>}
        </span>
      ) : blank),
    },
  ], [onSelect]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {filterBar}
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {rows.length} account{rows.length === 1 ? '' : 's'} · {priced.length} with a deal priced
          {priced.length > 0 && ` · ${formatMoneyRange(total, totalHigh)} in all`}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          tableId="my-accounts-deal-size"
          exportFileName="My Accounts Deal Size"
          columns={columns}
          rows={rows}
          defaultSort={{ key: 'deal', direction: 'desc' }}
          fitWidth
          alwaysVisible={['company']}
          emptyMessage="No accounts match"
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
