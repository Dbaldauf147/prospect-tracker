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

function fmtDuration(ms) {
  if (!ms) return '—';
  const sec = Math.round(parseInt(ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function pickDirection(raw, fromEmail) {
  const f = String(fromEmail || '').toLowerCase();
  if (f.includes('@se.com') || f.includes('daniel.baldauf')) return 'Outbound';
  if (f) return 'Inbound';
  return String(raw || '').trim();
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

  const today = useMemo(() => {
    const bounds = todayBounds();
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    const emails = (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inToday(e.hs_timestamp))
      .map(e => ({
        id: e.id || e.hs_object_id,
        ts: e.hs_timestamp,
        subject: e.hs_email_subject || '(no subject)',
        direction: pickDirection(e.hs_email_direction, e.hs_email_from_email),
        to: e.hs_email_to_email || '',
        from: e.hs_email_from_email || '',
        status: e.hs_email_status || '',
      }))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    const calls = (cache?.calls || [])
      .filter(c => inToday(c.hs_timestamp))
      .map(c => ({
        id: c.id || c.hs_object_id,
        ts: c.hs_timestamp,
        title: c.hs_call_title || 'Call',
        direction: c.hs_call_direction || '',
        to: c.hs_call_to_number || '',
        from: c.hs_call_from_number || '',
        duration: c.hs_call_duration,
        status: c.hs_call_disposition || c.hs_call_status || '',
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

    return { emails, calls, meetings };
  }, [cache]);

  const dateLabel = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), []);

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const total = today.emails.length + today.calls.length + today.meetings.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <span className={styles.dateline}>{dateLabel}</span>
      </div>
      <p className={styles.subnote}>
        Today&rsquo;s HubSpot activity (emails, calls, meetings) for the signed-in agent. Mirrors the Activity tab&rsquo;s cache &mdash; open Activity at least once per session to refresh.
      </p>

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{total}</strong>total today</div>
        <div className={styles.tally}><strong>{today.emails.length}</strong>emails</div>
        <div className={styles.tally}><strong>{today.calls.length}</strong>calls</div>
        <div className={styles.tally}><strong>{today.meetings.length}</strong>meetings</div>
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
          Meetings <span className={styles.sectionCount}>{today.meetings.length}</span>
        </h2>
        {today.meetings.length === 0 ? (
          <div className={styles.empty}>No meetings logged today.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Time</th>
                <th>Title</th>
                <th style={{ width: 160 }}>Outcome</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {today.meetings.map(m => (
                <tr key={m.id}>
                  <td>{fmtTime(m.ts)}{m.endTs ? ` – ${fmtTime(m.endTs)}` : ''}</td>
                  <td>{m.title}</td>
                  <td className={m.outcome ? '' : styles.muted}>{m.outcome || '—'}</td>
                  <td className={m.location ? '' : styles.muted}>{m.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Calls <span className={styles.sectionCount}>{today.calls.length}</span>
        </h2>
        {today.calls.length === 0 ? (
          <div className={styles.empty}>No calls logged today.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Time</th>
                <th>Title</th>
                <th style={{ width: 130 }}>Direction</th>
                <th>To / From</th>
                <th style={{ width: 90 }}>Duration</th>
                <th style={{ width: 140 }}>Disposition</th>
              </tr>
            </thead>
            <tbody>
              {today.calls.map(c => {
                const dirLower = String(c.direction).toLowerCase();
                const pill = dirLower.includes('out')
                  ? `${styles.pill} ${styles.pillOutbound}`
                  : dirLower.includes('in')
                    ? `${styles.pill} ${styles.pillInbound}`
                    : '';
                return (
                  <tr key={c.id}>
                    <td>{fmtTime(c.ts)}</td>
                    <td>{c.title}</td>
                    <td>{c.direction ? <span className={pill}>{c.direction}</span> : <span className={styles.muted}>—</span>}</td>
                    <td className={!c.to && !c.from ? styles.muted : ''}>{c.to || c.from || '—'}</td>
                    <td>{fmtDuration(c.duration)}</td>
                    <td className={c.status ? '' : styles.muted}>{c.status || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Emails <span className={styles.sectionCount}>{today.emails.length}</span>
        </h2>
        {today.emails.length === 0 ? (
          <div className={styles.empty}>No emails logged today.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Time</th>
                <th>Subject</th>
                <th style={{ width: 110 }}>Direction</th>
                <th>To</th>
                <th>From</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {today.emails.map(e => {
                const pill = e.direction === 'Outbound'
                  ? `${styles.pill} ${styles.pillOutbound}`
                  : e.direction === 'Inbound'
                    ? `${styles.pill} ${styles.pillInbound}`
                    : '';
                return (
                  <tr key={e.id}>
                    <td>{fmtTime(e.ts)}</td>
                    <td>{e.subject}</td>
                    <td>{e.direction ? <span className={pill}>{e.direction}</span> : <span className={styles.muted}>—</span>}</td>
                    <td className={e.to ? '' : styles.muted}>{e.to || '—'}</td>
                    <td className={e.from ? '' : styles.muted}>{e.from || '—'}</td>
                    <td className={e.status ? '' : styles.muted}>{e.status || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
