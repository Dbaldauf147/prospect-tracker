import { useEffect, useMemo, useState } from 'react';
import styles from './AgentsView.module.css';

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

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

// Tightened outbound check — the email is something I sent if the from
// address is on @se.com. Matches the rest of the app (ActivityView's
// pickDirection uses the same rule).
function isOutbound(fromEmail) {
  const f = String(fromEmail || '').toLowerCase();
  return f.includes('@se.com') || f.includes('daniel.baldauf');
}

// Split a raw to/cc string into individual addresses. HubSpot delivers
// these as a single semicolon- or comma-joined string.
function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// At least one recipient is outside @se.com. A mixed list (e.g. a
// customer + an internal CC) still counts — the user explicitly
// asked to keep those rows.
function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

// Drop the @se.com addresses from the visible recipient list so the
// row reads as "who outside SE did I email" without manual scanning.
// Falls back to the raw value when no external addresses survive
// (shouldn't happen for visible rows, but be defensive).
function externalRecipientLabel(toRaw) {
  const ext = splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
  if (ext.length === 0) return toRaw || '';
  return ext.join(', ');
}

export function AgentsView() {
  const [cache, setCache] = useState(() => readActivityCache());

  // Pick up new pulls from the Activity tab without a full reload.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = todayBounds();
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    const outbound = (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inToday(e.hs_timestamp))
      .filter(e => isOutbound(e.hs_email_from_email))
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .map(e => ({
        id: e.id || e.hs_object_id,
        ts: e.hs_timestamp,
        subject: e.hs_email_subject || '(no subject)',
        to: externalRecipientLabel(e.hs_email_to_email),
        rawTo: e.hs_email_to_email || '',
        from: e.hs_email_from_email || '',
        status: e.hs_email_status || '',
      }))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .map(m => ({
        id: m.id || m.hs_object_id,
        ts: m.hs_meeting_start_time || m.hs_timestamp,
        endTs: m.hs_meeting_end_time,
        title: m.hs_meeting_title || 'Meeting',
        outcome: m.hs_meeting_outcome || '',
        location: m.hs_meeting_location || '',
      }))
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
  }, [cache]);

  const dateLabel = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), []);

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <span className={styles.dateline}>{dateLabel}</span>
      </div>
      <p className={styles.subnote}>
        Today&rsquo;s outbound emails to non-SE recipients (mixed lists with an internal CC alongside an external recipient still count), plus any meetings on today&rsquo;s calendar. Sourced from the Activity tab&rsquo;s cache &mdash; open Activity at least once per session to refresh.
      </p>

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>outbound emails today</div>
        {todaysMeetings.length > 0 && (
          <div className={styles.tally}><strong>{todaysMeetings.length}</strong>meeting{todaysMeetings.length === 1 ? '' : 's'} today</div>
        )}
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
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
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {todaysOutbound.map(e => (
                <tr key={e.id}>
                  <td>{fmtTime(e.ts)}</td>
                  <td>{e.subject}</td>
                  <td title={e.rawTo}>{e.to || <span className={styles.muted}>—</span>}</td>
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
                <th style={{ width: 160 }}>Outcome</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {todaysMeetings.map(m => (
                <tr key={m.id}>
                  <td>{fmtTime(m.ts)}{m.endTs ? ` – ${fmtTime(m.endTs)}` : ''}</td>
                  <td>{m.title}</td>
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
