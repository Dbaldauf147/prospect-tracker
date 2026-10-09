// Prospecting > Tiered: every Tier 1, 2 and 3 account with you as its CDM,
// when anything last happened on it, and its Status (settable from the row).
// Where the activity date comes from is utils/tieredAccountActivity.js; this
// file loads the three sources and lays them out.

import { useEffect, useMemo, useState } from 'react';
import { STATUSES, STATUS_COLORS, TIERS } from '../../data/enums.js';
import { DataTable } from '../common/DataTable';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { userLsGet } from '../../utils/userLs';
import { loadBfoActivity, BFO_ACTIVITY_EVENT } from '../../utils/bfoActivityStore';
import { formatDateDisplay } from '../../utils/isoDate';
import { useAuth } from '../../contexts/AuthContext';
import {
  ACTIVITY_COLD_DAYS, ACTIVITY_WARM_DAYS, daysSince, lastActivityByAccount, myTieredAccounts,
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

  // The BFO Activity tab's pasted rows.
  const [bfoActivity, setBfoActivity] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { loadBfoActivity().then(d => { if (!cancelled) setBfoActivity(d); }); };
    refresh();
    window.addEventListener(BFO_ACTIVITY_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(BFO_ACTIVITY_EVENT, refresh); };
  }, [uid]);

  const accounts = useMemo(() => myTieredAccounts(prospects, cdmName), [prospects, cdmName]);
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const activity = useMemo(
    () => (contacts ? lastActivityByAccount({ accounts, contacts, outreachIndex, bfoActivity, localFields, links, exclusions }) : null),
    [accounts, contacts, outreachIndex, bfoActivity, localFields, links, exclusions],
  );

  const [query, setQuery] = useState('');
  // Read once per visit: the day count only needs to be right to the day.
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter(p => !q || String(p.company).toLowerCase().includes(q))
      .map(p => {
        const a = activity ? (activity.get(p.id || p.company) || null) : undefined;
        return {
          id: p.id || p.company,
          company: String(p.company).trim(),
          tier: String(p.tier).trim(),
          status: p.status || '',
          prospect: p,
          activity: a,
          days: a ? daysSince(a.tsMs, now) : null,
        };
      });
  }, [accounts, activity, query, now]);

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
      headerTitle: 'The account Status, as set on the company card. Pick one here to change it there.',
      getSortValue: r => (r.status ? r.status.toLowerCase() : null),
      getFilterValue: r => r.status || '',
      exportValue: r => r.status || '',
      render: (r) => {
        const color = STATUS_COLORS[r.status] || '#64748B';
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
      headerTitle: 'The newest of: HubSpot emails and calls with a contact at the account, HubSpot Last Contacted on those contacts, and the BFO Activity tab Last Activity for the account.',
      getSortValue: r => r.activity?.tsMs ?? null,
      getFilterValue: r => (r.activity ? formatDateDisplay(toLocalDate(r.activity.tsMs)) : 'None'),
      exportValue: r => (r.activity ? toLocalDate(r.activity.tsMs) : ''),
      render: (r) => {
        if (r.activity === undefined) return <span style={{ color: '#94A3B8' }}>Loading…</span>;
        if (!r.activity) return <span style={{ color: '#CBD5E1' }} title="No activity found in HubSpot or BFO Activity">None</span>;
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
      headerTitle: 'Where the last activity came from, and who or which opportunity it was with.',
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
  ], [canSetStatus, updateProspect, onSelectProspect]);

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

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', maxWidth }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748B', flex: '1 1 320px' }}>
          Every Tier 1, 2 and 3 account with {cdmName || 'you'} as its CDM. Last Activity is the newest HubSpot email or call with a contact at the account, HubSpot Last Contacted on those contacts, or the BFO Activity tab Last Activity for the account.
          {noIndex ? ' HubSpot emails and calls show once the Activity tab has loaded its feed.' : ''}
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search companies"
          style={{ padding: '0.35rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit', width: 240 }}
        />
      </div>
      {accounts.length === 0 ? (
        <div style={{ padding: '1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
          No accounts with {cdmName || 'you'} as their CDM carry a Tier yet. Set one on the company card.
        </div>
      ) : (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)', minHeight: 320 }}>
          <DataTable
            tableId="prospecting-tiered"
            exportFileName="Prospecting Tiered Accounts"
            columns={columns}
            rows={rows}
            defaultSort={{ key: 'days', direction: 'desc' }}
            fitWidth
            alwaysVisible={['company']}
            enableColumnFilters
            emptyMessage="No accounts match these filters"
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
