// Prospecting > Tiered Activity: every Tier 1, 2 and 3 account with you as
// its CDM, when anything last happened on it, and its Status (settable from
// the row). Statuses ticked in the Hide statuses menu are left off the list;
// the choice is saved in settings so it applies on every visit. A company
// with a Substatus counts as Hold Off here, whatever its Status says.
// Where the activity date comes from is utils/tieredAccountActivity.js; this
// file loads the HubSpot contacts and outreach index and lays them out.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUSES, STATUS_COLORS, TIERS } from '../../data/enums.js';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { userLsGet } from '../../utils/userLs';
import { formatDateDisplay } from '../../utils/isoDate';
import { useAuth } from '../../contexts/AuthContext';
import { hubspotContactUrl, loadHubspotAccount } from '../../utils/hubspotRecordLink';
import {
  ACTIVITY_COLD_DAYS, ACTIVITY_SUMMARY_DAYS, ACTIVITY_WARM_DAYS, daysSince, lastActivityByAccount, myTieredAccounts,
  tierActivityCoverage,
} from '../../utils/tieredAccountActivity';

// The same tier tints the Prospects subtab and the ladder's DM mapping use.
const TIER_TINTS = {
  'Tier 1': { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  'Tier 2': { bg: '#F5F3FF', border: '#DDD6FE', ink: '#6D28D9' },
  'Tier 3': { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' },
};

function readOutreachIndex() {
  try { return JSON.parse(userLsGet('hubspot-outreach-index') || 'null'); } catch { return null; }
}

function ageColors(days) {
  if (days == null || days > ACTIVITY_COLD_DAYS) return { color: '#991B1B', background: '#FEE2E2' };
  if (days > ACTIVITY_WARM_DAYS) return { color: '#92400E', background: '#FEF3C7' };
  return { color: '#166534', background: '#DCFCE7' };
}

// Where the Hide statuses choice is saved.
const HIDDEN_STATUSES_KEY = 'prospectingTieredHiddenStatuses';
// The same choice cached in this browser, so a refresh shows it before the
// settings document has loaded (and still has it if a save never landed).
// Settings win once they arrive: they are what other devices see.
const HIDDEN_STATUSES_CACHE = 'prospecting-tiered-hidden-statuses';
function readHiddenCache() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_STATUSES_CACHE));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
// A company with a Substatus is on hold, whatever its Status says: the
// substatus is the reason it's parked. On this page it reads, filters and
// counts as Hold Off. Only the reading changes; the record's Status is left
// as it is.
const SUBSTATUS_HOLD_STATUS = 'Hold Off';
const substatusOf = (p) => String(p?.substatus || '').trim();
const statusOf = (p) => (substatusOf(p) ? SUBSTATUS_HOLD_STATUS : String(p?.status || '').trim());
const statusLabel = (st) => st || 'No status';

const toLocalDate = (tsMs) => {
  const d = new Date(tsMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ProspectingTiered({ prospects, settings, updateSettings = null, updateProspect = null, cdmName = '', onSelectProspect, maxWidth }) {
  const { user } = useAuth() || {};
  const uid = user?.uid || '';

  // HubSpot contacts, re-read when a sync lands.
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [uid]);

  // The email/call index the Activity tab writes, re-read when it rewrites it.
  const [outreachIndex, setOutreachIndex] = useState(readOutreachIndex);
  useEffect(() => {
    const reload = () => setOutreachIndex(readOutreachIndex());
    const onStorage = (e) => { if (e.key && e.key.endsWith(':hubspot-outreach-index')) reload(); };
    reload();
    window.addEventListener('hubspot-activity-cache-updated', reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, [uid]);

  // The HubSpot portal, so a contact name links to its record.
  const [hubspotAccount, setHubspotAccount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadHubspotAccount().then(a => { if (!cancelled) setHubspotAccount(a); });
    return () => { cancelled = true; };
  }, []);

  const accounts = useMemo(() => myTieredAccounts(prospects, cdmName), [prospects, cdmName]);
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const activity = useMemo(
    () => (contacts ? lastActivityByAccount({ accounts, contacts, outreachIndex, localFields, links, exclusions }) : null),
    [accounts, contacts, outreachIndex, localFields, links, exclusions],
  );

  // Statuses to leave off the list, '' standing for "no status". Saved to
  // settings so the choice sticks across visits and devices; this visit's
  // own pick is held locally too, so the list answers the click at once and
  // a page with no updateSettings still filters.
  const savedHidden = settings?.[HIDDEN_STATUSES_KEY];
  const [localHidden, setHiddenLocal] = useState(null);
  const [cachedHidden] = useState(readHiddenCache);
  const hiddenStatuses = useMemo(
    () => localHidden ?? (Array.isArray(savedHidden) ? savedHidden : (cachedHidden || [])),
    [localHidden, savedHidden, cachedHidden],
  );
  // Keep the cache in step with whatever is showing, including a choice
  // that arrived from another device.
  useEffect(() => {
    if (localHidden == null && !Array.isArray(savedHidden)) return;
    try { localStorage.setItem(HIDDEN_STATUSES_CACHE, JSON.stringify(hiddenStatuses)); } catch { /* noop */ }
  }, [hiddenStatuses, localHidden, savedHidden]);
  const setHiddenStatuses = (next) => {
    setHiddenLocal(next);
    if (typeof updateSettings === 'function') updateSettings({ [HIDDEN_STATUSES_KEY]: next });
  };
  const hiddenSet = useMemo(() => new Set(hiddenStatuses), [hiddenStatuses]);
  // Every status the menu offers, with how many tiered accounts carry it:
  // the standard list, plus any other value an account actually has.
  const statusOptions = useMemo(() => {
    const counts = new Map();
    for (const p of accounts) {
      const st = statusOf(p);
      counts.set(st, (counts.get(st) || 0) + 1);
    }
    const extra = [...counts.keys()].filter(st => st && !STATUSES.includes(st)).sort();
    return [...STATUSES, ...extra, ''].map(st => ({ status: st, count: counts.get(st) || 0 }));
  }, [accounts]);
  const shown = useMemo(() => accounts.filter(p => !hiddenSet.has(statusOf(p))), [accounts, hiddenSet]);
  const hiddenCount = accounts.length - shown.length;

  const [query, setQuery] = useState('');
  // Read once per visit: the day count only needs to be right to the day.
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shown
      .filter(p => !q || String(p.company).toLowerCase().includes(q))
      .map(p => {
        const a = activity ? (activity.get(p.id || p.company) || null) : undefined;
        return {
          id: p.id || p.company,
          company: String(p.company).trim(),
          tier: String(p.tier).trim(),
          status: statusOf(p),
          // Set when the row reads Hold Off because of its Substatus.
          substatus: substatusOf(p),
          prospect: p,
          activity: a,
          days: a ? daysSince(a.tsMs, now) : null,
        };
      });
  }, [shown, activity, query, now]);

  const canSetStatus = typeof updateProspect === 'function';
  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 240,
      getSortValue: r => r.company.toLowerCase(),
      getFilterValue: r => r.company,
      exportValue: r => r.company,
      render: r => (onSelectProspect ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelectProspect(r.prospect); }}
          title={`Open ${r.company}`}
          style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#0A66C2', cursor: 'pointer', textAlign: 'left' }}
        >{r.company}</button>
      ) : <span style={{ fontWeight: 600 }}>{r.company}</span>),
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 90,
      getSortValue: r => TIERS.indexOf(r.tier),
      getFilterValue: r => r.tier,
      exportValue: r => r.tier,
      render: (r) => {
        const tint = TIER_TINTS[r.tier];
        return <span style={{ fontSize: '0.68rem', fontWeight: 700, color: tint.ink, background: tint.bg, border: `1px solid ${tint.border}`, padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.tier}</span>;
      },
    },
    {
      key: 'status', label: 'Status', defaultWidth: 170,
      headerTitle: 'The account Status, as set on the company card. Pick one here to change it there. Picking a status you hide takes the row off the list. A company with a Substatus counts as Hold Off.',
      getSortValue: r => (r.status ? r.status.toLowerCase() : null),
      getFilterValue: r => [r.status, r.substatus].filter(Boolean).join(' '),
      exportValue: r => (r.substatus ? `${r.status} (${r.substatus})` : r.status || ''),
      render: (r) => {
        const color = STATUS_COLORS[r.status] || '#64748B';
        // On hold through its Substatus: a pick in a Status dropdown here
        // wouldn't take it off hold, so the cell says why instead.
        if (r.substatus) {
          const actual = String(r.prospect?.status || '').trim();
          return (
            <span
              title={`Counts as ${SUBSTATUS_HOLD_STATUS} because its Substatus is "${r.substatus}"${actual && actual !== SUBSTATUS_HOLD_STATUS ? ` (its Status is ${actual})` : ''}. Clear the Substatus on the company card to take it off hold.`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, maxWidth: '100%' }}
            >
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color, background: `${color}1A`, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.status}</span>
              <span style={{ fontSize: '0.66rem', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.substatus}</span>
            </span>
          );
        }
        if (!canSetStatus) {
          if (!r.status) return <span style={{ color: '#CBD5E1' }}>-</span>;
          return <span style={{ fontSize: '0.68rem', fontWeight: 700, color, background: `${color}1A`, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.status}</span>;
        }
        // A status the list doesn't know (typed elsewhere) is kept as an
        // option so the select shows what the record actually says.
        const options = r.status && !STATUSES.includes(r.status) ? [r.status, ...STATUSES] : STATUSES;
        return (
          <select
            value={r.status}
            onClick={e => e.stopPropagation()}
            onChange={e => updateProspect(r.prospect.id, { status: e.target.value })}
            aria-label={`Status for ${r.company}`}
            style={{
              fontSize: '0.72rem', fontFamily: 'inherit', fontWeight: 600, padding: '1px 4px', borderRadius: 4,
              border: `1px solid ${r.status ? `${color}55` : '#CBD5E1'}`,
              background: r.status ? `${color}1A` : '#fff', color: r.status ? color : '#94A3B8', maxWidth: '100%',
            }}
          >
            <option value="">-</option>
            {options.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        );
      },
    },
    {
      key: 'lastActivity', label: 'Last Activity', defaultWidth: 120,
      headerTitle: 'The newest of: HubSpot emails and calls with a contact at the account, and HubSpot Last Contacted on those contacts. BFO activity is not counted.',
      getSortValue: r => r.activity?.tsMs ?? null,
      getFilterValue: r => (r.activity ? formatDateDisplay(toLocalDate(r.activity.tsMs)) : 'None'),
      exportValue: r => (r.activity ? toLocalDate(r.activity.tsMs) : ''),
      render: (r) => {
        if (r.activity === undefined) return <span style={{ color: '#94A3B8' }}>Loading…</span>;
        if (!r.activity) return <span style={{ color: '#CBD5E1' }} title="No HubSpot email, call or contact found with anyone at this account">None</span>;
        return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDateDisplay(toLocalDate(r.activity.tsMs))}</span>;
      },
    },
    {
      key: 'days', label: 'Days Since', defaultWidth: 100,
      headerTitle: `Green within ${ACTIVITY_WARM_DAYS} days, amber within ${ACTIVITY_COLD_DAYS}, red after that or when nothing is found.`,
      // No activity sorts as the oldest.
      getSortValue: r => (r.activity === undefined ? null : (r.days ?? Number.MAX_SAFE_INTEGER)),
      getFilterValue: r => (r.days == null ? '' : String(r.days)),
      exportValue: r => (r.days == null ? '' : r.days),
      render: (r) => {
        if (r.activity === undefined) return null;
        const c = ageColors(r.days);
        return (
          <span style={{ ...c, fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {r.days == null ? 'Never' : r.days === 0 ? 'Today' : `${r.days}d`}
          </span>
        );
      },
    },
    {
      key: 'source', label: 'Activity', defaultWidth: 240,
      headerTitle: 'Where the last activity came from, and who it was with.',
      getSortValue: r => (r.activity ? r.activity.source.toLowerCase() : null),
      getFilterValue: r => (r.activity ? `${r.activity.source} ${r.activity.detail || ''}` : ''),
      exportValue: r => (r.activity ? [r.activity.source, r.activity.detail].filter(Boolean).join(': ') : ''),
      render: (r) => {
        if (!r.activity) return <span style={{ color: '#CBD5E1' }}>-</span>;
        return (
          <span style={{ color: '#475569' }} title={[r.activity.source, r.activity.detail].filter(Boolean).join(': ')}>
            {r.activity.source}{r.activity.detail ? <span style={{ color: '#94A3B8' }}> ({r.activity.detail})</span> : null}
          </span>
        );
      },
    },
    {
      key: 'contact', label: 'Contact', defaultWidth: 200,
      headerTitle: 'The contact at the account you most recently emailed, called or contacted in HubSpot. Hover for how and when.',
      getSortValue: r => (r.activity?.contact ? r.activity.contact.name.toLowerCase() : null),
      getFilterValue: r => (r.activity?.contact ? `${r.activity.contact.name} ${r.activity.contact.email}` : ''),
      exportValue: r => r.activity?.contact?.name || '',
      render: (r) => {
        const c = r.activity?.contact;
        if (!c) return <span style={{ color: '#CBD5E1' }} title={r.activity === undefined ? undefined : 'No HubSpot email, call or contact found with anyone at this account'}>-</span>;
        const how = [
          `${c.source.replace(/^HubSpot /, '')} ${formatDateDisplay(toLocalDate(c.tsMs))}`,
          c.email,
        ].filter(Boolean).join('\n');
        const url = hubspotContactUrl(hubspotAccount, c.id);
        if (!url) return <span style={{ color: '#334155' }} title={how}>{c.name}</span>;
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${how}\nOpen in HubSpot`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#2563EB', textDecoration: 'underline' }}
          >{c.name}</a>
        );
      },
    },
    {
      key: 'owner', label: 'Owner', defaultWidth: 170,
      headerTitle: "Filled in when the contact is at the account's PE owner / parent company (its PE Owner field) rather than at the account itself, so the activity is tied to this account through its owner. Blank when the contact is at the account.",
      getSortValue: r => (r.activity?.contact ? (r.activity.contact.owner || '').toLowerCase() || null : null),
      getFilterValue: r => r.activity?.contact?.owner || '',
      exportValue: r => r.activity?.contact?.owner || '',
      render: (r) => {
        const c = r.activity?.contact;
        if (!c) return null;
        if (!c.owner) {
          return <span style={{ color: '#CBD5E1' }} title={`${c.name} is at ${c.company || r.company}, the account itself`}>-</span>;
        }
        return (
          <span
            title={`${c.name} is at ${c.company}, the PE owner / parent of ${r.company}. The activity is tied to ${r.company} through its owner.`}
            style={{ fontSize: '0.68rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', padding: '0 7px', borderRadius: 999, whiteSpace: 'nowrap' }}
          >{c.owner}</span>
        );
      },
    },
  ], [canSetStatus, updateProspect, onSelectProspect, hubspotAccount]);

  const counts = useMemo(() => {
    const c = { total: rows.length, warm: 0, cooling: 0, cold: 0 };
    for (const r of rows) {
      if (r.activity === undefined) continue;
      if (r.days == null || r.days > ACTIVITY_COLD_DAYS) c.cold += 1;
      else if (r.days > ACTIVITY_WARM_DAYS) c.cooling += 1;
      else c.warm += 1;
    }
    return c;
  }, [rows]);

  const noIndex = !outreachIndex?.emails && !outreachIndex?.phones;

  // The tiles above the table: per tier, the share of accounts with any
  // activity in the last 60 days. Over the accounts the status filter
  // keeps, not the search box, which is for finding a row rather than
  // choosing what counts.
  const coverage = useMemo(
    () => (activity ? tierActivityCoverage(shown, activity, { nowMs: now }) : null),
    [shown, activity, now],
  );

  // A tile opens a list of that tier's accounts with nothing in the window:
  // the ones the percentage is short by. Never-touched accounts first, then
  // the longest since.
  const [unreachedTier, setUnreachedTier] = useState(null);
  const unreached = useMemo(() => {
    if (!unreachedTier || !activity) return [];
    return shown
      .filter(p => String(p.tier || '').trim() === unreachedTier)
      .map((p) => {
        const a = activity.get(p.id || p.company) || null;
        return { p, a, days: a ? daysSince(a.tsMs, now) : null };
      })
      .filter(r => r.days == null || r.days > ACTIVITY_SUMMARY_DAYS)
      .sort((x, y) => (y.days ?? Number.MAX_SAFE_INTEGER) - (x.days ?? Number.MAX_SAFE_INTEGER)
        || String(x.p.company).localeCompare(String(y.p.company)));
  }, [unreachedTier, shown, activity, now]);
  useEffect(() => {
    if (!unreachedTier) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setUnreachedTier(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unreachedTier]);

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 320px' }}>
          Every Tier 1, 2 and 3 account with {cdmName || 'you'} as its CDM. Last Activity is the newest HubSpot email or call with a contact at the account, or HubSpot Last Contacted on those contacts. BFO activity is not counted. Owner shows when that contact is at the account's PE owner / parent rather than the account itself.
          {noIndex ? ' HubSpot emails and calls show once the Activity tab has loaded its feed.' : ''}
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search companies"
          style={{ padding: '0.35rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit', width: 240 }}
        />
        <details style={{ position: 'relative' }}>
          <summary
            title="Leave accounts with these Statuses off the list. Your choice is saved."
            style={{
              listStyle: 'none', cursor: 'pointer', padding: '0.35rem 0.6rem', borderRadius: 6, fontSize: '0.76rem', fontWeight: 600,
              border: `1px solid ${hiddenStatuses.length ? '#F59E0B' : '#CBD5E1'}`,
              background: hiddenStatuses.length ? '#FFFBEB' : '#fff',
              color: hiddenStatuses.length ? '#92400E' : '#475569',
              whiteSpace: 'nowrap',
            }}
          >
            {hiddenStatuses.length ? `Hiding ${hiddenStatuses.length} status${hiddenStatuses.length === 1 ? '' : 'es'} (${hiddenCount.toLocaleString()})` : 'Hide statuses'} ▾
          </summary>
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 1000, minWidth: 240, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', padding: '0.4rem 0' }}>
            <div style={{ padding: '0.2rem 0.75rem 0.4rem', fontSize: '0.66rem', color: '#64748B' }}>Tick a status to hide its accounts</div>
            {statusOptions.map(({ status: st, count }) => {
              const on = hiddenSet.has(st);
              return (
                <label key={st || '(none)'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0.75rem', fontSize: '0.74rem', color: '#334155', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`Hide ${statusLabel(st)}`}
                    onChange={() => setHiddenStatuses(on ? hiddenStatuses.filter(x => x !== st) : [...hiddenStatuses, st])}
                  />
                  <span style={{ flex: 1, fontStyle: st ? 'normal' : 'italic' }}>{statusLabel(st)}</span>
                  <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString()}</span>
                </label>
              );
            })}
            {hiddenStatuses.length > 0 && (
              <button
                type="button"
                onClick={() => setHiddenStatuses([])}
                style={{ margin: '0.3rem 0.75rem 0', border: 'none', background: 'none', padding: 0, fontSize: '0.7rem', color: '#0A66C2', cursor: 'pointer' }}
              >Show all statuses</button>
            )}
          </div>
        </details>
      </div>
      {accounts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.6rem' }}>
          {(coverage || TIERS.map(tier => ({ tier, total: null }))).map(({ tier, total, active, pct }) => {
            const tint = TIER_TINTS[tier] || {};
            const tone = pct == null ? '#64748B' : pct >= 75 ? '#166534' : pct >= 50 ? '#92400E' : '#991B1B';
            return (
              <button
                type="button"
                key={tier}
                disabled={total == null}
                onClick={() => setUnreachedTier(tier)}
                title={total == null ? undefined : `${active} of ${total} ${tier} account${total === 1 ? '' : 's'} had a HubSpot email, call or contact in the last ${ACTIVITY_SUMMARY_DAYS} days. Click to see the ${total - active} that haven't.`}
                style={{ flex: '1 1 180px', maxWidth: 260, border: '1px solid #E2E8F0', borderLeft: `4px solid ${tint.ink || '#94A3B8'}`, borderRadius: 8, padding: '0.45rem 0.75rem', background: '#fff', textAlign: 'left', font: 'inherit', cursor: total == null ? 'default' : 'pointer' }}
              >
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {tier}: active in {ACTIVITY_SUMMARY_DAYS} days
                </div>
                {total == null ? (
                  <div style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: 2 }}>Loading...</div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: '1.3rem', fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>{pct == null ? '-' : `${pct}%`}</span>
                    <span style={{ fontSize: '0.74rem', color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{active} of {total}</span>
                    {total - active > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#0A66C2', whiteSpace: 'nowrap' }}>{total - active} not reached ›</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
      {unreachedTier && createPortal(
        <div
          onClick={() => setUnreachedTier(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${unreachedTier} accounts not reached in ${ACTIVITY_SUMMARY_DAYS} days`}
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 50px rgba(15,23,42,0.25)', width: 'min(640px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0.85rem 1rem 0.6rem', borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>{unreachedTier}: not reached in {ACTIVITY_SUMMARY_DAYS} days</div>
                <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
                  {unreached.length} {unreached.length === 1 ? 'account has' : 'accounts have'} had no HubSpot email, call or contact in the last {ACTIVITY_SUMMARY_DAYS} days. Accounts with a hidden status are left out.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnreachedTier(null)}
                aria-label="Close"
                style={{ border: 'none', background: 'none', fontSize: '1.2rem', lineHeight: 1, color: '#94A3B8', cursor: 'pointer', padding: 0 }}
              >&times;</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '0.25rem 0' }}>
              {unreached.length === 0 ? (
                <div style={{ padding: '1rem', fontSize: '0.78rem', color: '#64748B' }}>Every {unreachedTier} account was reached in the last {ACTIVITY_SUMMARY_DAYS} days.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr style={{ color: '#64748B', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.03em', textAlign: 'left' }}>
                      <th style={{ padding: '0.35rem 1rem', fontWeight: 700 }}>Company</th>
                      <th style={{ padding: '0.35rem 0.5rem', fontWeight: 700 }}>Status</th>
                      <th style={{ padding: '0.35rem 0.5rem', fontWeight: 700 }}>Last Activity</th>
                      <th style={{ padding: '0.35rem 1rem 0.35rem 0.5rem', fontWeight: 700, textAlign: 'right' }}>Days Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unreached.map(({ p, a, days }) => {
                      const c = ageColors(days);
                      return (
                        <tr key={p.id || p.company} style={{ borderTop: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '0.35rem 1rem' }}>
                            {onSelectProspect ? (
                              <button
                                type="button"
                                onClick={() => { setUnreachedTier(null); onSelectProspect(p); }}
                                title={`Open ${p.company}`}
                                style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: '#0A66C2', cursor: 'pointer', textAlign: 'left' }}
                              >{p.company}</button>
                            ) : <span style={{ fontWeight: 600 }}>{p.company}</span>}
                          </td>
                          <td style={{ padding: '0.35rem 0.5rem', color: '#475569' }}>{statusOf(p) || '-'}</td>
                          <td style={{ padding: '0.35rem 0.5rem', color: a ? '#334155' : '#CBD5E1', fontVariantNumeric: 'tabular-nums' }}>
                            {a ? formatDateDisplay(toLocalDate(a.tsMs)) : 'None'}
                          </td>
                          <td style={{ padding: '0.35rem 1rem 0.35rem 0.5rem', textAlign: 'right' }}>
                            <span style={{ ...c, fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {days == null ? 'Never' : `${days}d`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {accounts.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          No accounts with {cdmName || 'you'} as their CDM carry a Tier yet. Set one on the company card.
        </div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 300px)', minHeight: 320 }}>
          <DataTable
            tableId="prospecting-tiered"
            exportFileName="Prospecting Tiered Accounts"
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'days', direction: 'desc' }}
            fitWidth
            alwaysVisible={['company']}
            enableColumnFilters
            emptyMessage={hiddenCount > 0 && shown.length === 0 ? 'Every tiered account has a hidden status' : 'No accounts match these filters'}
            settings={settings}
            updateSettings={updateSettings}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem', padding: '0.5rem 0.75rem', fontSize: '0.76rem', color: '#64748B', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}>
            <span style={{ fontWeight: 700, color: '#1E293B' }}>{counts.total.toLocaleString()} {counts.total === 1 ? 'account' : 'accounts'}</span>
            <span>Within {ACTIVITY_WARM_DAYS} days <b style={{ color: '#166534' }}>{counts.warm}</b></span>
            <span>{ACTIVITY_WARM_DAYS + 1}-{ACTIVITY_COLD_DAYS} days <b style={{ color: '#92400E' }}>{counts.cooling}</b></span>
            <span>Over {ACTIVITY_COLD_DAYS} days or none <b style={{ color: '#991B1B' }}>{counts.cold}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
