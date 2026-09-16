// Sent Log - every email you sent from Outlook, logged without HubSpot.
//
// ---- What this is instead of ---------------------------------------------
// This tab exists to replace a HubSpot Outlook add-in that auto-BCC'd every
// send so HubSpot could log the activity. The BCC is a workaround for not
// having the mailbox. This app has it already: the Microsoft Graph sign-in
// behind the Drafts tab asks for Mail.ReadWrite, so /api/outlook-sent can
// read the Sent Items folder directly. No add-in, no BCC, no rule, and
// nothing new to consent to.
//
// The read happens when you open this tab, not on a schedule, because the
// Graph token lives in this browser rather than on the server - the same
// arrangement the Activity page's calendar panel runs on. It pulls a window
// rather than a delta, so opening the tab once a week loses nothing.
//
// ---- What it deliberately does not show ----------------------------------
// Opens and clicks. Those need a pixel and rewritten links in the body at
// send time, which is what the Email Tracking tab does for mail composed in
// this app. A row here is the record that a mail went out, which is all the
// BCC ever gave.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { secureGet, secureSet, secureClear } from '../../utils/secureStorage';
import {
  sentRowsFromMessages, recipientRollup, filterSentRows,
  describeOutlookSent, daysAgo, isFreeMail, domainOf,
} from '../../utils/outlookSent';

// Graph tokens last about an hour. Treating one as dead a minute early is
// cheaper than firing a request that comes back 401.
const EXPIRY_SKEW_MS = 60 * 1000;

const RANGES = [
  { days: 7, label: 'the last 7 days', short: '7 days' },
  { days: 30, label: 'the last 30 days', short: '30 days' },
  { days: 90, label: 'the last 90 days', short: '90 days' },
  { days: 365, label: 'the last year', short: '1 year' },
];

const th = { textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '0.5rem 0.7rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' };
const td = { padding: '0.55rem 0.7rem', fontSize: '0.8rem', color: '#1E293B', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };

function fmtDateTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  return new Date(t).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtRelative(iso) {
  const d = daysAgo(iso);
  if (d == null) return '';
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  const months = Math.floor(d / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(d / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

// How cold a contact has gone, as a colour. The thresholds are the ones a
// seller already thinks in: this week, this month, longer than that.
function staleTone(days) {
  if (days == null) return { background: 'transparent', color: '#94A3B8' };
  if (days <= 7) return { background: '#DCFCE7', color: '#166534' };
  if (days <= 30) return { background: '#FEF3C7', color: '#92400E' };
  return { background: '#FEE2E2', color: '#991B1B' };
}

export function SentLogView({ prospects = [] }) {
  const [tab, setTab] = useState('log');
  const [days, setDays] = useState(30);
  const [query, setQuery] = useState('');
  const [includeInternal, setIncludeInternal] = useState(false);

  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [fetchedAt, setFetchedAt] = useState('');
  const [auth, setAuth] = useState('none');
  const loadingRef = useRef(false);

  // ---- the domain to company index the rest of the app already uses ------
  // Built from the roster rather than from HubSpot, so a company the user
  // has in the tracker is named even when no contact record exists yet.
  const domainToCompany = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      if (p?.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const domain = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase();
          if (domain && p.company) map.set(domain, p.company);
        }
      }
      if (p?.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
        if (d && p.company) map.set(d, p.company);
      }
    }
    return map;
  }, [prospects]);

  // A company for a row, or '' when the address says nothing about one. A
  // consumer mailbox is left blank rather than attributed to "Gmail", which
  // is what guessing from the domain would produce.
  const companyFor = useCallback((emails) => {
    for (const email of emails) {
      const domain = domainOf(email);
      if (!domain) continue;
      if (domainToCompany.has(domain)) return domainToCompany.get(domain);
    }
    for (const email of emails) {
      if (!email || isFreeMail(email)) continue;
      const domain = domainOf(email);
      if (!domain) continue;
      return domain
        .replace(/\.(com|org|net|io|co|us|ca|uk|co\.uk)$/i, '')
        .replace(/\./g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    return '';
  }, [domainToCompany]);

  const readToken = useCallback(async () => {
    try {
      const token = await secureGet('outlook-access-token');
      if (!token) { setAuth('none'); return ''; }
      const expiry = Number(await secureGet('outlook-token-expiry'));
      if (Number.isFinite(expiry) && expiry > 0 && Date.now() > expiry - EXPIRY_SKEW_MS) {
        setAuth('expired');
        return '';
      }
      setAuth('live');
      return token;
    } catch {
      setAuth('none');
      return '';
    }
  }, []);

  const load = useCallback(async (tokenOverride = '', windowDays = days) => {
    if (loadingRef.current) return;
    const token = tokenOverride || await readToken();
    if (!token) return;

    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const r = await apiFetch(`/api/outlook-sent?days=${windowDays}`, {
        headers: { 'X-MS-Token': token },
      });
      if (r.status === 401) {
        // The token outlived its expiry stamp, or was revoked. Signing in
        // again is the whole fix, so this is not a red banner.
        setAuth('expired');
        return;
      }
      if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.error || ''; } catch { detail = await r.text().catch(() => ''); }
        setError(detail || `Sent Items fetch failed (HTTP ${r.status})`);
        return;
      }
      const body = await r.json();
      setMessages(body.messages || []);
      setTruncated(!!body.truncated);
      setLoaded(true);
      setFetchedAt(new Date().toISOString());
      setAuth('live');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [days, readToken]);

  // Read on arrival when the sign-in is still good. Nothing pops up: either
  // the token is live and the log is on the page, or the panel says how to
  // connect.
  useEffect(() => { load(); }, [load]);

  // The sign-in popup reports back the same way it does on the Drafts page,
  // the Activity page and the opportunity meeting picker, so one Outlook
  // connection serves all of them.
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'outlook-auth-success') {
        (async () => {
          try {
            await secureSet('outlook-access-token', e.data.accessToken);
            if (e.data.refreshToken) await secureSet('outlook-refresh-token', e.data.refreshToken);
            await secureSet('outlook-token-expiry', String(Date.now() + (e.data.expiresIn || 3600) * 1000));
          } catch { /* storage refused: the fetch below still works this session */ }
          setAuth('live');
          load(e.data.accessToken);
        })();
      } else if (e.data?.type === 'outlook-auth-error') {
        setError(e.data.error || 'Outlook sign-in failed');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  const rows = useMemo(() => {
    const mapped = sentRowsFromMessages(messages);
    return mapped.map(row => (
      row._company ? row : { ...row, _company: companyFor(row._recipients) }
    ));
  }, [messages, companyFor]);

  const shown = useMemo(
    () => filterSentRows(rows, { query, includeInternal }),
    [rows, query, includeInternal],
  );

  const contacts = useMemo(() => {
    const rolled = recipientRollup(rows);
    if (!query.trim()) return rolled;
    const q = query.trim().toLowerCase();
    return rolled.filter(c => (
      `${c.email} ${c.name} ${c.company} ${c.lastSubject}`.toLowerCase().includes(q)
    ));
  }, [rows, query]);

  const rangeLabel = RANGES.find(r => r.days === days)?.label || `the last ${days} days`;
  const note = describeOutlookSent({
    connected: auth !== 'none',
    expired: auth === 'expired',
    loaded,
    messages: rows.length,
    shown: filterSentRows(rows, { includeInternal }).length,
    rangeLabel,
  });

  const connect = () => {
    setError('');
    window.open('/api/outlook-auth', 'outlook-auth', 'width=500,height=700,left=200,top=100');
  };

  const disconnect = () => {
    if (!window.confirm('Disconnect Outlook? The Sent Log will stop updating, and the Drafts tab will ask you to sign in again.')) return;
    try {
      secureClear('outlook-access-token');
      secureClear('outlook-refresh-token');
      secureClear('outlook-token-expiry');
    } catch { /* nothing stored */ }
    setMessages([]);
    setLoaded(false);
    setFetchedAt('');
    setAuth('none');
  };

  const internalCount = rows.filter(r => r._internalOnly).length;

  const tile = (value, label, title) => (
    <div title={title} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.6rem 0.9rem', minWidth: 110 }}>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600 }}>{label}</div>
    </div>
  );

  const subTab = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        background: 'none', border: 'none', padding: '0.4rem 0.7rem',
        fontFamily: 'inherit', fontSize: '0.78rem',
        fontWeight: tab === key ? 700 : 500,
        color: tab === key ? '#1D4ED8' : '#475569',
        borderBottom: tab === key ? '2px solid #1D4ED8' : '2px solid transparent',
        cursor: 'pointer', marginBottom: -1,
      }}
    >{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0F172A' }}>Sent Log</h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#64748B', maxWidth: 620 }}>
            Every email you sent from Outlook, read straight out of your Sent Items folder.
            No BCC and no add-in: this uses the same Outlook sign-in the Drafts tab already asks for.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {auth === 'live' && (
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: loading ? 'default' : 'pointer' }}
            >{loading ? 'Reading...' : 'Refresh'}</button>
          )}
          {auth === 'live' ? (
            <button
              type="button"
              onClick={disconnect}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', cursor: 'pointer' }}
            >Disconnect Outlook</button>
          ) : (
            <button
              type="button"
              onClick={connect}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: 'none', background: '#1D4ED8', color: '#fff', cursor: 'pointer' }}
            >{auth === 'expired' ? 'Reconnect Outlook' : 'Connect Outlook'}</button>
          )}
        </div>
      </div>

      {note && (
        <div style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: '#334155', marginBottom: '0.75rem' }}>
          {note}
        </div>
      )}

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: '#991B1B', marginBottom: '0.75rem' }}>
          {error}
        </div>
      )}

      {truncated && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: '#92400E', marginBottom: '0.75rem' }}>
          This window held more sent mail than one read returns, so the oldest of it is missing. Narrow the range to see all of it.
        </div>
      )}

      {loaded && (
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          {tile(shown.length, 'Emails', `Sent in ${rangeLabel}, to somebody outside the company.`)}
          {tile(contacts.length, 'People', 'Distinct outside recipients you emailed in this window.')}
          {tile(
            new Set(shown.map(r => r._company).filter(Boolean)).size,
            'Companies',
            'Distinct companies those recipients belong to.',
          )}
          {internalCount > 0 && tile(internalCount, 'Internal', 'Sent only to colleagues, and left out of the numbers beside this unless you ask for them.')}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid #E2E8F0', borderRadius: 6, padding: 2 }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              onClick={() => { setDays(r.days); load('', r.days); }}
              style={{
                background: days === r.days ? '#1D4ED8' : 'transparent',
                color: days === r.days ? '#fff' : '#475569',
                border: 'none', borderRadius: 4, padding: '0.25rem 0.55rem',
                fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
              }}
            >{r.short}</button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search subject, person or company"
          style={{ flex: '1 1 220px', maxWidth: 320, padding: '0.35rem 0.6rem', fontSize: '0.8rem', fontFamily: 'inherit', border: '1px solid #CBD5E1', borderRadius: 6 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeInternal} onChange={e => setIncludeInternal(e.target.checked)} />
          Include internal mail
        </label>
        {fetchedAt && (
          <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: 'auto' }}>
            Last read {fmtDateTime(fetchedAt)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid #E2E8F0', marginBottom: '0.6rem' }}>
        {subTab('log', 'By email')}
        {subTab('people', 'By person')}
      </div>

      {tab === 'log' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Sent</th>
              <th style={th}>To</th>
              <th style={th}>Company</th>
              <th style={th}>Subject</th>
              <th style={{ ...th, textAlign: 'center' }}>Recipients</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td style={{ ...td, color: '#94A3B8' }} colSpan={5}>
                  {loading ? 'Reading your Sent Items...' : loaded ? 'Nothing sent matches this.' : 'Connect Outlook to read your Sent Items.'}
                </td>
              </tr>
            ) : shown.map(row => (
              <tr key={row.id}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }} title={fmtDateTime(row._sentAt)}>
                  {fmtRelative(row._sentAt)}
                </td>
                <td style={{ ...td, maxWidth: 220 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row._internalOnly ? 'Colleagues only' : (row._to || '(no recipient)')}
                  </div>
                  {row._recipients.length > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row._recipients.join(', ')}
                    </div>
                  )}
                </td>
                <td style={{ ...td, maxWidth: 160 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._company}>
                    {row._company || <span style={{ color: '#CBD5E1' }}>-</span>}
                  </div>
                </td>
                <td style={{ ...td, maxWidth: 300 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row._preview || row._subject}>
                    {row._subject}
                    {row._hasAttachments && <span title="Has an attachment" style={{ color: '#94A3B8', marginLeft: '0.35rem' }}>&#128206;</span>}
                  </div>
                </td>
                <td style={{ ...td, textAlign: 'center', color: '#64748B' }}>
                  <span title={row._bccCount > 0 ? `${row._allRecipientCount} on the mail, including ${row._bccCount} blind copy${row._bccCount === 1 ? '' : 'ies'}` : `${row._allRecipientCount} on the mail`}>
                    {row._allRecipientCount}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Person</th>
              <th style={th}>Company</th>
              <th style={th}>Last emailed</th>
              <th style={th}>Last subject</th>
              <th style={{ ...th, textAlign: 'center' }}>Emails</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td style={{ ...td, color: '#94A3B8' }} colSpan={5}>
                  {loading ? 'Reading your Sent Items...' : loaded ? 'Nobody outside the company was emailed in this window.' : 'Connect Outlook to read your Sent Items.'}
                </td>
              </tr>
            ) : contacts.map(c => {
              const age = daysAgo(c.lastSentAt);
              const tone = staleTone(age);
              return (
                <tr key={c.email}>
                  <td style={{ ...td, maxWidth: 230 }}>
                    <div style={{ fontWeight: 600 }}>{c.name || c.email}</div>
                    {c.name && <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{c.email}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 170 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.company}>
                      {c.company || <span style={{ color: '#CBD5E1' }}>-</span>}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span
                      title={fmtDateTime(c.lastSentAt)}
                      style={{ display: 'inline-block', borderRadius: 999, padding: '0.05rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, ...tone }}
                    >{fmtRelative(c.lastSentAt)}</span>
                  </td>
                  <td style={{ ...td, maxWidth: 300 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.lastSubject}>
                      {c.lastSubject}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'center', color: '#64748B' }}>{c.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
