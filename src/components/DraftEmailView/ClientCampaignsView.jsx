// Draft Emails > Client Campaigns: pick one of the saved email campaigns and
// see, for every current client, who at that company is on it and how far
// each of them got (sent, replied, bounced, not sent yet). A client with
// nobody on it stays in the list, since "which clients did this one miss"
// is half the question. See utils/clientCampaignCoverage for the matching.
//
// The roster is the campaign as last saved on Email Campaigns, so a send
// that went out since its last refresh shows once that page refreshes it.
//
// When the campaign is tagged with services (Email Campaigns > Services),
// a panel above the table splits the clients by where each service stands
// at them: Sold, In progress, Not sold, N/A, Not explored, read the way the
// company popup reads it (manual status, then a matching opp, then auto N/A).
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { useEmailCampaigns } from '../../hooks/useEmailCampaigns';
import { campaignChoices, clientCampaignRows, clientServiceBuckets, campaignServiceBucket, currentClients, rosterAccounts, CAMPAIGN_AUDIENCE_VIEWS } from '../../utils/clientCampaignCoverage';
import { makeRosterGates } from '../../utils/contactRosters';
import { campaignServices } from '../../utils/campaignServices';
import { buildOppStagesByClient, effectiveServiceStatus } from '../../utils/serviceCoverage';
import { buildAutoNaByClient } from '../../utils/serviceAutoNaByClient';
import { serviceStatusColor, SERVICE_BUCKETS } from '../../utils/serviceStatusColors';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { useClientFlagMaps } from '../../utils/rosterHooks';
import { prospectsAnyway } from '../../utils/serviceProspectAnyway';

// The company popup's "Prospect" flag on a Not Sold service
// (utils/serviceProspectAnyway): still being prospected for, so it is
// called out wherever the Not Sold status shows here.
const PROSPECT_TAG_STYLE = {
  flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, padding: '0 5px', borderRadius: 4,
  border: '1px solid #16A34A', background: '#DCFCE7', color: '#166534', whiteSpace: 'nowrap',
};
const prospectTag = (service) => (
  <span data-prospect-anyway style={PROSPECT_TAG_STYLE} title={`Not Sold, but still prospecting for ${service} (the Prospect button on the company popup)`}>Prospect</span>
);

const PICK_KEY = 'client-campaigns-pick';
const AUDIENCE_KEY = 'client-campaigns-audience';

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
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();
  const choices = useMemo(() => campaignChoices(campaigns), [campaigns]);
  // Remembered by the campaign's name, so a new campaign saved above it
  // doesn't move the pick to a different one.
  const [pickedLabel, setPickedLabel] = useState(() => userLsGet(PICK_KEY) || '');
  const [onlyReached, setOnlyReached] = useState(false);

  const picked = choices.find(c => c.label === pickedLabel) || choices[0] || null;
  const campaign = picked?.campaign || null;

  // Opps and HubSpot contacts feed the service statuses (an opp naming the
  // service, and the auto N/A rules), as on the company popup, and the
  // contact rosters behind the Key Contacts / Prospects views.
  const [oppsRecords, setOppsRecords] = useState([]);
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadOppsFromCache().then(o => { if (!cancelled) setOppsRecords(o?.records || []); }).catch(() => {});
    getHubspotContacts().then(c => { if (!cancelled) setContacts(c || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Which companies are listed: current clients (the default), or the
  // companies of the people on the Key Contacts or Key Prospects roster.
  const [audienceKey, setAudienceKey] = useState(() => {
    const saved = userLsGet(AUDIENCE_KEY);
    return CAMPAIGN_AUDIENCE_VIEWS.some(a => a.key === saved) ? saved : 'clients';
  });
  const audience = CAMPAIGN_AUDIENCE_VIEWS.find(a => a.key === audienceKey) || CAMPAIGN_AUDIENCE_VIEWS[0];
  const pickAudience = (key) => { setAudienceKey(key); userLsSet(AUDIENCE_KEY, key); };
  const rosterGates = useMemo(
    () => (audienceKey === 'clients' ? null : makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap })),
    [audienceKey, prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  const accounts = useMemo(() => {
    if (audienceKey === 'clients' || !rosterGates) return currentClients(prospects, cdmName, clientUntrackedMap);
    return audienceKey === 'keyContacts'
      ? rosterAccounts({ prospects, contacts, gate: rosterGates.isKey, untrackedMap: clientUntrackedMap })
      : rosterAccounts({ prospects, contacts, gate: rosterGates.isKeyProspect, accountOf: rosterGates.keyProspectAccountOf, untrackedMap: clientUntrackedMap });
  }, [audienceKey, rosterGates, prospects, cdmName, contacts, clientUntrackedMap]);

  const allRows = useMemo(
    () => clientCampaignRows({ prospects, cdmName, campaign, accounts }),
    [prospects, cdmName, campaign, accounts],
  );

  const services = useMemo(() => campaignServices(campaign), [campaign]);
  const clients = useMemo(() => allRows.map(r => r.client).filter(Boolean), [allRows]);
  const oppStagesByClient = useMemo(
    () => (services.length ? buildOppStagesByClient(clients, oppsRecords, services) : new Map()),
    [services, clients, oppsRecords],
  );
  const autoNaByClient = useMemo(
    () => (services.length ? buildAutoNaByClient(clients, { settings, contacts, oppStagesByClient }) : new Map()),
    [services, clients, settings, contacts, oppStagesByClient],
  );
  const statusOf = (client, service) => effectiveServiceStatus(client, service, oppStagesByClient, autoNaByClient);
  // The status as text, "Not Sold - Prospect" when it is flagged to keep
  // prospecting, so the column's filter and export can tell the two apart.
  const statusLabel = (r, service) => {
    const status = (r.client && statusOf(r.client, service)) || '';
    return status && prospectsAnyway(r.client, service, status) ? `${status} - Prospect` : status;
  };
  const serviceBuckets = useMemo(
    () => clientServiceBuckets({ rows: allRows, services, statusOf }),
    // statusOf only reads the two maps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, services, oppStagesByClient, autoNaByClient],
  );

  // Clicking a bucket narrows the table to its clients; again clears it.
  const [bucketPick, setBucketPick] = useState(null); // { service, key }
  const pickedName = picked?.label || '';
  useEffect(() => { setBucketPick(null); }, [pickedName, audienceKey]);
  const bucketIds = useMemo(() => {
    if (!bucketPick) return null;
    const b = serviceBuckets.find(x => x.service === bucketPick.service)?.buckets.find(x => x.key === bucketPick.key);
    return b ? new Set(b.clients.map(x => x.row.id)) : null;
  }, [bucketPick, serviceBuckets]);

  let rows = onlyReached ? allRows.filter(r => r.onCampaign > 0) : allRows;
  if (bucketIds) rows = rows.filter(r => bucketIds.has(r.id));
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
      label: audience.key === 'clients' ? 'Client' : 'Company',
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
      ) : <span style={{ color: '#94A3B8' }}>Nobody at this {audience.one} is on it</span>),
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
    ...services.map(service => ({
      key: `svc:${service.toLowerCase()}`,
      label: service,
      defaultWidth: 175,
      getSortValue: r => SERVICE_BUCKETS.findIndex(b => b.key === campaignServiceBucket(r.client ? statusOf(r.client, service) : '')),
      getFilterValue: r => statusLabel(r, service) || 'Not explored',
      exportValue: r => statusLabel(r, service),
      render: r => {
        const status = r.client ? statusOf(r.client, service) : '';
        if (!status) return <span style={{ color: '#94A3B8' }}>Not explored</span>;
        const c = serviceStatusColor(status);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              background: c.bg || '#F1F5F9', color: c.color || '#475569',
              padding: '1px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
            }}>{status}</span>
            {prospectsAnyway(r.client, service, status) && prospectTag(service)}
          </span>
        );
      },
    })),
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
          Only {audience.key === 'clients' ? 'clients' : 'companies'} on this campaign
        </label>
        <div role="group" aria-label="Which companies to list" style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
          {CAMPAIGN_AUDIENCE_VIEWS.map((a, i) => {
            const on = a.key === audience.key;
            return (
              <button
                key={a.key}
                type="button"
                aria-pressed={on}
                onClick={() => pickAudience(a.key)}
                title={a.key === 'clients'
                  ? 'Your current clients (status Client, you as CDM, not Don\'t Track)'
                  : a.key === 'keyContacts'
                    ? 'Companies of the people on your Key Contacts roster (tagged Dan Key Target)'
                    : 'Companies of the people on your Key Prospects roster (Decision Makers at your Tier 1-3 accounts)'}
                style={{
                  padding: '0.25rem 0.7rem', border: 'none', borderLeft: i ? '1px solid #CBD5E1' : 'none',
                  font: 'inherit', fontSize: '0.78rem', fontWeight: on ? 700 : 500, cursor: 'pointer',
                  background: on ? '#1D4ED8' : '#fff', color: on ? '#fff' : '#334155',
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {campaign && !noClients && (
        <div style={{ fontSize: '0.8rem', color: '#475569' }}>
          <strong style={{ color: '#1E293B' }}>{reached}</strong> of {allRows.length} {audience.noun} are on this campaign
          ({peopleCount} {peopleCount === 1 ? 'person' : 'people'}); {repliedClients} replied.
          {refreshedOn ? ` As of the campaign's last refresh, ${refreshedOn}.` : ''}
        </div>
      )}

      {campaign && !noClients && serviceBuckets.map(({ service, buckets }) => (
        <div key={service} data-service-buckets style={{ border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.6rem 0.75rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.45rem' }}>
            {service}
            <span style={{ fontWeight: 400, color: '#64748B' }}> - where this service stands at each {audience.one}. Click a heading to filter the table.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem' }}>
            {buckets.map(b => {
              const active = bucketPick?.service === service && bucketPick?.key === b.key;
              return (
                <div key={b.key} style={{
                  border: `1px solid ${active ? b.color : '#E2E8F0'}`, borderRadius: 6, overflow: 'hidden',
                  boxShadow: active ? `0 0 0 1px ${b.color}` : 'none',
                }}>
                  <button
                    type="button"
                    onClick={() => setBucketPick(active ? null : { service, key: b.key })}
                    title={active ? `Show every ${audience.one} again` : `Show only the ${audience.one === 'client' ? 'clients' : 'companies'} where ${service} is ${b.label}`}
                    style={{
                      width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: b.bg === '#FFFFFF' ? '#F8FAFC' : b.bg, color: b.color, border: 'none',
                      padding: '0.3rem 0.55rem', font: 'inherit', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    <span>{b.label}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{b.clients.length}</span>
                  </button>
                  <div style={{ padding: '0.3rem 0.55rem', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 140, overflowY: 'auto' }}>
                    {b.clients.length === 0 && <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{audience.one === 'client' ? 'No clients' : 'No companies'}</span>}
                    {b.clients.map(({ row, status }) => (
                      <div key={row.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.75rem', minWidth: 0 }}>
                        {onSelectProspect && row.client
                          ? <button type="button" style={{ ...linkBtn, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${row.company}${status && b.key === 'inProgress' ? ` (${status})` : ''}. Open the company popup`} onClick={() => onSelectProspect(row.client)}>{row.company}</button>
                          : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company}</span>}
                        {row.client && prospectsAnyway(row.client, service, status) && prospectTag(service)}
                        <span
                          style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '0.68rem', color: row.onCampaign ? '#3730A3' : '#94A3B8', fontWeight: row.onCampaign ? 700 : 400 }}
                          title={row.onCampaign ? `${row.onCampaign} ${row.onCampaign === 1 ? 'person' : 'people'} here on this campaign` : 'Nobody here is on this campaign'}
                        >{row.onCampaign ? `${row.onCampaign} on` : 'not on'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

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
            ? (audience.key === 'clients'
              ? 'No current clients found. Clients are the Table View companies with status Client and you as CDM, less any ticked Don\'t Track on the Clients tab.'
              : audience.key === 'keyContacts'
                ? 'No Key Contact companies found. These are the Table View companies of the people tagged Dan Key Target in HubSpot.'
                : 'No Key Prospect companies found. These are your Tier 1-3 accounts with a Decision Maker on the Key Prospects roster.')
            : bucketIds && rows.length === 0
              ? 'Nothing in that bucket matches the filters.'
              : onlyReached && reached === 0
              ? `None of the ${audience.noun} are on this campaign.`
              : 'Nothing matches the filters.'}
          exportFileName={`Client campaigns - ${picked?.label || 'campaign'}`}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  );
}
