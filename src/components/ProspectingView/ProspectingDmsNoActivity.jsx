// Prospecting > DMs Without Activity: the decision makers at your accounts
// that nothing has reached. Never-reached by default; a chip widens it to
// "none in the last N days". The people are the History chart's Decision
// Makers roster (tagged Decision Maker at an account with you as its CDM,
// less Hide / Left / Schneider and the clients every roster leaves out),
// and "activity" is the same per-contact outreach that chart counts: a
// HubSpot email or call from the Activity tab's index, or HubSpot's Last
// Contacted date (utils/tieredAccountActivity, decisionMakersWithoutActivity).
import { useCallback, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { BulkContactEditModal } from '../common/BulkContactEditModal';
import { ContactsCampaignBulkAdd } from '../ProspectModal/ContactCampaignAdd';
import { useEmailCampaigns } from '../../hooks/useEmailCampaigns';
import { campaignsByRecency } from '../../utils/campaignPicker';
import { campaignAddresses } from '../../utils/campaignAddContact';
import { normEmail } from '../../utils/campaignRoster';
import { primarySubject } from '../../utils/campaignSubjects';
import { useDmsNoActivity, DMS_WINDOWS as WINDOWS, readDmsWindow as readWindow, writeDmsWindow, dmsWindowLabel as windowLabel } from '../../hooks/useDmsNoActivity';
import { daysSince, accountStatusOf } from '../../utils/tieredAccountActivity';
import { reportingTier } from '../../utils/tierSource.js';
import { formatDateDisplay } from '../../utils/isoDate';
import { bfoCompanyNamesOf, markedNoBfoName } from '../../utils/bfoCompanyNames';
import { bfoHistoryIsNone, bfoHistoryReviewState } from '../../utils/bfoHistory';
import { useBiggestDeals } from '../../hooks/useBiggestDeals';
import { dealMid } from '../../utils/prospectingDeals.js';
import { formatMoney, formatMoneyRange } from '../../utils/servicePricing';
import { DM_TOPICS, matchesDmTopic } from '../../utils/procurementDmFilter';

const fmt = (n) => Number(n || 0).toLocaleString();
const blank = <span style={{ color: '#CBD5E1' }}>-</span>;
const chipStyle = (active) => ({ padding: '0.2rem 0.65rem', borderRadius: 999, border: `1px solid ${active ? '#0A66C2' : '#E2E8F0'}`, background: active ? '#EFF6FF' : '#fff', color: active ? '#0A66C2' : '#475569', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' });
const linkBtn = { background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#2563EB', cursor: 'pointer', textAlign: 'left' };
const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || String(c?.email || '');
// The contact's HubSpot City, State and Country. The country is left off for
// the US, where it's nearly everyone and only lengthens the cell.
const US = new Set(['united states', 'united states of america', 'usa', 'us']);
const locationOf = (c) => {
  const country = String(c?.country || '').trim();
  return [c?.city, c?.state, US.has(country.toLowerCase()) ? '' : country]
    .map(v => String(v || '').trim()).filter(Boolean).join(', ');
};
const linkedinOf = (c) => c?.hs_linkedin_url || c?.linkedin_url || c?.hs_linkedinid || '';
// Blank, non-numeric or missing reads as no figure (null), so it sorts last.
const sitesOf = (a) => {
  const v = a?.numberOfSites;
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const campaignLabel = (c) => c?.title || primarySubject(c) || '(untitled campaign)';
// The BFO History Updated cell's fill: green once every pasted row is
// marked Ignored or OK, grey when there is no history to review.
const BFO_FILL = {
  reviewed: { background: '#DCFCE7', color: '#166534' },
  none: { background: '#E2E8F0', color: '#475569' },
};
const fillPill = (fill) => (fill ? { ...fill, display: 'inline-block', padding: '0 6px', borderRadius: 4, fontWeight: 600 } : undefined);
// The contacts tables' "<Topic> DMs" buttons, here too: which ones are lit
// is remembered per browser. Several lit show anyone matching any of them.
const TOPICS_KEY = 'prospecting-dms-no-activity:dm-topics';
const readTopics = () => {
  try {
    return String(localStorage.getItem(TOPICS_KEY) || '').split(',').filter(k => DM_TOPICS.some(t => t.key === k));
  } catch { return []; }
};
const topicChipStyle = (on) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0.2rem 0.6rem', fontSize: '0.7rem', fontWeight: 600,
  borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid ' + (on ? '#2563EB' : '#CBD5E1'),
  background: on ? '#2563EB' : '#fff',
  color: on ? '#fff' : '#475569',
});
const topicCountStyle = (on) => ({
  display: 'inline-block', padding: '0 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 999, minWidth: 18, textAlign: 'center',
  background: on ? 'rgba(255,255,255,0.25)' : '#F1F5F9', color: on ? '#fff' : '#475569',
});
const toIso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ProspectingDmsNoActivity({ prospects, settings, updateSettings, cdmName = '', onSelectProspect, onOpenContact = null }) {
  const { lists, accountOf, noIndex } = useDmsNoActivity({ prospects, settings, cdmName });

  // The saved email campaigns (useEmailCampaigns), re-read whenever one of
  // the campaign pop-ups adds someone, so the Email Campaign column follows
  // an Add to Campaign made from this page.
  const campaigns = useEmailCampaigns();
  // email -> the campaigns it is on, most recently active first.
  const campaignsByEmail = useMemo(() => {
    const out = new Map();
    for (const { campaign } of campaignsByRecency(campaigns)) {
      const label = campaignLabel(campaign);
      for (const addr of campaignAddresses(campaign)) {
        if (!out.has(addr)) out.set(addr, []);
        if (!out.get(addr).includes(label)) out.get(addr).push(label);
      }
    }
    return out;
  }, [campaigns]);

  const [windowDays, setWindowState] = useState(readWindow);
  const setWindow = (w) => {
    setWindowState(w);
    writeDmsWindow(w);
  };

  // Each account's Biggest Deal: the company card's own reading (the
  // biggest service still open, priced through the rate card), so the
  // figure here is the one on the card.
  const dealAccounts = useMemo(() => {
    const byId = new Map();
    for (const { contact } of lists?.get(windowDays) || []) {
      const a = accountOf(contact);
      if (a?.id && !byId.has(a.id)) byId.set(a.id, a);
    }
    return [...byId.values()];
  }, [lists, windowDays, accountOf]);
  const deals = useBiggestDeals(dealAccounts, settings);

  const [dmTopics, setDmTopicsState] = useState(readTopics);
  const toggleDmTopic = (key) => setDmTopicsState(cur => {
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    try { localStorage.setItem(TOPICS_KEY, next.join(',')); } catch { /* per-viewer convenience only */ }
    return next;
  });
  const tagReviewMap = useMemo(() => settings?.contactTagReview || {}, [settings?.contactTagReview]);
  // Each topic's matches in the picked window, keyed by row id.
  const windowEntries = useMemo(() => lists?.get(windowDays) || [], [lists, windowDays]);
  const topicMatches = useMemo(() => {
    const out = new Map(DM_TOPICS.map(t => [t.key, new Set()]));
    for (const { contact } of windowEntries) {
      const id = String(contact.id || contact.vid || contact.email);
      const account = accountOf(contact);
      for (const t of DM_TOPICS) if (matchesDmTopic(contact, account, tagReviewMap, t)) out.get(t.key).add(id);
    }
    return out;
  }, [windowEntries, accountOf, tagReviewMap]);

  const rows = useMemo(() => windowEntries.filter(({ contact }) => {
    if (!dmTopics.length) return true;
    const id = String(contact.id || contact.vid || contact.email);
    return dmTopics.some(k => topicMatches.get(k)?.has(id));
  }).map(({ contact, lastMs }) => {
    const account = accountOf(contact);
    return {
      deal: (account?.id && deals.get(account.id)) || null,
      id: String(contact.id || contact.vid || contact.email),
      contact, lastMs, account,
      name: nameOf(contact),
      tier: account ? reportingTier(account) : '',
      status: accountStatusOf(account),
      campaigns: campaignsByEmail.get(normEmail(contact.email)) || [],
    };
  }), [windowEntries, dmTopics, topicMatches, accountOf, deals, campaignsByEmail]);

  // Bulk actions: tick rows (or the header box for every row on screen),
  // then Add to Campaign or Bulk Edit. Only rows still on screen count, so
  // a filter or a window change can't leave a hidden row in a bulk write.
  const [selected, setSelected] = useState(() => new Set());
  const [filteredIds, setFilteredIds] = useState(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const onFilteredRowsChange = useCallback((list) => setFilteredIds(list.map(r => r.id)), []);
  const onScreen = useMemo(() => {
    const ids = filteredIds ? new Set(filteredIds) : null;
    return ids ? rows.filter(r => ids.has(r.id)) : rows;
  }, [rows, filteredIds]);
  const selectedRows = onScreen.filter(r => selected.has(r.id));
  const selectedContacts = selectedRows.map(r => r.contact);
  const allSelected = onScreen.length > 0 && selectedRows.length === onScreen.length;
  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(onScreen.map(r => r.id)));
  const showFlash = (text) => { setFlash(text); window.setTimeout(() => setFlash(''), 5000); };

  const selectCol = {
    key: '__select__',
    label: '',
    defaultWidth: 36,
    renderHeader: () => (
      <input type="checkbox" aria-label="Select every row on screen" title="Select every row on screen"
        checked={allSelected} onChange={toggleAll} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
    ),
    render: r => (
      <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)}
        onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
    ),
    exportValue: () => '',
  };

  const dataColumns = useMemo(() => [
    {
      key: 'name', label: 'Name', defaultWidth: 180,
      getSortValue: r => r.name.toLowerCase() || null, getFilterValue: r => r.name, exportValue: r => r.name,
      render: r => (onOpenContact
        ? <button type="button" style={linkBtn} title="Open contact" onClick={() => onOpenContact(r.contact)}>{r.name}</button>
        : r.name),
    },
    {
      key: 'jobtitle', label: 'Job Title', defaultWidth: 240,
      getSortValue: r => String(r.contact.jobtitle || '').toLowerCase() || null,
      getFilterValue: r => r.contact.jobtitle || '', exportValue: r => r.contact.jobtitle || '',
      render: r => r.contact.jobtitle || blank,
    },
    {
      key: 'account', label: 'Account', defaultWidth: 220,
      getSortValue: r => String(r.account?.company || r.contact.company || '').toLowerCase() || null,
      getFilterValue: r => r.account?.company || r.contact.company || '', exportValue: r => r.account?.company || r.contact.company || '',
      render: r => (r.account && onSelectProspect
        ? <button type="button" style={{ ...linkBtn, fontWeight: 600 }} title="Open the company" onClick={() => onSelectProspect(r.account)}>{r.account.company}</button>
        : (r.account?.company || r.contact.company || blank)),
    },
    {
      key: 'location', label: 'Location', defaultWidth: 170,
      headerTitle: 'Where the contact is, from their HubSpot City, State and Country (the country is left off for the US).',
      getSortValue: r => locationOf(r.contact).toLowerCase() || null,
      getFilterValue: r => locationOf(r.contact), exportValue: r => locationOf(r.contact),
      render: r => locationOf(r.contact) || blank,
    },
    {
      key: 'deal', label: 'Biggest Deal', defaultWidth: 140,
      headerTitle: 'The biggest service still open on the account, first-year fee, priced off its Scale figures through the Services Pricing rate card. Shown as the middle of its range; hover a figure for the range and the service. The same deal as Biggest Deal on the company card.',
      getSortValue: r => (r.deal ? dealMid(r.deal) : null),
      getFilterValue: r => (r.deal ? formatMoney(dealMid(r.deal)) : ''),
      exportValue: r => (r.deal ? Math.round(dealMid(r.deal)) : ''),
      render: r => (r.deal
        ? (
          <span
            style={{ display: 'block', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            title={`${r.deal.name}${r.deal.adds.length ? ` (with ${r.deal.adds.join(', ')})` : ''}: ${formatMoneyRange(r.deal.fee, r.deal.feeHigh)}`}
          >{formatMoney(dealMid(r.deal))}</span>
        )
        : <span title="Nothing still open on this account can be priced" style={{ color: '#CBD5E1' }}>-</span>),
    },
    {
      key: 'dealService', label: 'Biggest Deal Service', defaultWidth: 190,
      headerTitle: 'The service that biggest deal is for, plus how many services its Auto-add cell sells with it.',
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
    {
      key: 'bfoCompanyName', label: 'BFO Company Name', defaultWidth: 200,
      headerTitle: 'The account\'s name as it appears in BFO (the company record\'s BFO Company Name), then any Other BFO Names, separated by ;.',
      getSortValue: r => bfoCompanyNamesOf(r.account).join('; ').toLowerCase() || null,
      getFilterValue: r => bfoCompanyNamesOf(r.account).join('; '), exportValue: r => bfoCompanyNamesOf(r.account).join('; '),
      render: r => bfoCompanyNamesOf(r.account).join('; ') || blank,
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 100,
      getSortValue: r => r.tier || null, getFilterValue: r => r.tier, exportValue: r => r.tier,
      render: r => r.tier || blank,
    },
    {
      key: 'vertical', label: 'Vertical', defaultWidth: 150,
      getSortValue: r => String(r.account?.vertical || '').trim().toLowerCase() || null,
      getFilterValue: r => String(r.account?.vertical || '').trim(), exportValue: r => String(r.account?.vertical || '').trim(),
      render: r => String(r.account?.vertical || '').trim() || blank,
    },
    {
      key: 'subVertical', label: 'Sub Vertical', defaultWidth: 160,
      getSortValue: r => String(r.account?.subVertical || '').trim().toLowerCase() || null,
      getFilterValue: r => String(r.account?.subVertical || '').trim(), exportValue: r => String(r.account?.subVertical || '').trim(),
      render: r => String(r.account?.subVertical || '').trim() || blank,
    },
    {
      // The company pop-up's Sites box (numberOfSites).
      key: 'sites', label: 'Sites', defaultWidth: 90,
      headerTitle: 'The account\'s site count, from the Sites box on the company pop-up.',
      getSortValue: r => sitesOf(r.account),
      getFilterValue: r => (sitesOf(r.account) == null ? '' : fmt(sitesOf(r.account))),
      exportValue: r => sitesOf(r.account) ?? '',
      render: r => (sitesOf(r.account) == null
        ? blank
        : <span style={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(sitesOf(r.account))}</span>),
    },
    {
      key: 'status', label: 'Status', defaultWidth: 130,
      getSortValue: r => r.status || null, getFilterValue: r => r.status, exportValue: r => r.status,
      render: r => r.status || blank,
    },
    {
      key: 'lastActivity', label: 'Last Activity', defaultWidth: 140,
      headerTitle: 'The newest HubSpot email or call to this contact (from the Activity tab\'s feed), or HubSpot\'s Last Contacted date.',
      getSortValue: r => r.lastMs ?? null,
      getFilterValue: r => (r.lastMs == null ? 'Never' : formatDateDisplay(toIso(r.lastMs))),
      exportValue: r => (r.lastMs == null ? 'Never' : toIso(r.lastMs)),
      render: r => (r.lastMs == null
        ? <span style={{ color: '#B91C1C', fontWeight: 600 }}>Never</span>
        : formatDateDisplay(toIso(r.lastMs))),
    },
    {
      // When the account's BFO History (company popup > BFO History tab)
      // was last pasted, or marked as having no BFO history.
      key: 'bfoHistoryUpdated', label: 'BFO History Updated', defaultWidth: 170,
      headerTitle: 'When the account\'s BFO History (company pop-up > BFO History tab) was last pasted in, or marked as having no BFO history.',
      getSortValue: r => Date.parse(r.account?.bfoHistory?.pastedAt || '') || null,
      getFilterValue: r => {
        const at = r.account?.bfoHistory?.pastedAt;
        if (!at) return markedNoBfoName(r.account) ? 'No BFO Account' : 'Never';
        return `${formatDateDisplay(toIso(Date.parse(at)))}${bfoHistoryIsNone(r.account.bfoHistory) ? ' (no BFO history)' : ''}`;
      },
      exportValue: r => {
        const at = r.account?.bfoHistory?.pastedAt;
        if (!at) return markedNoBfoName(r.account) ? 'No BFO Account' : '';
        return `${toIso(Date.parse(at))}${bfoHistoryIsNone(r.account.bfoHistory) ? ' (no BFO history)' : ''}`;
      },
      render: r => {
        const h = r.account?.bfoHistory;
        const state = bfoHistoryReviewState(h);
        // "None in BFO" ticked on the company: there is no BFO account to
        // pull a history from, so say that rather than "Never".
        if (!h?.pastedAt && markedNoBfoName(r.account)) return <span style={fillPill(BFO_FILL.none)} title='Marked "None in BFO" on the company: it has no account in BFO'>No BFO Account</span>;
        if (!h?.pastedAt) return <span style={fillPill(BFO_FILL.none)} title="No BFO History pasted yet">Never</span>;
        const none = bfoHistoryIsNone(h);
        const n = (h.rows || []).length;
        const title = state === 'none'
          ? (none ? 'Marked as having no BFO history' : 'No opportunities pasted')
          : state === 'reviewed'
            ? `All ${n} opportunit${n === 1 ? 'y' : 'ies'} marked Ignored or OK`
            : `${n} opportunit${n === 1 ? 'y' : 'ies'} pasted, some not yet marked Ignored or OK`;
        return (
          <span title={title} style={fillPill(BFO_FILL[state])}>
            {formatDateDisplay(toIso(Date.parse(h.pastedAt)))}
            {none && <span style={{ fontSize: '0.7rem', fontWeight: 400 }}> no history</span>}
          </span>
        );
      },
    },
    {
      // The saved email campaigns this person is on (Draft Emails > Email
      // Campaigns), most recently active first.
      key: 'emailCampaigns', label: 'Email Campaign', defaultWidth: 200,
      headerTitle: 'The saved email campaigns (Draft Emails > Email Campaigns) this contact has been added to, most recently active first.',
      getSortValue: r => r.campaigns.join('; ').toLowerCase() || null,
      getFilterValue: r => r.campaigns.join('; '),
      exportValue: r => r.campaigns.join('; '),
      render: r => (r.campaigns.length
        ? <span title={r.campaigns.join('\n')}>{r.campaigns.join('; ')}</span>
        : blank),
    },
    {
      key: 'daysSince', label: 'Days Since', defaultWidth: 110,
      getSortValue: r => (r.lastMs == null ? Number.MAX_SAFE_INTEGER : daysSince(r.lastMs)),
      getFilterValue: r => (r.lastMs == null ? 'Never' : String(daysSince(r.lastMs))),
      exportValue: r => (r.lastMs == null ? '' : daysSince(r.lastMs)),
      render: r => (r.lastMs == null ? blank : fmt(daysSince(r.lastMs))),
    },
    {
      key: 'email', label: 'Email', defaultWidth: 230,
      getSortValue: r => r.contact.email || null, getFilterValue: r => r.contact.email || '', exportValue: r => r.contact.email || '',
      render: r => (r.contact.email ? <a href={`mailto:${r.contact.email}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{r.contact.email}</a> : blank),
    },
    {
      key: 'phone', label: 'Phone', defaultWidth: 140,
      getSortValue: r => r.contact.phone || r.contact.mobilephone || null,
      getFilterValue: r => r.contact.phone || r.contact.mobilephone || '', exportValue: r => r.contact.phone || r.contact.mobilephone || '',
      render: r => r.contact.phone || r.contact.mobilephone || blank,
    },
    {
      key: 'linkedin', label: 'LinkedIn', defaultWidth: 100,
      getSortValue: r => linkedinOf(r.contact) || null, getFilterValue: r => (linkedinOf(r.contact) ? 'LinkedIn' : ''), exportValue: r => linkedinOf(r.contact),
      render: r => {
        const url = linkedinOf(r.contact);
        if (!url) return blank;
        return <a href={url.startsWith('http') ? url : `https://linkedin.com/in/${url}`} target="_blank" rel="noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>Profile</a>;
      },
    },
    {
      key: 'company', label: 'HubSpot Company', defaultWidth: 200,
      getSortValue: r => String(r.contact.company || '').toLowerCase() || null,
      getFilterValue: r => r.contact.company || '', exportValue: r => r.contact.company || '',
      render: r => r.contact.company || blank,
    },
  ], [onOpenContact, onSelectProspect]);
  const columns = [selectCol, ...dataColumns];
  const barBtn = (primary) => ({ padding: '0.25rem 0.7rem', border: `1px solid ${primary ? '#2563EB' : '#4F46E5'}`, background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#4F46E5', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' });

  const loading = !lists;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0, padding: '0 1.25rem 1.25rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
        Decision makers at your accounts that nothing has reached: no HubSpot email or call to them, and no Last Contacted date.
        {' '}The History chart's Decision Makers (tagged Decision Maker, less Hide, Left and the clients every roster leaves out), without the Hold Off, Lost - Not Sold, Old Client and Client accounts. A company with a Substatus counts as Hold Off.
        {noIndex && <span style={{ color: '#B45309' }}> HubSpot emails and calls count once the Activity tab has loaded its feed, so until then this list may hold people who were emailed.</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        {WINDOWS.map(w => (
          <button key={w ?? 'never'} type="button" onClick={() => setWindow(w)} style={chipStyle(windowDays === w)}>
            {windowLabel(w)}{lists ? ` (${fmt(lists.get(w).length)})` : ''}
          </button>
        ))}
        {lists && (
          <>
            <span style={{ width: 1, alignSelf: 'stretch', background: '#E2E8F0', margin: '0 0.2rem' }} />
            {DM_TOPICS.map(t => {
              const on = dmTopics.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDmTopic(t.key)}
                  title={`Show only decision makers also tagged ${t.tag} whose own ${t.tag} tag status is not Sold or Not sold${t.peOnly ? ', at companies whose Type or Vertical is Private Equity, leaving out anyone whose Private Equity tag is No' : ''}. Light several to see anyone matching any of them.`}
                  style={topicChipStyle(on)}
                >
                  {t.label} DMs
                  <span style={topicCountStyle(on)}>{fmt(topicMatches.get(t.key)?.size || 0)}</span>
                </button>
              );
            })}
          </>
        )}
      </div>
      {flash && <div style={{ fontSize: '0.78rem', color: '#15803D', fontWeight: 600 }}>{flash}</div>}
      {campaignOpen && (
        <ContactsCampaignBulkAdd
          contacts={selectedContacts}
          onClose={() => setCampaignOpen(false)}
          onAdded={() => setSelected(new Set())}
        />
      )}
      {selectedRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: '0.75rem', color: '#1E3A8A' }}>
          <strong>{selectedRows.length} selected</strong>
          <div style={{ flex: 1 }} />
          {!campaignOpen && <button type="button" onClick={() => setCampaignOpen(true)} style={barBtn(false)}>Add to Campaign</button>}
          <button type="button" onClick={() => setEditOpen(true)} style={barBtn(true)}>Bulk Edit</button>
          <button type="button" onClick={() => setSelected(new Set())} style={{ ...barBtn(false), border: '1px solid transparent', background: 'transparent', color: '#475569' }}>Clear</button>
        </div>
      )}
      {editOpen && (
        <BulkContactEditModal
          contacts={selectedContacts}
          settings={settings}
          updateSettings={updateSettings}
          onClose={() => setEditOpen(false)}
          onDone={(msg) => { setEditOpen(false); setSelected(new Set()); showFlash(msg); }}
        />
      )}
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: '#64748B' }}>Loading...</div>
      ) : (
        <div style={{ height: '70vh', display: 'flex', flexDirection: 'column', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <DataTable
            tableId="prospecting-dms-no-activity"
            exportFileName="Decision Makers Without Activity"
            columns={columns}
            rows={rows}
            alwaysVisible={['__select__', 'name']}
            onFilteredRowsChange={onFilteredRowsChange}
            // Biggest deals first; rows with no priced deal sort to the end.
            defaultSort={{ key: 'deal', direction: 'desc' }}
            defaultHidden={['company', 'status']}
            emptyMessage={dmTopics.length && windowEntries.length ? 'No decision makers here match the lit DM buttons.' : windowDays == null ? 'Every decision maker at your accounts has had some activity.' : `Every decision maker at your accounts has had activity in the last ${windowDays} days.`}
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
      )}
    </div>
  );
}
