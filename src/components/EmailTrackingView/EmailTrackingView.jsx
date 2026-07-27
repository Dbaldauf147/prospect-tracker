// Email Tracking dashboard. Shows every email sent with tracking on
// (open pixel + rewritten links, injected when the draft was created)
// and the opens/clicks recorded against it. Reads the server-written
// `emailTracking` collection live; the client never writes here.
//
// A deliberate note on accuracy sits at the top of the table: opens are
// a directional signal (Apple Mail Privacy Protection pre-fetches the
// pixel, Gmail proxies it, Outlook blocks images by default), while
// clicks are a hard signal. Same limitations HubSpot has.

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts._seconds != null) return new Date(ts._seconds * 1000);
  if (ts.seconds != null) return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtRelative(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function location(ev) {
  const parts = [ev.city, ev.region, ev.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function deviceFromUa(ua) {
  if (!ua) return '—';
  if (/GoogleImageProxy/i.test(ua)) return 'Gmail (image proxy)';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/Outlook/i.test(ua)) return 'Outlook';
  return 'Other';
}

const tile = {
  flex: '1 1 130px',
  minWidth: 130,
  background: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-border, #E2E8F0)',
  borderRadius: 10,
  padding: '0.7rem 0.9rem',
};
const tileNum = { fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text, #0F172A)', lineHeight: 1.1 };
const tileLabel = { fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-muted, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 };
const th = { textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '0.5rem 0.7rem', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' };
const td = { padding: '0.55rem 0.7rem', fontSize: '0.8rem', color: '#1E293B', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' };

function Pill({ children, tone }) {
  const tones = {
    green: { bg: '#DCFCE7', fg: '#166534' },
    blue: { bg: '#DBEAFE', fg: '#1E40AF' },
    grey: { bg: '#F1F5F9', fg: '#64748B' },
  };
  const t = tones[tone] || tones.grey;
  return (
    <span style={{ display: 'inline-block', background: t.bg, color: t.fg, borderRadius: 999, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
      {children}
    </span>
  );
}

export function EmailTrackingView() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('sent'); // 'sent' | 'opens' | 'clicks'
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user?.uid) return;
    // Filter by owner only; sort client-side by createdAt so we don't
    // require a composite index the user would have to create by hand.
    // `loading` starts true (useState) and the first snapshot clears it —
    // no synchronous setState in the effect body.
    const q = query(
      collection(db, 'emailTracking'),
      where('uid', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('emailTracking snapshot error:', err);
        // A missing composite index surfaces here with a console link to
        // create it; show a readable hint rather than a blank screen.
        setError(err?.message || 'Failed to load tracking data');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const stats = useMemo(() => {
    const trackedEmails = rows.length;
    const totalOpens = rows.reduce((a, r) => a + (r.openCount || 0), 0);
    const openedEmails = rows.filter(r => (r.openCount || 0) > 0).length;
    const totalClicks = rows.reduce((a, r) => a + (r.clickCount || 0), 0);
    const clickedEmails = rows.filter(r => (r.clickCount || 0) > 0).length;
    const openRate = trackedEmails ? Math.round((openedEmails / trackedEmails) * 100) : 0;
    const clickRate = trackedEmails ? Math.round((clickedEmails / trackedEmails) * 100) : 0;
    return { trackedEmails, totalOpens, openedEmails, totalClicks, clickedEmails, openRate, clickRate };
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(r =>
        (r.recipientName || '').toLowerCase().includes(s) ||
        (r.to || '').toLowerCase().includes(s) ||
        (r.subject || '').toLowerCase().includes(s)
      );
    }
    const ms = (r) => { const d = toDate(r.createdAt); return d ? d.getTime() : 0; };
    const sorted = [...list];
    if (sortBy === 'opens') sorted.sort((a, b) => (b.openCount || 0) - (a.openCount || 0) || ms(b) - ms(a));
    else if (sortBy === 'clicks') sorted.sort((a, b) => (b.clickCount || 0) - (a.clickCount || 0) || ms(b) - ms(a));
    else sorted.sort((a, b) => ms(b) - ms(a)); // most recent
    return sorted;
  }, [rows, search, sortBy]);

  if (!user) return <div style={{ padding: '1.5rem', color: '#64748B' }}>Sign in to view email tracking.</div>;

  return (
    <div style={{ padding: '0.25rem 0.25rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>Email Tracking</h2>
        <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Opens &amp; clicks for emails sent with tracking on.</span>
      </div>

      {/* Accuracy note — set expectations the way an experienced HubSpot user reads these numbers. */}
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.74rem', lineHeight: 1.45, margin: '0.5rem 0 1rem' }}>
        <strong>Reading these numbers:</strong> opens are a directional signal — Apple Mail Privacy Protection pre-loads the pixel (inflating opens), Gmail proxies images (so location shows Google), and Outlook blocks images by default (so some real opens never register). <strong>Clicks are the hard signal.</strong>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={tile}><div style={tileNum}>{stats.trackedEmails}</div><div style={tileLabel}>Tracked emails</div></div>
        <div style={tile}><div style={tileNum}>{stats.openedEmails}</div><div style={tileLabel}>Opened ({stats.openRate}%)</div></div>
        <div style={tile}><div style={tileNum}>{stats.totalOpens}</div><div style={tileLabel}>Total opens</div></div>
        <div style={tile}><div style={tileNum}>{stats.clickedEmails}</div><div style={tileLabel}>Clicked ({stats.clickRate}%)</div></div>
        <div style={tile}><div style={tileNum}>{stats.totalClicks}</div><div style={tileLabel}>Total clicks</div></div>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipient or subject…"
          style={{ flex: '1 1 240px', maxWidth: 340, padding: '0.4rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
        />
        <label style={{ fontSize: '0.74rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          Sort by
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '0.35rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit' }}>
            <option value="sent">Most recent</option>
            <option value="opens">Most opens</option>
            <option value="clicks">Most clicks</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div style={{ padding: '2rem', color: '#64748B' }}>Loading tracking data…</div>
      ) : error ? (
        <div style={{ padding: '1rem', color: '#B91C1C', fontSize: '0.8rem' }}>
          {error}
          {/pass|index/i.test(error) && <div style={{ marginTop: 6, color: '#64748B' }}>If this mentions a missing index, open the link in the browser console once to create it.</div>}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748B', border: '1px dashed #CBD5E1', borderRadius: 10 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 4 }}>No tracked emails yet</div>
          <div style={{ fontSize: '0.8rem' }}>Go to <strong>Draft Emails</strong>, keep “Track opens &amp; clicks” checked, and download your drafts. Opens and clicks will show up here once recipients engage.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Recipient</th>
                <th style={th}>Subject</th>
                <th style={th}>Sent</th>
                <th style={{ ...th, textAlign: 'center' }}>Opens</th>
                <th style={th}>Last open</th>
                <th style={{ ...th, textAlign: 'center' }}>Clicks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const isOpen = expanded === r.id;
                const opened = (r.openCount || 0) > 0;
                const clicked = (r.clickCount || 0) > 0;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    isOpen={isOpen}
                    opened={opened}
                    clicked={clicked}
                    onToggle={() => setExpanded(isOpen ? null : r.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ r, isOpen, opened, clicked, onToggle }) {
  const opens = Array.isArray(r.opens) ? [...r.opens].reverse() : [];
  const clicks = Array.isArray(r.clicks) ? [...r.clicks].reverse() : [];
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: isOpen ? '#F8FAFC' : 'transparent' }}>
        <td style={{ ...td, width: 28, color: '#94A3B8', textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</td>
        <td style={td}>
          <div style={{ fontWeight: 600 }}>{r.recipientName || '—'}</div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{r.to || ''}</div>
        </td>
        <td style={{ ...td, maxWidth: 280 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={r.subject || ''}>{r.subject || '—'}</div>
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{fmtDateTime(r.createdAt)}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          {opened ? <Pill tone="green">{r.openCount}</Pill> : <Pill tone="grey">0</Pill>}
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>
          {r.lastOpenAt ? <span title={fmtDateTime(r.lastOpenAt)}>{fmtRelative(r.lastOpenAt)}</span> : '—'}
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          {clicked ? <Pill tone="blue">{r.clickCount}</Pill> : <Pill tone="grey">0</Pill>}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} style={{ padding: '0.75rem 1rem 1rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Opens ({r.openCount || 0})</div>
                {opens.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No opens recorded yet.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {opens.map((ev, i) => (
                      <li key={i} style={{ fontSize: '0.76rem', color: '#334155', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{fmtDateTime(ev.at)}</span>
                        <span style={{ color: '#64748B' }}>· {location(ev)}</span>
                        <span style={{ color: '#94A3B8' }}>· {deviceFromUa(ev.ua)}</span>
                        {ev.proxied && <span style={{ color: '#B45309' }} title="Likely a mail-client image proxy or privacy pre-fetch, not necessarily a human open">· auto/proxy</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Clicks ({r.clickCount || 0})</div>
                {clicks.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No link clicks recorded yet.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {clicks.map((ev, i) => (
                      <li key={i} style={{ fontSize: '0.76rem', color: '#334155' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600 }}>{fmtDateTime(ev.at)}</span>
                          <span style={{ color: '#64748B' }}>· {location(ev)}</span>
                        </div>
                        {ev.url && <div style={{ color: '#2563EB', wordBreak: 'break-all' }}>{ev.url}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
