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
import { CAMPAIGN_AUDIENCES, campaignAudience, campaignIdentity, campaignSchedule } from '../../utils/campaignAudience';
import { saveCampaignAudience, saveCampaignSchedule } from '../../utils/campaignAudienceStore';
import { AudienceScheduleDate } from '../EmailCampaignView/AudienceScheduleDate';
import { fmtDate } from '../../utils/dealsFormat';
import { campaignWarnings } from '../../utils/campaignWarnings';

const statusOf = (c) => (isCampaignPaused(c) ? 'Paused' : isCampaignActive(c) ? 'Active' : 'Inactive');
// Set-up gaps are red (fix before the rest goes out), unfinished sending amber.
const WARN_STYLE = {
  setup: { border: '1px solid #FECACA', background: '#FEF2F2', color: '#B91C1C' },
  sending: { border: '1px solid #FDE68A', background: '#FFFBEB', color: '#92400E' },
};
const warningsText = (ws) => ws.map(w => w.text).join(', ');

const STATUS_STYLE = {
  Active: { border: '1px solid #86EFAC', background: '#DCFCE7', color: '#15803D' },
  Paused: { border: '1px solid #FCD34D', background: '#FEF3C7', color: '#92400E' },
  Inactive: { border: '1px solid #E2E8F0', background: '#F3F4F6', color: '#6B7280' },
};

export function MarketUpdatesCampaigns({ settings, updateSettings, onNavigate }) {
  const { user } = useAuth() || {};
  const { campaigns, loading } = useSavedCampaigns();

  const rows = useMemo(() => {
    // Only active campaigns belong under this step: paused and inactive
    // ones are left out, the same rule the step's own status follows.
    // Ids are numbered across every campaign so they stay stable when a
    // campaign's status changes.
    const seen = new Map();
    return (campaigns || []).map((c) => {
      const base = campaignIdentity(c);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { id: n > 1 ? `${base}#${n}` : base, campaign: c, stats: campaignSendStats(c), status: statusOf(c), warnings: campaignWarnings(c) };
    }).filter((r) => r.status === 'Active');
  }, [campaigns]);

  const toggle = (c, key, on) => {
    saveCampaignAudience(user?.uid, c, key, on).catch(err => window.alert(`Could not save Sent To: ${err?.message || err}`));
  };
  // The audience's planned send date (set on Email Campaigns), changed or
  // cleared from here.
  const reschedule = (c, key, day) => {
    saveCampaignSchedule(user?.uid, c, key, day).catch(err => window.alert(`Could not save the date: ${err?.message || err}`));
  };

  const columns = useMemo(() => [
    {
      key: 'campaign', label: 'Campaign', defaultWidth: 300,
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
        const day = on ? '' : campaignSchedule(r.campaign)[a.key];
        return (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <input
              type="checkbox"
              checked={on}
              disabled={!user?.uid}
              onChange={(e) => toggle(r.campaign, a.key, e.target.checked)}
              aria-label={`Sent to ${a.label}`}
              title={`Sent to ${a.label}`}
              style={{ margin: 0, width: 15, height: 15, accentColor: '#16A34A', cursor: user?.uid ? 'pointer' : 'default' }}
            />
            {day && <AudienceScheduleDate value={day} label={a.label} hideEmpty compact disabled={!user?.uid} onChange={(next) => reschedule(r.campaign, a.key, next)} />}
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
      key: 'responseRate', label: 'Response Rate', defaultWidth: 135,
      getFilterValue: (r) => `${Number(r.campaign.responseRate) || 0}%`,
      getSortValue: (r) => Number(r.campaign.responseRate) || 0,
      render: (r) => {
        const rate = Number(r.campaign.responseRate) || 0;
        return <span style={{ fontWeight: 700, color: rate >= 20 ? '#10B981' : rate >= 10 ? '#F59E0B' : '#DC2626' }}>{rate}%</span>;
      },
    },
    // What the campaign still needs: set-up gaps and unfinished sending
    // (campaignWarnings). Summarised in the banner above the table too.
    {
      key: 'warnings', label: 'Warnings', defaultWidth: 220,
      headerTitle: 'What this active campaign is still missing: subject, category, Sent To, contacts, or sends',
      getFilterValue: (r) => (r.warnings.length ? warningsText(r.warnings) : 'Complete'),
      getSortValue: (r) => r.warnings.length,
      render: (r) => (r.warnings.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }} title={warningsText(r.warnings)}>
          {r.warnings.map(w => (
            <span key={w.key} style={{ ...WARN_STYLE[w.kind], padding: '0 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{w.text}</span>
          ))}
        </div>
      ) : <span style={{ color: '#16A34A', fontSize: '0.7rem', fontWeight: 600 }}>Complete</span>),
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

  const incomplete = rows.filter(r => r.warnings.length);

  if (loading) return <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#94A3B8' }}>Loading campaigns...</div>;
  if (!(campaigns || []).length) return null;
  return (
    <div style={{ marginTop: 8 }} data-market-updates-campaigns>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: 4 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>Active campaigns ({rows.length}):</span>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: '0.68rem', fontWeight: 700, color: '#0A66C2', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#BFDBFE', textUnderlineOffset: 2 }}
          >Open Email Campaigns</button>
        )}
      </div>
      {incomplete.length > 0 && (
        <div data-campaign-warnings style={{ margin: '2px 0 6px', padding: '6px 10px', border: '1px solid #FCD34D', background: '#FFFBEB', borderRadius: 8, fontSize: '0.72rem', color: '#92400E' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            ⚠ {incomplete.length} of {rows.length} active campaign{rows.length === 1 ? '' : 's'} {incomplete.length === 1 ? 'is' : 'are'} incomplete
          </div>
          {incomplete.map(r => (
            <div key={r.id}>
              <span style={{ fontWeight: 600 }}>{campaignOutreachLabel(r.campaign)}:</span> {warningsText(r.warnings)}
            </div>
          ))}
        </div>
      )}
      {/* DataTable fills its parent's height, so give it one: room for
          every row up to most of the screen, then it scrolls. */}
      <div style={{ height: `min(60vh, ${150 + rows.length * 72}px)`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <DataTable
        tableId="prospecting-market-updates-campaigns"
        columns={columns}
        rows={rows}
        variableRowHeight
        fitWidth
        emptyMessage="No active campaigns"
        settings={settings}
        updateSettings={updateSettings}
      />
      </div>
    </div>
  );
}
