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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { ContactsCampaignBulkAdd } from '../ProspectModal/ContactCampaignAdd';
import { primarySubject } from '../../utils/campaignSubjects';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { companyPopupTarget } from '../../utils/companyLookup';
import { DataTable } from '../common/DataTable';
import { useEmailCampaigns } from '../../hooks/useEmailCampaigns';
import { campaignChoices, clientCampaignRows, clientServiceBuckets, campaignServiceBucket, currentClients, rosterAccounts, keyContactSummary, contactHasAnyTag, CAMPAIGN_AUDIENCE_VIEWS } from '../../utils/clientCampaignCoverage';
import { makeRosterGates } from '../../utils/contactRosters';
import { getEffectiveServiceMetadata, parseServiceContactTags } from '../../data/serviceCatalog';
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
// Shown as a small pill each rather than a card: nobody works from them.
const PILL_BUCKETS = new Set(['sold', 'na']);
const KEY_CONTACTS_CLIENTS_KEY = 'client-campaigns-key-contacts-include-clients';

// A Table View company whose status is Client.
const isClientCompany = (p) => String(p?.status || '').trim().toLowerCase() === 'client';

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

// A person's name as a link to their contact popup: reads as the name it
// was, underlined on hover.
const nameBtn = {
  background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer',
  textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
  textDecoration: 'underline', textDecorationColor: '#CBD5E1', textUnderlineOffset: 2,
};

const linkBtn = {
  background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#1D4ED8',
  cursor: 'pointer', textAlign: 'left', fontWeight: 600,
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// A cell that lists people one line high: the first one, then "+N more",
// which opens the rest in place (and "Show less" folds them back).
function OneLine({ items, renderItem, open, onToggle }) {
  const shown = open ? items : items.slice(0, 1);
  const more = items.length - 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      {shown.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {renderItem(it)}
          {i === 0 && more > 0 && !open && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} title="Show everyone" style={moreBtn}>+{more} more</button>
          )}
        </div>
      ))}
      {open && more > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ ...moreBtn, alignSelf: 'flex-start' }}>Show less</button>
      )}
    </div>
  );
}
const moreBtn = {
  flexShrink: 0, background: 'none', border: '1px solid #CBD5E1', borderRadius: 999, padding: '0 7px',
  font: 'inherit', fontSize: '0.65rem', fontWeight: 700, color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap',
};

// Sold and N/A, the buckets nobody works from, as a small pill each: the
// count shows, and a click opens the companies in a pop-over.
function BucketPill({ bucket, active, noun, onFilter, renderList }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-bucket-pill={bucket.key}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={`${bucket.clients.length} ${noun} where this is ${bucket.label}. Click to see them.`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0.15rem 0.55rem', borderRadius: 999,
          border: `1px solid ${active ? bucket.color : '#CBD5E1'}`, background: bucket.bg === '#FFFFFF' ? '#F8FAFC' : bucket.bg,
          color: bucket.color, font: 'inherit', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">{bucket.key === 'sold' ? '\u2713' : '\u2298'}</span>
        {bucket.label}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{bucket.clients.length}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${bucket.label} ${noun}`}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, width: 300,
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.6rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.75rem', fontWeight: 700, color: bucket.color }}>
            {bucket.label} ({bucket.clients.length})
            {bucket.clients.length > 0 && (
              <button type="button" onClick={() => { onFilter(); setOpen(false); }} style={{ ...linkBtn, marginLeft: 'auto', fontSize: '0.7rem' }}>
                {active ? 'Show all in the table' : 'Filter the table to these'}
              </button>
            )}
          </div>
          {renderList()}
        </div>
      )}
    </span>
  );
}

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

  // Contact popup (the same ContactEditModal as Email Campaigns), opened by
  // clicking a person's name in the Who or roster column. Opens the HubSpot
  // record for that address, or a bare one the popup can create it from.
  const [editingContact, setEditingContact] = useState(null);
  const contactEditSettings = useContactEditSettings({ settings, updateSettings });
  const contactsByEmail = useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const e = String(c?.email || '').trim().toLowerCase();
      if (e && !m.has(e)) m.set(e, c);
    }
    return m;
  }, [contacts]);
  const openContact = (email, company) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return;
    setEditingContact(contactsByEmail.get(e) || { email: e, company: company || '' });
  };
  const openCompanyFromContact = useCallback((name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingContact(null);
    onSelectProspect(target);
  }, [prospects, onSelectProspect]);
  const editCompanyKey = String(editingContact?.company || '').trim().toLowerCase();
  const editCompanyContacts = useMemo(
    () => (editCompanyKey ? contacts.filter(c => String(c?.company || '').trim().toLowerCase() === editCompanyKey) : []),
    [editCompanyKey, contacts],
  );
  const editEmailDomains = useMemo(() => {
    if (!editCompanyKey) return [];
    const matched = (prospects || []).find(p => String(p.company || '').trim().toLowerCase() === editCompanyKey);
    return matched?.emailDomain
      ? String(matched.emailDomain).split(/[\n;,]+/).map(x => x.trim()).filter(Boolean)
      : [];
  }, [editCompanyKey, prospects]);
  const editCompanyNames = useMemo(() => (prospects || []).map(p => p.company).filter(Boolean), [prospects]);

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
  // The Key Contacts view leaves the companies that are already clients
  // out unless this is ticked: the Clients view is where they are covered.
  const [keyContactsIncludeClients, setKeyContactsIncludeClients] = useState(() => userLsGet(KEY_CONTACTS_CLIENTS_KEY) === '1');
  const pickKeyContactsIncludeClients = (on) => { setKeyContactsIncludeClients(on); userLsSet(KEY_CONTACTS_CLIENTS_KEY, on ? '1' : ''); };
  const services = useMemo(() => campaignServices(campaign), [campaign]);
  // The campaign services' Contact Tags (Dropdowns > service), the tags the
  // Key Contacts column picks out of each person's tags.
  const serviceTags = useMemo(() => {
    const out = [];
    for (const svc of services) {
      for (const t of parseServiceContactTags(getEffectiveServiceMetadata(svc, settings?.serviceOverrides || {})?.contactTags)) {
        if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
      }
    }
    return out;
  }, [services, settings?.serviceOverrides]);
  // keyPeople: company key -> the roster people there (Key Contacts or Key
  // Prospects), listed whether or not the campaign reached them.
  const { accounts, keyPeople } = useMemo(() => {
    if (audienceKey === 'clients' || !rosterGates) return { accounts: currentClients(prospects, cdmName, clientUntrackedMap), keyPeople: null };
    if (audienceKey === 'keyContacts') {
      const people = new Map();
      const list = rosterAccounts({ prospects, contacts, gate: rosterGates.isKey, untrackedMap: clientUntrackedMap, people });
      return { accounts: keyContactsIncludeClients ? list : list.filter(p => !isClientCompany(p)), keyPeople: people };
    }
    // Key Prospects for this campaign: Decision Makers at a Tier account
    // who also carry one of the campaign services' Contact Tags (e.g.
    // Procurement), not every Decision Maker there.
    const people = new Map();
    const gate = (c) => rosterGates.isKeyProspect(c) && contactHasAnyTag(c, serviceTags);
    return { accounts: rosterAccounts({ prospects, contacts, gate, accountOf: rosterGates.keyProspectAccountOf, untrackedMap: clientUntrackedMap, people }), keyPeople: people };
  }, [audienceKey, rosterGates, prospects, cdmName, contacts, clientUntrackedMap, keyContactsIncludeClients, serviceTags]);

  const allRows = useMemo(
    () => clientCampaignRows({ prospects, cdmName, campaign, accounts }),
    [prospects, cdmName, campaign, accounts],
  );

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
  // Key Contacts view: a company where every campaign service is N/A, or
  // Not Sold without the Prospect flag, is done with and left off the
  // table. Clicking its N/A / Not sold heading on the board still lists it.
  const closedOut = (r) => services.length > 0 && !!r.client && services.every(svc => {
    const status = statusOf(r.client, svc);
    const bucket = campaignServiceBucket(status);
    return bucket === 'na' || (bucket === 'notSold' && !prospectsAnyway(r.client, svc, status));
  });
  let hiddenClosed = 0;
  if (audience.key === 'keyContacts' && !bucketIds) {
    const kept = rows.filter(r => !closedOut(r));
    hiddenClosed = rows.length - kept.length;
    rows = kept;
  }
  const reached = allRows.filter(r => r.onCampaign > 0).length;
  const peopleCount = allRows.reduce((n, r) => n + r.onCampaign, 0);
  const repliedClients = allRows.filter(r => r.replied > 0).length;
  // Rows kept one person high; "+N more" opens one (by column).
  const [openCells, setOpenCells] = useState(() => new Set());
  const cellOpen = (r, col) => openCells.has(`${col}|${r.id}`);
  const toggleCell = (r, col) => setOpenCells(prev => {
    const next = new Set(prev);
    const k = `${col}|${r.id}`;
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // Each roster person, with how far the campaign got with them ('' when
  // they aren't on it): the ones it reached first, then Decision Makers.
  const keyContactsOf = (r) => {
    const list = keyPeople?.get(String(r.company || '').trim().toLowerCase()) || [];
    const onCampaign = new Map(r.people.map(p => [String(p.email || '').toLowerCase(), p.status]));
    const seen = new Set();
    return list.map(c => ({ ...keyContactSummary(c, serviceTags), status: onCampaign.get(String(c.email || '').toLowerCase()) || '' }))
      .filter(k => { const id = (k.email || k.name).toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true; })
      .sort((a, b) => (!!b.status - !!a.status) || (b.dm - a.dm) || a.name.localeCompare(b.name));
  };
  // Bulk add (Key Contacts / Prospects views): roster people ticked in the
  // roster column, by lowercased email, put on a saved campaign from the
  // bar above the table. Cleared when the campaign or the view changes.
  const keyByEmail = useMemo(() => {
    const m = new Map();
    for (const list of (keyPeople?.values() || [])) {
      for (const c of list) {
        const e = String(c?.email || '').trim().toLowerCase();
        if (e && !m.has(e)) m.set(e, c);
      }
    }
    return m;
  }, [keyPeople]);
  const [bulkPick, setBulkPick] = useState(() => new Set());
  useEffect(() => { setBulkPick(new Set()); }, [pickedName, audienceKey]);
  const toggleBulk = (email) => setBulkPick(prev => {
    const k = String(email || '').trim().toLowerCase();
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const bulkContacts = [...bulkPick].map(e => keyByEmail.get(e)).filter(Boolean);
  // Everyone in the rows on screen who isn't on this campaign yet.
  const notOnShown = () => {
    const out = [];
    for (const r of rows) for (const k of keyContactsOf(r)) if (k.email && !k.status) out.push(k.email.toLowerCase());
    return out;
  };
  const keyContactText = (k) => `${k.name}${k.tags.length ? ` (${k.tags.join(', ')})` : ''}${k.dm ? ' DM' : ''}`;

  // The companies in one bucket, as the cards and the Sold / N/A pop-overs
  // list them.
  const bucketList = (service, b, maxHeight = 140) => (
    <div style={{ padding: '0.3rem 0.55rem', display: 'flex', flexDirection: 'column', gap: 2, maxHeight, overflowY: 'auto' }}>
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
  );

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
        <OneLine
          items={r.people}
          open={cellOpen(r, 'people')}
          onToggle={() => toggleCell(r, 'people')}
          renderItem={p => (
            <>
              {chip(p.status)}
              <button type="button" onClick={(e) => { e.stopPropagation(); openContact(p.email, r.company); }} title={`Open ${p.name || p.email}`} style={{ ...nameBtn, color: '#1E293B' }}>{p.name || p.email}</button>
              {p.name && (
                <span style={{ color: '#64748B', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
              )}
            </>
          )}
        />
      ) : <span style={{ color: '#94A3B8' }}>Nobody at this {audience.one} is on it</span>),
    },
    // Key Contacts view: the Key Contacts at the company, each with their
    // tags for the campaign's service and a check if tagged Decision Maker.
    // Key Contacts / Prospects views: the roster people at the company,
    // reached or not, each with a check if tagged Decision Maker, their
    // tags for the campaign's service, and where the campaign got with them.
    ...(keyPeople ? [{
      key: audience.key === 'keyContacts' ? 'keyContacts' : 'keyProspects',
      label: audience.key === 'keyContacts' ? 'Key Contacts' : 'Key Prospects',
      defaultWidth: 360,
      getSortValue: r => keyContactsOf(r).filter(k => k.dm).length,
      getFilterValue: r => keyContactsOf(r).map(keyContactText).join(', '),
      exportValue: r => keyContactsOf(r).map(k => `${keyContactText(k)} [${k.status || 'Not on campaign'}]`).join('; '),
      render: r => {
        const list = keyContactsOf(r);
        if (!list.length) return <span style={{ color: '#94A3B8' }}>-</span>;
        const col = audience.key === 'keyContacts' ? 'keyContacts' : 'keyProspects';
        return (
          <OneLine
            items={list}
            open={cellOpen(r, col)}
            onToggle={() => toggleCell(r, col)}
            renderItem={k => (
              <>
                {k.email && (
                  <input
                    type="checkbox"
                    checked={bulkPick.has(k.email.toLowerCase())}
                    onChange={() => toggleBulk(k.email)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${k.name} to add to a campaign`}
                    title="Select to add to an email campaign (bar above the table)"
                    style={{ margin: 0, flexShrink: 0, cursor: 'pointer' }}
                  />
                )}
                <span
                  aria-label={k.dm ? 'Decision Maker' : 'Not tagged Decision Maker'}
                  title={k.dm ? 'Tagged Decision Maker' : 'Not tagged Decision Maker'}
                  style={{ width: 14, flexShrink: 0, textAlign: 'center', fontWeight: 800, color: '#16A34A' }}
                >{k.dm ? '\u2713' : ''}</span>
                {k.status
                  ? chip(k.status)
                  : <span title="Not on this campaign" style={{ flexShrink: 0, padding: '0 7px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, border: '1px dashed #CBD5E1', color: '#94A3B8', whiteSpace: 'nowrap' }}>Not on</span>}
                {k.email
                  ? <button type="button" onClick={(e) => { e.stopPropagation(); openContact(k.email, r.company); }} title={`Open ${k.name} (${k.email})`} style={{ ...nameBtn, color: k.status ? '#1E293B' : '#64748B' }}>{k.name}</button>
                  : <span style={{ fontWeight: 600, color: k.status ? '#1E293B' : '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</span>}
                {k.tags.map(t => (
                  <span key={t} style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '0 6px', borderRadius: 999, background: '#EDE9FE', color: '#5B21B6', border: '1px solid #C4B5FD', whiteSpace: 'nowrap' }}>{t}</span>
                ))}
              </>
            )}
          />
        );
      },
    }] : []),
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
        {audience.key === 'keyContacts' && (
          <label
            title="Key Contacts leaves out the companies that are already clients (status Client); the Clients view covers those. Tick to list them here too."
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#475569', cursor: 'pointer' }}
          >
            <input type="checkbox" checked={keyContactsIncludeClients} onChange={e => pickKeyContactsIncludeClients(e.target.checked)} />
            Include clients
          </label>
        )}
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
                    : 'Companies of the people on your Key Prospects roster (Decision Makers at your Tier 1-3 accounts) who carry the campaign service\'s Contact Tags'}
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
          {hiddenClosed > 0 && ` ${hiddenClosed} ${hiddenClosed === 1 ? 'company is' : 'companies are'} N/A or Not Sold, so ${hiddenClosed === 1 ? 'it is' : 'they are'} left off the table (click N/A or Not sold above to see them).`}
        </div>
      )}

      {campaign && !noClients && serviceBuckets.map(({ service, buckets }) => (
        <div key={service} data-service-buckets style={{ border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', padding: '0.6rem 0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B' }}>
              {service}
              <span style={{ fontWeight: 400, color: '#64748B' }}> - where this service stands at each {audience.one}. Click a heading to filter the table.</span>
            </div>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.4rem' }}>
              {buckets.filter(b => PILL_BUCKETS.has(b.key)).map(b => {
                const active = bucketPick?.service === service && bucketPick?.key === b.key;
                return (
                  <BucketPill
                    key={b.key}
                    bucket={b}
                    active={active}
                    noun={audience.one === 'client' ? 'clients' : 'companies'}
                    onFilter={() => setBucketPick(active ? null : { service, key: b.key })}
                    renderList={() => bucketList(service, b, 260)}
                  />
                );
              })}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem' }}>
            {buckets.filter(b => !PILL_BUCKETS.has(b.key)).map(b => {
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
                  {bucketList(service, b)}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {campaign && keyPeople && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: '#475569', marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => setBulkPick(prev => new Set([...prev, ...notOnShown()]))}
              title="Tick every person in the rows shown who isn't on this campaign yet"
              style={{ padding: '2px 10px', borderRadius: 4, border: '1px solid #C7D2FE', background: '#fff', color: '#4338CA', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
            >Select everyone not on this campaign ({notOnShown().length})</button>
            {bulkPick.size > 0 && (
              <button
                type="button"
                onClick={() => setBulkPick(new Set())}
                style={{ ...linkBtn, fontSize: '0.72rem', color: '#64748B' }}
              >Clear selection</button>
            )}
          </div>
          <ContactsCampaignBulkAdd
            contacts={bulkContacts}
            onClose={() => setBulkPick(new Set())}
            onAdded={() => setBulkPick(new Set())}
            preferSubject={primarySubject(campaign)}
            hint={`Tick people in the ${audience.key === 'keyContacts' ? 'Key Contacts' : 'Key Prospects'} column below, or use Select everyone above.`}
          />
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
            ? (audience.key === 'clients'
              ? 'No current clients found. Clients are the Table View companies with status Client and you as CDM, less any ticked Don\'t Track on the Clients tab.'
              : audience.key === 'keyContacts'
                ? 'No Key Contact companies found. These are the Table View companies of the people tagged Dan Key Target in HubSpot.'
                : 'No Key Prospect companies found. These are your Tier 1-3 accounts with a Decision Maker on the Key Prospects roster who carries the campaign service\'s Contact Tags.')
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

      {editingContact && createPortal(
        <ContactEditModal
          prospects={prospects}
          contact={editingContact}
          onSave={(_updated, opts) => { if (!opts?.silent) setEditingContact(null); }}
          onClose={() => setEditingContact(null)}
          onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
          {...contactEditSettings}
          companyContacts={editCompanyContacts}
          allContacts={contacts}
          emailDomains={editEmailDomains}
          companyNames={editCompanyNames}
        />,
        document.body,
      )}
    </div>
  );
}
