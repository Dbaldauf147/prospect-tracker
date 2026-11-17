// Draft Emails > Recent Sends: how much campaign email the Clients, Key
// Contacts and Prospects groups have had from Dan in the last three weeks.
//
// The same reading as the "N recipients were emailed by another campaign in
// the last 3 weeks" box under To on the Drafts tab, run over a whole group
// instead of one draft's recipients: one row per person who was emailed,
// tinted by how many campaigns reached them (1 green, 2 yellow, 3+ red),
// most-emailed first. Above it, per group, how many people heard from 0, 1,
// 2 and 3+ campaigns, so it's plain which group is being worn out and which
// has gone quiet. The rules live in utils/recentSends.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { useEmailCampaigns } from '../../hooks/useEmailCampaigns';
import { useAuth } from '../../contexts/AuthContext';
import { useOppsRecords, useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { makeRosterGates } from '../../utils/contactRosters';
import { companyPopupTarget } from '../../utils/companyLookup';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { RECENT_CAMPAIGN_DAYS } from '../../utils/recentCampaignWarning';
import { recentSendsByGroup, sendTone, threePlusClearDates, belowThreeAt, RECENT_SENDS_GROUPS } from '../../utils/recentSends';

const GROUPS_KEY = 'recent-sends-groups';

const TONES = {
  green: { background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' },
  yellow: { background: '#FEF9C3', color: '#854D0E', border: '1px solid #FDE047' },
  red: { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' },
};

const GROUP_TIPS = {
  client: 'Contacts at your current Clients (the Clients roster on Contacts)',
  key: 'Contacts tagged Dan Key Target (the Key Contacts roster)',
  prospect: 'Decision Makers at your Tier 1-3 prospects (DM at Tier 1-3 on Contacts), less anybody on Key Contacts or at a client',
};

const shortDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// Name | Company | Campaigns | Groups, one grid for the header and every row
// so the columns line up.
const ROW_GRID = { display: 'grid', gridTemplateColumns: '170px 200px minmax(0, 1fr) auto', columnGap: 10, alignItems: 'baseline' };

function readGroups() {
  try {
    const saved = JSON.parse(userLsGet(GROUPS_KEY) || 'null');
    if (Array.isArray(saved)) return saved.filter(k => RECENT_SENDS_GROUPS.some(g => g.key === k));
  } catch { /* fall through to every group */ }
  return RECENT_SENDS_GROUPS.map(g => g.key);
}

export function RecentSendsView({ prospects = [], cdmName = '', settings, updateSettings, onSelectProspect }) {
  const { user } = useAuth() || {};
  const campaigns = useEmailCampaigns();
  const oppsRecords = useOppsRecords(user?.uid);
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache().then(c => { if (!cancelled) setContacts(c?.contacts || []); }).catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [user?.uid]);

  const [groupKeys, setGroupKeys] = useState(readGroups);
  const toggleGroup = (key) => setGroupKeys(prev => {
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
    const ordered = RECENT_SENDS_GROUPS.map(g => g.key).filter(k => next.includes(k));
    userLsSet(GROUPS_KEY, JSON.stringify(ordered));
    return ordered;
  });

  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap],
  );
  // Every group's counts, whichever are picked, so an unlit pill still says
  // how big its group is.
  const allCounts = useMemo(
    () => recentSendsByGroup({ contacts, gates, groupKeys: RECENT_SENDS_GROUPS.map(g => g.key), campaigns }).counts,
    [contacts, gates, campaigns],
  );
  const localFields = settings?.contactLocalFields || null;
  const { rows } = useMemo(
    () => recentSendsByGroup({ contacts, gates, groupKeys, campaigns, localFields }),
    [contacts, gates, groupKeys, campaigns, localFields],
  );
  // If nothing more goes out, when most of the people listed stop being at
  // 3+ (and when the last of them does). Over the whole list, not the search.
  const clear = useMemo(() => threePlusClearDates(rows), [rows]);

  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => `${r.name} ${r.email} ${r.company} ${r.campaigns.map(c => c.label).join(' ')}`.toLowerCase().includes(q));
  }, [rows, query]);
  const queuedPeople = rows.filter(r => r.pending > 0).length;
  const tones = { red: 0, yellow: 0, green: 0 };
  for (const r of rows) tones[sendTone(r.campaigns.length)] += 1;

  const [editingContact, setEditingContact] = useState(null);
  const contactEditSettings = useContactEditSettings({ settings, updateSettings });
  // The popup's company link hands back a company name, as on Client Campaigns.
  const openCompanyFromContact = (name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingContact(null);
    onSelectProspect(target);
  };
  const weeks = RECENT_CAMPAIGN_DAYS / 7;

  return (
    <div data-recent-sends style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 1400 }}>
      <div style={{ fontSize: '0.78rem', color: '#475569' }}>
        How many of your campaigns each group has received in the last {weeks} weeks, counted the same way as the warning under To on the Drafts tab, plus any Active campaign they are on that hasn't been sent to them yet (marked not sent yet), which counts toward their total. Click a name to open the contact.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {RECENT_SENDS_GROUPS.map(g => {
          const on = groupKeys.includes(g.key);
          const k = allCounts[g.key] || { total: 0, none: 0, one: 0, two: 0, three: 0 };
          const emailed = k.total - k.none;
          return (
            <button
              key={g.key}
              type="button"
              data-recent-sends-group={g.key}
              aria-pressed={on}
              onClick={() => toggleGroup(g.key)}
              title={`${GROUP_TIPS[g.key]}. Click to ${on ? 'leave them out of' : 'add them to'} the list below.`}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
                minWidth: 220, padding: '0.45rem 0.7rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                border: `1px solid ${on ? '#1D4ED8' : '#CBD5E1'}`,
                background: on ? '#EFF6FF' : '#fff',
                boxShadow: on ? '0 0 0 2px #BFDBFE' : 'none',
                opacity: on ? 1 : 0.7,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, color: on ? '#1D4ED8' : '#334155' }}>
                <input type="checkbox" readOnly checked={on} tabIndex={-1} style={{ margin: 0, pointerEvents: 'none' }} />
                {g.label}
                <span style={{ fontWeight: 500, color: '#64748B' }}>{k.total} people</span>
              </span>
              <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                <strong>{emailed}</strong> emailed or queued{k.total ? ` (${Math.round((emailed / k.total) * 100)}%)` : ''}, <strong>{k.none}</strong> not
              </span>
              <span style={{ display: 'flex', gap: 4, fontSize: '0.66rem', fontWeight: 700 }}>
                <span style={{ ...TONES.green, borderRadius: 999, padding: '0 6px' }} title="Reached by 1 campaign">1: {k.one}</span>
                <span style={{ ...TONES.yellow, borderRadius: 999, padding: '0 6px' }} title="Reached by 2 campaigns">2: {k.two}</span>
                <span style={{ ...TONES.red, borderRadius: 999, padding: '0 6px' }} title="Reached by 3 or more campaigns">3+: {k.three}</span>
              </span>
            </button>
          );
        })}
      </div>

      {groupKeys.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Pick a group above to see who was emailed.</div>
      ) : (
        <div
          style={{ padding: '0.5rem 0.7rem', border: '1px solid #FCD34D', background: '#FFFBEB', borderRadius: 6, fontSize: '0.74rem', color: '#92400E', lineHeight: 1.45 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <span data-recent-sends-title style={{ fontWeight: 700 }}>
              {rows.length === 1 ? '1 person was' : `${rows.length} people were`} emailed by your campaigns in the last {weeks} weeks{queuedPeople > 0 ? ' or are queued on one' : ''}
              {rows.length > 0 && <span style={{ fontWeight: 500 }}> ({tones.red} at 3+, {tones.yellow} at 2, {tones.green} at 1{queuedPeople > 0 ? `; ${queuedPeople} with a campaign not sent yet` : ''})</span>}
            </span>
            {rows.length > 0 && (
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, company, email or campaign"
                style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '2px 6px', border: '1px solid #FCD34D', borderRadius: 4, minWidth: 220, fontFamily: 'inherit' }}
              />
            )}
          </div>
          {clear.threePlus > 0 && (
            <div
              data-recent-sends-clear
              title={`Assumes no more campaigns go out beyond the ones already queued, and that those go out today. A campaign stops counting for someone ${weeks} weeks after its last send to them, so a person drops below 3 when their third-newest campaign ages out.`}
              style={{ margin: '2px 0 4px', padding: '4px 8px', borderRadius: 4, background: '#fff', border: '1px solid #FCD34D', color: '#334155' }}
            >
              {clear.majorityAt
                ? <>Most of these {clear.total} people will be below 3 campaigns by <strong>{longDate(clear.majorityAt)}</strong></>
                : <>Most of these {clear.total} people are already below 3 campaigns</>}
              {' '}if nothing more is sent{queuedPeople > 0 ? ' (queued campaigns counted as going out today)' : ''}
              {clear.majorityAt && longDate(clear.majorityAt) === longDate(clear.allClearAt)
                ? ', and so will everyone.'
                : <>; everyone will be by <strong>{longDate(clear.allClearAt)}</strong>.</>}
            </div>
          )}
          {rows.length === 0 && <div style={{ color: '#64748B' }}>Nobody in these groups was emailed by a campaign in the last {weeks} weeks or is queued on one.</div>}
          {rows.length > 0 && (
            <div style={{ ...ROW_GRID, padding: '0 6px', marginTop: 4, fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#B45309' }}>
              <span>Name</span><span>Company</span><span>Campaigns (last send)</span><span>Groups</span>
            </div>
          )}
          {shown.map(r => {
            const dropAt = belowThreeAt(r);
            return (
              <div
                key={r.email}
                data-recent-sends-row
                data-tone={sendTone(r.campaigns.length)}
                style={{ ...TONES[sendTone(r.campaigns.length)], ...ROW_GRID, borderRadius: 4, padding: '1px 6px', marginTop: 2 }}
              >
                <button
                  type="button"
                  onClick={() => setEditingContact(r.contact)}
                  title={`Open ${r.name} (${r.email})`}
                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: 'inherit', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'rgba(0,0,0,0.2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >{r.name}</button>
                <span data-recent-sends-company title={r.company} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.company ? 'inherit' : '#94A3B8' }}>{r.company || '-'}</span>
                <span title={dropAt ? `Below 3 campaigns from ${longDate(dropAt)} if nothing more is sent` : undefined}>
                  {r.campaigns.map((c, i) => (
                    <span key={`${c.label}-${i}`}>
                      {i > 0 ? '; ' : ''}
                      {c.pending
                        ? <span data-recent-sends-pending title={`${r.name} is on ${c.label}, which hasn't been sent to them yet. It counts toward their total.`} style={{ fontStyle: 'italic', borderBottom: '1px dashed currentColor' }}>{c.label} (not sent yet)</span>
                        : `${c.label}${c.lastSentDate ? ` (${shortDate(c.lastSentDate)})` : ''}`}
                    </span>
                  ))}
                </span>
                <span style={{ fontSize: '0.64rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {r.groups.join(', ')}{r.emails > 0 && r.emails !== r.campaigns.length - r.pending ? ` · ${r.emails} emails` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {editingContact && createPortal(
        <ContactEditModal
          prospects={prospects}
          contact={editingContact}
          onSave={(_updated, opts) => { if (!opts?.silent) setEditingContact(null); }}
          onClose={() => setEditingContact(null)}
          onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
          {...contactEditSettings}
          allContacts={contacts}
        />,
        document.body,
      )}
    </div>
  );
}
