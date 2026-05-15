import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import styles from './AgentsView.module.css';

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

function readActivityCache() {
  try {
    const raw = localStorage.getItem(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function todayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

function externalRecipientList(toRaw) {
  return splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
}

// Normalize a company name for fuzzy matching against BFO Account
// Name. Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes,
// strip punctuation, collapse whitespace. Same shape ActivityView and
// MyAccountsView use so a name that matches there matches here too.
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

export function AgentsView() {
  const { user } = useAuth();
  const [cache, setCache] = useState(() => readActivityCache());
  const [hubspotCache, setHubspotCache] = useState(null);
  const [bfoData, setBfoData] = useState({ headers: [], rows: [] });

  // The signed-in user's email is the source of truth for "did I send
  // this email." daniel.baldauf@se.com gets the special case that the
  // rest of the app uses (a couple of HubSpot threads come through as
  // daniel.baldauf without the @se.com suffix on the from line).
  const myEmail = String(user?.email || '').toLowerCase();

  // Pick up new HubSpot activity pulls from the Activity tab.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // HubSpot contacts cache — email → company lookup for tagging.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // BFO export from the BFO Activity tab — provides Account Name →
  // Opportunity Name. Refresh on window focus so a fresh paste over
  // there shows up here without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_STORE, BFO_KEY)
        .then(saved => { if (!cancelled && saved?.rows) setBfoData(saved); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // email → company map from the HubSpot contacts cache.
  const companyByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  // BFO rows surfaced as { accountName, opportunityName } so we can do
  // fuzzy company → opp lookups without re-scanning the headers per
  // email. Picks the first non-empty Opportunity Name per Account.
  const bfoOppByCompany = useMemo(() => {
    if (!bfoData?.headers?.length || !bfoData?.rows?.length) return [];
    const accountCol = bfoData.headers.find(h => /account\s*name/i.test(h));
    const oppCol = bfoData.headers.find(h => /opportunity\s*name/i.test(h));
    if (!accountCol || !oppCol) return [];
    const out = [];
    for (const r of bfoData.rows) {
      const acct = String(r[accountCol] || '').trim();
      const opp = String(r[oppCol] || '').trim();
      if (acct && opp) out.push({ account: acct, opp });
    }
    return out;
  }, [bfoData]);

  const lookupOppForCompany = (company) => {
    if (!company || bfoOppByCompany.length === 0) return '';
    for (const { account, opp } of bfoOppByCompany) {
      if (companiesMatch(account, company)) return opp;
    }
    return '';
  };

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = todayBounds();
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    const sentByMe = (e) => {
      if (!myEmail) return false;
      const from = String(e.hs_email_from_email || '').toLowerCase().trim();
      return from === myEmail;
    };
    const outbound = (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inToday(e.hs_timestamp))
      .filter(sentByMe)
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .map(e => {
        const recipients = externalRecipientList(e.hs_email_to_email);
        // Take the first external recipient that we can map to a
        // HubSpot contact's company. If none are mapped, fall back to
        // a domain-derived guess so the row still shows something.
        let company = '';
        for (const addr of recipients) {
          const c = companyByEmail.get(addr);
          if (c) { company = c; break; }
        }
        if (!company && recipients[0]) {
          const at = recipients[0].lastIndexOf('@');
          if (at >= 0) {
            const domain = recipients[0].slice(at + 1);
            company = domain
              .replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '')
              .replace(/\./g, ' ')
              .replace(/\b\w/g, m => m.toUpperCase());
          }
        }
        const bfoOpp = lookupOppForCompany(company);
        return {
          id: e.id || e.hs_object_id,
          ts: e.hs_timestamp,
          subject: e.hs_email_subject || '(no subject)',
          to: recipients.join(', '),
          rawTo: e.hs_email_to_email || '',
          status: e.hs_email_status || '',
          company,
          bfoOpp,
        };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .map(m => {
        // For meetings, scan associated contact IDs for a HubSpot
        // contact's company so the same tagging applies.
        const ids = m._contactIds || [];
        let company = '';
        for (const id of ids) {
          const ct = (hubspotCache?.contacts || []).find(c => c.id === id);
          if (ct?.company) { company = ct.company; break; }
        }
        const bfoOpp = lookupOppForCompany(company);
        return {
          id: m.id || m.hs_object_id,
          ts: m.hs_meeting_start_time || m.hs_timestamp,
          endTs: m.hs_meeting_end_time,
          title: m.hs_meeting_title || 'Meeting',
          outcome: m.hs_meeting_outcome || '',
          location: m.hs_meeting_location || '',
          company,
          bfoOpp,
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
    // lookupOppForCompany / companyByEmail are derived from the same
    // dependency set as cache + hubspotCache + bfoOppByCompany, so they
    // don't need their own entries here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, hubspotCache, bfoOppByCompany, myEmail]);

  const dateLabel = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), []);

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const bfoLoaded = bfoData?.rows?.length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <span className={styles.dateline}>{dateLabel}</span>
      </div>
      <p className={styles.subnote}>
        Today&rsquo;s outbound emails from <strong>{myEmail || '(no signed-in user)'}</strong> to non-SE recipients, plus any meetings on today&rsquo;s calendar. Company + BFO Opportunity columns are tagged from the HubSpot contacts cache and the BFO Activity tab&rsquo;s pasted export.
      </p>

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>sent emails today</div>
        {todaysMeetings.length > 0 && (
          <div className={styles.tally}><strong>{todaysMeetings.length}</strong>meeting{todaysMeetings.length === 1 ? '' : 's'} today</div>
        )}
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
        </div>
      )}
      {cache && !bfoLoaded && (
        <div className={styles.staleBanner}>
          No BFO Activity export pasted yet. Paste your BFO rows on the BFO Activity tab to populate the BFO Opportunity column.
        </div>
      )}
      {cache && fetchedLabel && (
        <div className={styles.subnote}>Cache last refreshed {fetchedLabel}.</div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Sent emails <span className={styles.sectionCount}>{todaysOutbound.length}</span>
        </h2>
        {todaysOutbound.length === 0 ? (
          <div className={styles.empty}>No outbound emails to external recipients today.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Time</th>
                <th>Subject</th>
                <th>To (external)</th>
                <th>Company</th>
                <th>BFO Opportunity</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {todaysOutbound.map(e => (
                <tr key={e.id}>
                  <td>{fmtTime(e.ts)}</td>
                  <td>{e.subject}</td>
                  <td title={e.rawTo}>{e.to || <span className={styles.muted}>—</span>}</td>
                  <td className={e.company ? '' : styles.muted}>{e.company || '—'}</td>
                  <td className={e.bfoOpp ? '' : styles.muted}>{e.bfoOpp || '—'}</td>
                  <td className={e.status ? '' : styles.muted}>{e.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {todaysMeetings.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeader}>
            Meetings <span className={styles.sectionCount}>{todaysMeetings.length}</span>
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Time</th>
                <th>Title</th>
                <th>Company</th>
                <th>BFO Opportunity</th>
                <th style={{ width: 160 }}>Outcome</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {todaysMeetings.map(m => (
                <tr key={m.id}>
                  <td>{fmtTime(m.ts)}{m.endTs ? ` – ${fmtTime(m.endTs)}` : ''}</td>
                  <td>{m.title}</td>
                  <td className={m.company ? '' : styles.muted}>{m.company || '—'}</td>
                  <td className={m.bfoOpp ? '' : styles.muted}>{m.bfoOpp || '—'}</td>
                  <td className={m.outcome ? '' : styles.muted}>{m.outcome || '—'}</td>
                  <td className={m.location ? '' : styles.muted}>{m.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
