// Draft Emails > Client Campaigns: pick one of the saved email campaigns and
// see, for every current client, who at that company is on it and how far
// each of them got (sent, replied, bounced, not sent yet). A client with
// nobody on it stays in the list, since "which clients did this one miss"
// is half the question. See utils/clientCampaignCoverage for the matching.
//
// The roster is the campaign as last saved on Email Campaigns, so a send
// that went out since its last refresh shows once that page refreshes it.
import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { useEmailCampaigns } from '../../hooks/useEmailCampaigns';
import { campaignChoices, clientCampaignRows } from '../../utils/clientCampaignCoverage';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { useClientFlagMaps } from '../../utils/rosterHooks';

const PICK_KEY = 'client-campaigns-pick';

const STATUS_COLORS = {
  Replied: { background: '#DCFCE7', color: '#166534' },
  'No Reply': { background: '#E0E7FF', color: '#3730A3' },
  'Out of Office': { background: '#FEF3C7', color: '#92400E' },
  Bounced: { background: '#FEE2E2', color: '#991B1B' },
  'Not Sent': { background: '#F1F5F9', color: '#475569' },
};

const chip = (status) => (
  <span style={{
    ...(STATUS_COLORS[status] || STATUS_COLORS['Not Sent']),
    padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
  }}>{status}</span>
);

const linkBtn = {
  background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1D4ED8',
  cursor: 'pointer', textAlign: 'left', fontWeight: 600,
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export function ClientCampaignsView({ prospects, cdmName = '', settings, updateSettings, onSelectProspect, onOpenCampaign }) {
  const campaigns = useEmailCampaigns();
  // Clients ticked "Don't Track" on the Clients tab are left off this list.
  const { clientUntrackedMap } = useClientFlagMaps();
  const choices = useMemo(() => campaignChoices(campaigns), [campaigns]);
  // Remembered by the campaign's name, so a new campaign saved above it
  // doesn't move the pick to a different one.
  const [pickedLabel, setPickedLabel] = useState(() => userLsGet(PICK_KEY) || '');
  const [onlyReached, setOnlyReached] = useState(false);

  const picked = choices.find(c => c.label === pickedLabel) || choices[0] || null;
  const campaign = picked?.campaign || null;

  const allRows = useMemo(
    () => clientCampaignRows({ prospects, cdmName, campaign, untrackedMap: clientUntrackedMap }),
    [prospects, cdmName, campaign, clientUntrackedMap],
  );
  const rows = onlyReached ? allRows.filter(r => r.onCampaign > 0) : allRows;
  const reached = allRows.filter(r => r.onCampaign > 0).length;
  const peopleCount = allRows.reduce((n, r) => n + r.onCampaign, 0);
  const repliedClients = allRows.filter(r => r.replied > 0).length;

  const pick = (label) => {
    setPickedLabel(label);
    userLsSet(PICK_KEY, label);
  };

  const columns = [
    {
      key: 'company',
      label: 'Client',
      defaultWidth: 220,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => (onSelectProspect && r.client
        ? <button type="button" style={linkBtn} title="Open the company popup" onClick={() => onSelectProspect(r.client)}>{r.company}</button>
        : <strong>{r.company}</strong>),
    },
    {
      key: 'onCampaign',
      label: 'On Campaign',
      defaultWidth: 110,
      getSortValue: r => r.onCampaign,
      getFilterValue: r => (r.onCampaign ? 'Yes' : 'No'),
      exportValue: r => r.onCampaign,
      render: r => (r.onCampaign
        ? <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.onCampaign}</strong>
        : <span style={{ color: '#94A3B8' }}>None</span>),
    },
    {
      key: 'people',
      label: 'Who',
      defaultWidth: 420,
      getSortValue: r => (r.people[0] ? (r.people[0].name || r.people[0].email).toLowerCase() : null),
      getFilterValue: r => r.people.map(p => p.name || p.email).join(', '),
      exportValue: r => r.people.map(p => `${p.name ? `${p.name} <${p.email}>` : p.email} (${p.status})`).join('; '),
      render: r => (r.people.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 0' }}>
          {r.people.map(p => (
            <div key={`${p.email}|${p.name}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {chip(p.status)}
              <span style={{ fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>{p.name || p.email}</span>
              {p.name && (
                <span style={{ color: '#64748B', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
              )}
            </div>
          ))}
        </div>
      ) : <span style={{ color: '#94A3B8' }}>Nobody at this client is on it</span>),
    },
    {
      key: 'sent',
      label: 'Sent',
      defaultWidth: 80,
      getSortValue: r => r.sent,
      getFilterValue: r => String(r.sent),
      exportValue: r => r.sent,
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.sent}</span>,
    },
    {
      key: 'replied',
      label: 'Replied',
      defaultWidth: 90,
      getSortValue: r => r.replied,
      getFilterValue: r => String(r.replied),
      exportValue: r => r.replied,
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: r.replied ? 700 : 400, color: r.replied ? '#166534' : undefined }}>{r.replied}</span>,
    },
    {
      key: 'lastSent',
      label: 'Last Sent',
      defaultWidth: 120,
      getSortValue: r => r.lastSent || null,
      getFilterValue: r => fmtDate(r.lastSent),
      exportValue: r => r.lastSent,
      render: r => (r.lastSent ? fmtDate(r.lastSent) : <span style={{ color: '#94A3B8' }}>-</span>),
    },
  ];

  const noClients = allRows.length === 0;
  const refreshedMs = Date.parse(campaign?.refreshedAt || '');
  const refreshedOn = Number.isFinite(refreshedMs)
    ? new Date(refreshedMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
          Campaign
          <select
            value={picked?.label || ''}
            onChange={e => pick(e.target.value)}
            disabled={!choices.length}
            style={{
              minWidth: 320, maxWidth: '60vw', padding: '0.35rem 0.5rem', fontSize: '0.85rem',
              border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'inherit', background: '#fff',
            }}
          >
            {!choices.length && <option value="">No saved campaigns yet</option>}
            {choices.map(c => <option key={c.key} value={c.label}>{c.label}</option>)}
          </select>
        </label>
        {campaign && onOpenCampaign && (
          <button type="button" style={{ ...linkBtn, fontSize: '0.8rem' }} onClick={() => onOpenCampaign(campaign)}>
            Open on Email Campaigns
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyReached} onChange={e => setOnlyReached(e.target.checked)} />
          Only clients on this campaign
        </label>
      </div>

      {campaign && !noClients && (
        <div style={{ fontSize: '0.8rem', color: '#475569' }}>
          <strong style={{ color: '#1E293B' }}>{reached}</strong> of {allRows.length} current clients are on this campaign
          ({peopleCount} {peopleCount === 1 ? 'person' : 'people'}); {repliedClients} replied.
          {refreshedOn ? ` As of the campaign's last refresh, ${refreshedOn}.` : ''}
        </div>
      )}

      <div style={{
        height: 'calc(100vh - 230px)', minHeight: 320, display: 'flex', flexDirection: 'column',
        border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff',
      }}>
        <DataTable
          tableId="draft-emails-client-campaigns"
          columns={columns}
          rows={rows}
          alwaysVisible={['company']}
          defaultSort={{ key: 'onCampaign', direction: 'desc' }}
          variableRowHeight
          emptyMessage={noClients
            ? 'No current clients found. Clients are the Table View companies with status Client and you as CDM, less any ticked Don\'t Track on the Clients tab.'
            : onlyReached && reached === 0
              ? 'None of your current clients are on this campaign.'
              : 'No clients match the filters.'}
          exportFileName={`Client campaigns - ${picked?.label || 'campaign'}`}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
