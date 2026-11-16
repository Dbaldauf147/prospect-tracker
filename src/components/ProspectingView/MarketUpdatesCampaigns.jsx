// The saved email campaigns, as a table under the Prospecting ladder's
// "Reach out to contacts with market updates" step: the same figures the
// Email Campaigns > Saved Campaigns table shows (one function for % Sent,
// the stored response rate, the status rule), plus the Sent To ticks (one column
// each for Clients, Key Contacts, Prospects), which can be ticked from here too. A campaign's name opens Email Campaigns.
import { useMemo } from 'react';
import { DataTable } from '../common/DataTable';
import { useAuth } from '../../contexts/AuthContext';
import { useSavedCampaigns } from '../../hooks/useSavedCampaigns';
import { campaignSendStats, campaignOutreachLabel, isCampaignActive, isCampaignPaused } from '../../utils/campaignOutreach';
import { campaignSubjects } from '../../utils/campaignSubjects';
import { campaignCategory } from '../../utils/campaignCategory';
import { CAMPAIGN_AUDIENCES, campaignAudience, campaignIdentity } from '../../utils/campaignAudience';
import { saveCampaignAudience } from '../../utils/campaignAudienceStore';
import { fmtDate } from '../../utils/dealsFormat';

const statusOf = (c) => (isCampaignPaused(c) ? 'Paused' : isCampaignActive(c) ? 'Active' : 'Inactive');
const STATUS_STYLE = {
  Active: { border: '1px solid #86EFAC', background: '#DCFCE7', color: '#15803D' },
  Paused: { border: '1px solid #FCD34D', background: '#FEF3C7', color: '#92400E' },
  Inactive: { border: '1px solid #E2E8F0', background: '#F3F4F6', color: '#6B7280' },
};

export function MarketUpdatesCampaigns({ settings, updateSettings, onNavigate }) {
  const { user } = useAuth() || {};
  const { campaigns, loading } = useSavedCampaigns();

  const rows = useMemo(() => {
    const seen = new Map();
    return (campaigns || []).map((c) => {
      const base = campaignIdentity(c);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { id: n > 1 ? `${base}#${n}` : base, campaign: c, stats: campaignSendStats(c), status: statusOf(c) };
    });
  }, [campaigns]);

  const toggle = (c, key, on) => {
    saveCampaignAudience(user?.uid, c, key, on).catch(err => window.alert(`Could not save Sent To: ${err?.message || err}`));
  };

  const columns = useMemo(() => [
    {
      key: 'campaign', label: 'Campaign', defaultWidth: 320,
      getFilterValue: (r) => campaignOutreachLabel(r.campaign),
      getSortValue: (r) => campaignOutreachLabel(r.campaign).toLowerCase(),
      render: (r) => {
        const c = r.campaign;
        const subs = campaignSubjects(c);
        return (
          <div style={{ minWidth: 0, opacity: r.status === 'Active' ? 1 : 0.65 }}>
            {onNavigate ? (
              <button
                type="button"
                onClick={onNavigate}
                title="Open Email Campaigns"
                style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: '#1E293B', cursor: 'pointer', textAlign: 'left' }}
              >{campaignOutreachLabel(c)}</button>
            ) : <span style={{ fontWeight: 700, color: '#1E293B' }}>{campaignOutreachLabel(c)}</span>}
            <div style={{ fontSize: '0.66rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Subject{subs.length > 1 ? 's' : ''}: {subs.join(' · ') || 'TBD'}
            </div>
            <div style={{ fontSize: '0.66rem', color: '#64748B' }}>
              Saved {fmtDate(c.savedAt)}: {r.stats.sent} of {r.stats.total} sent, {Number(c.uniqueRepliers) || 0} replies
            </div>
          </div>
        );
      },
    },
    {
      key: 'category', label: 'Category', defaultWidth: 150,
      getFilterValue: (r) => campaignCategory(r.campaign) || '',
      render: (r) => campaignCategory(r.campaign) || <span style={{ color: '#CBD5E1' }}>-</span>,
    },
    // Sent To, one column per audience (Clients, Key Contacts, Prospects):
    // a single tick box each, so every audience can be filtered, sorted,
    // hidden and reordered on its own.
    ...CAMPAIGN_AUDIENCES.map(a => ({
      key: `sentTo_${a.key}`, label: a.label, defaultWidth: a.key === 'keyContacts' ? 130 : 105,
      headerTitle: `Sent to ${a.label}: tick if this campaign went to ${a.label}`,
      getFilterValue: (r) => (campaignAudience(r.campaign)[a.key] ? 'Yes' : 'No'),
      getSortValue: (r) => (campaignAudience(r.campaign)[a.key] ? 1 : 0),
      render: (r) => {
        const on = !!campaignAudience(r.campaign)[a.key];
        return (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center' }}>
            <input
              type="checkbox"
              checked={on}
              disabled={!user?.uid}
              onChange={(e) => toggle(r.campaign, a.key, e.target.checked)}
              aria-label={`Sent to ${a.label}`}
              title={`Sent to ${a.label}`}
              style={{ margin: 0, width: 15, height: 15, accentColor: '#16A34A', cursor: user?.uid ? 'pointer' : 'default' }}
            />
          </div>
        );
      },
    })),
    {
      key: 'pctSent', label: '% Sent', defaultWidth: 90,
      getFilterValue: (r) => `${r.stats.pct}%`,
      getSortValue: (r) => r.stats.pct,
      render: (r) => (
        <span title={`${r.stats.countedSent} of ${r.stats.countedTotal} sent, ${r.stats.remaining} still to go`} style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {r.stats.pct}%
        </span>
      ),
    },
    {
      key: 'responseRate', label: 'Response Rate', defaultWidth: 110,
      getFilterValue: (r) => `${Number(r.campaign.responseRate) || 0}%`,
      getSortValue: (r) => Number(r.campaign.responseRate) || 0,
      render: (r) => {
        const rate = Number(r.campaign.responseRate) || 0;
        return <span style={{ fontWeight: 700, color: rate >= 20 ? '#10B981' : rate >= 10 ? '#F59E0B' : '#DC2626' }}>{rate}%</span>;
      },
    },
    {
      key: 'status', label: 'Status', defaultWidth: 100,
      getFilterValue: (r) => r.status,
      render: (r) => (
        <span style={{ ...STATUS_STYLE[r.status], padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {r.status}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [onNavigate, user?.uid]);

  if (loading) return <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#94A3B8' }}>Loading campaigns...</div>;
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8 }} data-market-updates-campaigns>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: 4 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>Saved campaigns ({rows.length}):</span>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: '0.68rem', fontWeight: 700, color: '#0A66C2', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#BFDBFE', textUnderlineOffset: 2 }}
          >Open Email Campaigns</button>
        )}
      </div>
      {/* DataTable fills its parent's height, so give it one: room for
          every row up to most of the screen, then it scrolls. */}
      <div style={{ height: `min(60vh, ${150 + rows.length * 72}px)`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <DataTable
        tableId="prospecting-market-updates-campaigns"
        columns={columns}
        rows={rows}
        variableRowHeight
        emptyMessage="No saved campaigns"
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
