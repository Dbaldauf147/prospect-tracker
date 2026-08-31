// Email Tracking — a sub-tab of Draft Emails, sitting next to the composer
// and the campaign report that produce the rows it shows. Every email sent
// with tracking on (open pixel + rewritten links, injected when the draft
// was created) and the opens/clicks recorded against it. Reads the
// server-written `emailTracking` collection live; the client never writes here.
//
// Each send is attributed to a saved email campaign by subject, so the
// dashboard can be narrowed to one campaign and the tiles then read as that
// campaign's open/click performance. The campaign name is a link across to
// the Email Campaigns tab.
//
// A deliberate note on accuracy sits at the top of the table: opens are
// a directional signal (Apple Mail Privacy Protection pre-fetches the
// pixel, Gmail proxies it, Outlook blocks images by default), while
// clicks are a hard signal. Same limitations HubSpot has.

import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useEmailTracking, normalizeTrackedEmail, sentAtByRecipient } from '../../hooks/useEmailTracking';
import { countOpens, describeExcludedOpens } from '../../utils/emailOpens';
import { useSavedCampaigns, campaignForSubject, campaignLabel } from '../../hooks/useSavedCampaigns';

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
  if (!d) return '-';
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
  return parts.length ? parts.join(', ') : '-';
}

function deviceFromUa(ua) {
  if (!ua) return '-';
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
// Text that reads as a link but is a real button — the campaign hop is an
// in-app tab switch, not a URL.
const linkBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#1D4ED8',
  cursor: 'pointer',
  textAlign: 'left',
};

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

export function EmailTrackingView({ onOpenCampaign }) {
  const { user } = useAuth();
  // Shared loader (realtime Firestore, falling back to /api/track-list
  // when the emailTracking read rule isn't deployed) — the Email Campaign
  // report reads the same rows through this hook.
  const { rows, loading, error, fallback } = useEmailTracking();
  const { campaigns } = useSavedCampaigns();
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('sent'); // 'sent' | 'opens' | 'clicks'
  const [search, setSearch] = useState('');
  // '' = every send, 'none' = sends no campaign claims, otherwise the saved
  // campaign's index (subjects aren't unique, so the index is the identity).
  const [campaignFilter, setCampaignFilter] = useState('');

  // Attribute every tracked send to a saved campaign once, up front, and
  // count its opens while we're there.
  //
  // The raw openCount on a doc is every hit on the pixel, and the pixel is
  // injected into the Outlook DRAFT — so it fires while the draft is still
  // being proof-read, again for link scanners, and again each time the
  // message is re-rendered. countOpens() drops those (src/utils/emailOpens.js).
  // The pre-send rule needs a send time, which a tracking doc doesn't have —
  // it only knows when its draft was created — so it comes from the saved
  // campaign that claims this send. Unclaimed sends keep their raw timeline.
  const sentAtByCampaign = useMemo(() => {
    const map = new Map();
    (campaigns || []).forEach((c, index) => map.set(index, sentAtByRecipient(c?.contacts)));
    return map;
  }, [campaigns]);
  const linked = useMemo(
    () => rows.map(r => {
      const link = campaignForSubject(campaigns, r.subject);
      const sent = link ? sentAtByCampaign.get(link.index) : null;
      const key = normalizeTrackedEmail(r.to);
      const opens = sent?.has(key)
        ? countOpens(r, { sentAt: sent.get(key) ?? null })
        : countOpens(r);
      return { row: r, link, opens };
    }),
    [rows, campaigns, sentAtByCampaign],
  );

  // How many tracked sends each campaign claims — shown in the picker so an
  // empty campaign is obvious before it's selected.
  const countsByCampaign = useMemo(() => {
    const counts = new Map();
    let unlinked = 0;
    for (const { link } of linked) {
      if (!link) { unlinked += 1; continue; }
      counts.set(link.index, (counts.get(link.index) || 0) + 1);
    }
    return { counts, unlinked };
  }, [linked]);

  // The campaign selection scopes everything below it — tiles included, so
  // the rates read as that campaign's performance. The search box narrows
  // only the table.
  const scoped = useMemo(() => {
    if (campaignFilter === '') return linked;
    if (campaignFilter === 'none') return linked.filter(l => !l.link);
    const idx = Number(campaignFilter);
    return linked.filter(l => l.link?.index === idx);
  }, [linked, campaignFilter]);

  const selectedCampaign = campaignFilter !== '' && campaignFilter !== 'none'
    ? campaigns[Number(campaignFilter)]
    : null;

  const stats = useMemo(() => {
    const list = scoped.map(l => l.row);
    const trackedEmails = list.length;
    const totalOpens = scoped.reduce((a, l) => a + l.opens.count, 0);
    const openedEmails = scoped.filter(l => l.opens.count > 0).length;
    const totalClicks = list.reduce((a, r) => a + (r.clickCount || 0), 0);
    const clickedEmails = list.filter(r => (r.clickCount || 0) > 0).length;
    const openRate = trackedEmails ? Math.round((openedEmails / trackedEmails) * 100) : 0;
    const clickRate = trackedEmails ? Math.round((clickedEmails / trackedEmails) * 100) : 0;
    return { trackedEmails, totalOpens, openedEmails, totalClicks, clickedEmails, openRate, clickRate };
  }, [scoped]);

  const visible = useMemo(() => {
    let list = scoped;
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(({ row: r, link }) =>
        (r.recipientName || '').toLowerCase().includes(s) ||
        (r.to || '').toLowerCase().includes(s) ||
        (r.subject || '').toLowerCase().includes(s) ||
        (link ? campaignLabel(link.campaign).toLowerCase().includes(s) : false)
      );
    }
    const ms = (l) => { const d = toDate(l.row.createdAt); return d ? d.getTime() : 0; };
    const sorted = [...list];
    if (sortBy === 'opens') sorted.sort((a, b) => b.opens.count - a.opens.count || ms(b) - ms(a));
    else if (sortBy === 'clicks') sorted.sort((a, b) => (b.row.clickCount || 0) - (a.row.clickCount || 0) || ms(b) - ms(a));
    else sorted.sort((a, b) => ms(b) - ms(a)); // most recent
    return sorted;
  }, [scoped, search, sortBy]);

  if (!user) return <div style={{ padding: '1.5rem', color: '#64748B' }}>Sign in to view email tracking.</div>;

  return (
    <div style={{ padding: '0.25rem 0.25rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>Email Tracking</h2>
        <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
          {selectedCampaign
            ? <>Opens &amp; clicks for <strong>{campaignLabel(selectedCampaign)}</strong>.</>
            : 'Opens & clicks for emails sent with tracking on.'}
        </span>
        {selectedCampaign && onOpenCampaign && (
          <button
            type="button"
            onClick={() => onOpenCampaign(selectedCampaign)}
            style={linkBtn}
          >Open campaign →</button>
        )}
      </div>

      {/* Accuracy note — set expectations the way an experienced HubSpot user reads these numbers. */}
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.74rem', lineHeight: 1.45, margin: '0.5rem 0 1rem' }}>
        <strong>Reading these numbers:</strong> the pixel travels inside the Outlook draft, so hits before the send (proof-reading it), automated scanner fetches, and the same client re-loading within 5 minutes are excluded — expand a send to see what was dropped. What's left is still directional: Apple Mail Privacy Protection pre-loads the pixel (inflating opens), Gmail proxies images (so location shows Google), and Outlook blocks images by default (so some real opens never register). <strong>Clicks are the hard signal.</strong>
      </div>

      {/* Shown only when the realtime read was blocked and we fell back to
          the server reader — a nudge to deploy the Firestore rules so
          live updates come back. Harmless if the reader keeps working. */}
      {fallback && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', borderRadius: 8, padding: '0.45rem 0.7rem', fontSize: '0.72rem', lineHeight: 1.45, margin: '0 0 1rem' }}>
          Loaded from the server. Live updates are off until the Firestore rules are deployed (<code>firebase deploy --only firestore:rules</code>); reload to refresh in the meantime.
        </div>
      )}

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
          Campaign
          <select
            value={campaignFilter}
            onChange={e => { setCampaignFilter(e.target.value); setExpanded(null); }}
            style={{ padding: '0.35rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'inherit', maxWidth: 260 }}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c, i) => (
              <option key={i} value={String(i)}>
                {campaignLabel(c)} ({countsByCampaign.counts.get(i) || 0})
              </option>
            ))}
            <option value="none">No campaign ({countsByCampaign.unlinked})</option>
          </select>
        </label>
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
          <div style={{ fontSize: '0.8rem' }}>Go to the <strong>Drafts</strong> tab, keep “Track opens &amp; clicks” checked, and download your drafts. Opens and clicks will show up here once recipients engage.</div>
        </div>
      ) : visible.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748B', border: '1px dashed #CBD5E1', borderRadius: 10 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 4 }}>No tracked emails match this filter</div>
          <div style={{ fontSize: '0.8rem' }}>
            {selectedCampaign
              ? <>Nothing tracked has gone out under “{selectedCampaign.subject}” yet — a send is matched to a campaign by its subject line.</>
              : 'Try a different search or campaign.'}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Recipient</th>
                <th style={th}>Subject</th>
                <th style={th}>Campaign</th>
                <th style={th} title="When the tracked draft was created. The tool doesn't send the mail — you do, from Outlook — so this is the draft's timestamp, not the send's.">Drafted</th>
                <th style={{ ...th, textAlign: 'center' }}>Opens</th>
                <th style={th}>Last open</th>
                <th style={{ ...th, textAlign: 'center' }}>Clicks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r, link, opens }) => {
                const isOpen = expanded === r.id;
                const clicked = (r.clickCount || 0) > 0;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    link={link}
                    opens={opens}
                    onOpenCampaign={onOpenCampaign}
                    isOpen={isOpen}
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

// Why an individual pixel hit didn't make the open count, as shown next to
// it in the expanded detail. 'counted' events get no label.
const OPEN_VERDICT_LABEL = {
  'pre-send': ['· before send', 'The pixel is inside the Outlook draft, so this hit landed before the email was sent — a preview of the draft, not a recipient.'],
  machine: ['· automated', "A scanner or preview bot fetched the pixel; no human read anything."],
  repeat: ['· repeat', 'The same client re-loaded the pixel within 5 minutes of its last hit — one read, re-rendered.'],
};

function FragmentRow({ r, link, opens: openSummary, onOpenCampaign, isOpen, clicked, onToggle }) {
  const opened = openSummary.count > 0;
  const excluded = describeExcludedOpens(openSummary);
  // Newest first, carrying each event's verdict. Falls back to the raw
  // events for a doc countOpens couldn't classify (no stored event detail).
  const opens = openSummary.events.length
    ? [...openSummary.events].reverse()
    : (Array.isArray(r.opens) ? [...r.opens].reverse().map(event => ({ event, verdict: 'counted' })) : []);
  const clicks = Array.isArray(r.clicks) ? [...r.clicks].reverse() : [];
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: isOpen ? '#F8FAFC' : 'transparent' }}>
        <td style={{ ...td, width: 28, color: '#94A3B8', textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</td>
        <td style={td}>
          <div style={{ fontWeight: 600 }}>{r.recipientName || '-'}</div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{r.to || ''}</div>
        </td>
        <td style={{ ...td, maxWidth: 280 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={r.subject || ''}>{r.subject || '-'}</div>
        </td>
        <td style={{ ...td, maxWidth: 200 }}>
          {link ? (
            <button
              type="button"
              title={`Open “${campaignLabel(link.campaign)}” on the Email Campaigns tab`}
              onClick={e => { e.stopPropagation(); onOpenCampaign?.(link.campaign); }}
              disabled={!onOpenCampaign}
              style={{
                ...linkBtn,
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
                cursor: onOpenCampaign ? 'pointer' : 'default',
              }}
            >{campaignLabel(link.campaign)}</button>
          ) : (
            <span style={{ color: '#94A3B8' }} title="No saved campaign matches this subject line">—</span>
          )}
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{fmtDateTime(r.createdAt)}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          <span title={excluded || undefined}>
            {opened ? <Pill tone="green">{openSummary.count}</Pill> : <Pill tone="grey">0</Pill>}
          </span>
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>
          {openSummary.lastOpenAt
            ? <span title={fmtDateTime(openSummary.lastOpenAt)}>{fmtRelative(openSummary.lastOpenAt)}</span>
            : '-'}
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          {clicked ? <Pill tone="blue">{r.clickCount}</Pill> : <Pill tone="grey">0</Pill>}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={8} style={{ padding: '0.75rem 1rem 1rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                  Opens ({openSummary.count})
                  {excluded && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: '#B45309' }} title={excluded}> · {openSummary.raw - openSummary.count} hit{openSummary.raw - openSummary.count === 1 ? '' : 's'} not counted</span>}
                </div>
                {opens.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No opens recorded yet.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {opens.map(({ event: ev, verdict }, i) => {
                      const label = OPEN_VERDICT_LABEL[verdict];
                      return (
                        <li key={i} style={{ fontSize: '0.76rem', color: label ? '#94A3B8' : '#334155', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, textDecoration: label ? 'line-through' : 'none' }}>{fmtDateTime(ev.at)}</span>
                          <span style={{ color: '#64748B' }}>· {location(ev)}</span>
                          <span style={{ color: '#94A3B8' }}>· {deviceFromUa(ev.ua)}</span>
                          {ev.proxied && <span style={{ color: '#B45309' }} title="Fetched through a mail-client image proxy, so the location is the proxy's, not the reader's. Still counted: the proxy fetches because someone opened the message.">· proxy</span>}
                          {label && <span style={{ color: '#B45309', fontWeight: 600 }} title={label[1]}>{label[0]}</span>}
                        </li>
                      );
                    })}
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
