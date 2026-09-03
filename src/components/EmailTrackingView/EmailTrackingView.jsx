// Email Tracking — a sub-tab of Draft Emails, sitting next to the composer
// and the campaign report that produce the rows it shows. Every email sent
// with tracking on (open pixel + rewritten links, injected when the draft
// was created) and the opens/clicks recorded against it. Reads the
// server-written `emailTracking` collection live; the client never writes here.
//
// Each send is attributed to a saved email campaign by subject, so the
// dashboard can be narrowed to one campaign and the tiles then read as that
// campaign's engagement. The campaign name is a link across to
// the Email Campaigns tab.
//
// A deliberate note on accuracy sits at the top of the table: opens are
// a directional signal (Apple Mail Privacy Protection pre-fetches the
// pixel, Gmail proxies it, Outlook blocks images by default), while
// clicks are a hard signal. Same limitations HubSpot has.
//
// Above that note, MetricsExplainer says in plain English what the three
// words mean — an image load is a passive fetch, a click is a deliberate
// action, a reply is a person writing back — because that difference is what
// every question about these numbers turns on: why clicks trail loads, why a
// send can click without ever loading, why a load is worth less than it looks.
//
// The pixel metric is called "image loads" and not "opens" on purpose. An open
// claims a person read the message, and the pixel cannot know that: Apple Mail
// Privacy Protection fetches it on delivery, a preview pane fetches it without
// anyone reading, and Outlook blocks it for people who did. Naming it after
// the mechanism keeps it from competing with the two columns that do mean
// somebody acted; what it's genuinely good for — recency, and comparing sends
// with each other — is called out where it's shown.
//
// Replies come from the saved campaign rosters, not from the tracking docs:
// api/email-campaign.js already matches HubSpot's incoming mail to a campaign
// subject and filters out-of-office / auto-reply / bounce notifications, and
// the Email Campaigns tab has shown the result all along. Only sends a
// campaign claims carry a reply status, so the column distinguishes "no reply"
// from "nobody is watching for one".

import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useEmailTracking, normalizeTrackedEmail, sentAtByRecipient, replyByRecipient } from '../../hooks/useEmailTracking';
import { countOpens, describeExcludedOpens } from '../../utils/emailOpens';
import { countClicks, describeExcludedClicks, screeningEvidence } from '../../utils/emailClicks';
import { useSavedCampaigns, campaignForSubject, campaignLabel } from '../../hooks/useSavedCampaigns';
import { clicksByLink, linksForRow, shortLinkLabel } from '../../utils/emailLinks';
import { engagementSignals } from '../../utils/emailSignals';
import { deliveryStatus, DELIVERY, DELIVERY_LABEL, DELIVERY_TITLE, isDelivered, isDeliveryKnown } from '../../utils/deliveryStatus';

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
    amber: { bg: '#FEF3C7', fg: '#92400E' },
    red: { bg: '#FEE2E2', fg: '#991B1B' },
  };
  const t = tones[tone] || tones.grey;
  return (
    <span style={{ display: 'inline-block', background: t.bg, color: t.fg, borderRadius: 999, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 700 }}>
      {children}
    </span>
  );
}

// Plain-English definitions of the two metrics, plus how each summary
// tile is derived from them.
//
// The definitions stay visible because they are the whole answer to
// "what's the difference": one is the recipient's mail client fetching an
// image, the other is a person choosing to click. The arithmetic behind
// the tiles — and the reasons the two columns rarely agree — sits in a
// collapsed <details> so the top of the page doesn't turn into an essay.
function MetricsExplainer() {
  return (
    <section
      aria-label="What image loads, clicks and replies mean"
      style={{ border: '1px solid #E2E8F0', background: '#fff', borderRadius: 10, padding: '0.7rem 0.85rem', margin: '0.6rem 0 0.75rem' }}
    >
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Image loads vs. clicks vs. replies
      </div>

      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #86EFAC', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534', marginBottom: 2 }}>Image load — something fetched the pixel</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            An invisible 1×1 image is tucked into the email body, and this counts the times it was fetched. Deliberately not
            called an &ldquo;open&rdquo;: <strong>nobody has to read anything for it to fire</strong> — a preview pane or Apple&rsquo;s
            privacy pre-fetch will do it — and a client that blocks images never fires it at all, so a real read can go
            unrecorded. Useful for <em>when</em> (a load in the last hour means it&rsquo;s in front of someone now) and for
            comparing one send against another. Not for judging one person&rsquo;s interest.
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #93C5FD', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E40AF', marginBottom: 2 }}>Click — a link was followed</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Every web link in the body is rewritten to point at our redirector, which logs the click and forwards straight to
            the real page. A click is <strong>deliberate</strong> — a person read far enough to act — which makes it the better
            of the two when they disagree. Not infallible: corporate security gateways follow every link to scan it, so those
            are excluded here the same way scanner pixel fetches are, and the row says <em>Screened</em> when it sees one.
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #6EE7B7', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#047857', marginBottom: 2 }}>Reply — they wrote back</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Matched from the campaign&rsquo;s HubSpot activity, with out-of-office and auto-replies filtered out. Nothing
            automated produces one, so it outranks both of the others — and it only shows on sends a saved campaign claims by
            subject line.
          </div>
        </div>
      </div>

      <details style={{ marginTop: '0.7rem', borderTop: '1px dashed #E2E8F0', paddingTop: '0.55rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, color: '#1D4ED8' }}>
          How each number is counted, and why the three don&rsquo;t line up
        </summary>
        <div style={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.55, marginTop: '0.5rem' }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>The tiles</div>
          <ul style={{ margin: '0 0 0.7rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li><strong>Tracked emails</strong> — drafts created with tracking on, inside the campaign filter above.</li>
            <li><strong>Delivered (%)</strong> — of the sends a campaign is watching, how many arrived without bouncing. This is the question an &ldquo;open&rdquo; looks like it answers and doesn&rsquo;t: a pixel proves arrival when it fires, but proves nothing when it doesn&rsquo;t, so delivery is read off bounces instead. Sends nobody is watching are left out rather than assumed delivered.</li>
            <li><strong>Images loaded (%)</strong> — how many of those emails had the pixel fetched at least once. One recipient counts once here however many times it fires.</li>
            <li><strong>Total image loads</strong> — every fetch. The same person coming back an hour later adds two.</li>
            <li><strong>Clicked (%)</strong> — how many emails had at least one link followed.</li>
            <li><strong>Total clicks</strong> — every human click: the same link twice, or two different links in one email, each add one. Repeat clicks are <em>not</em> collapsed the way repeat image loads are: two clicks are two decisions, where two loads are one message re-rendered.</li>
            <li><strong>Replied (%)</strong> — of the sends a saved campaign is tracking, how many wrote back. Sends no campaign claims are left out of both halves of that fraction rather than counted as silence, and so are bounced addresses: nobody received those, so they aren&rsquo;t recipients who chose not to answer.</li>
          </ul>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>When they disagree</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li><strong>Clicks well below image loads is normal.</strong> Being shown a message costs nothing; clicking is a decision. The gap between the two is roughly the gap between attention and interest.</li>
            <li><strong>A click with no image load is normal too</strong> — the reader&rsquo;s client blocked the image, so the pixel never fired, but the link still worked. Read that row as engaged, not as a glitch.</li>
            <li><strong>An image load with no click isn&rsquo;t nothing</strong>, but it is the weakest of the three, and a zero is weaker still: it is as likely to be Outlook blocking images as it is disinterest.</li>
            <li><strong>A <em>Screened</em> row reads differently from every other row.</strong> A security gateway is fetching the links and the pixel before the recipient sees them, which proves the mail arrived but usually means images are blocked and links rewritten for the real reader — so low numbers there say less than they would elsewhere.</li>
            <li><strong>A reply with no load or click happens</strong>, and it is the best outcome on the page — someone read the message in a client that blocked the image and answered it without following a link.</li>
          </ul>
        </div>
      </details>
    </section>
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
  const [sortBy, setSortBy] = useState('sent'); // 'sent' | 'opens' | 'clicks' | 'replies'
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
  // Replies come off the same campaign rosters as the send times — the Email
  // Campaigns tab has had them all along, matched from HubSpot's incoming mail
  // with out-of-office / auto-reply / bounce notifications already filtered
  // out. A send with no campaign claiming it has no reply status at all, which
  // is not the same as "no reply": the column says so rather than showing a
  // dash that reads as silence.
  const replyByCampaign = useMemo(() => {
    const map = new Map();
    (campaigns || []).forEach((c, index) => map.set(index, replyByRecipient(c?.contacts)));
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
      const replies = link ? replyByCampaign.get(link.index) : null;
      // null = nobody is tracking replies for this send (no campaign owns it).
      const reply = replies?.get(key) ?? null;
      // What the SHAPE of the opens says, over and above the count — repeat
      // reads across days, several places on several devices, a fast first
      // open. See emailSignals.js for why each is worth more than a raw open.
      // Clicks go through the same scanner filter the pixel has always used.
      // A security gateway following every link in the message was the one
      // number on this page with nothing filtering it at all.
      const clicks = countClicks(r);
      const screening = screeningEvidence(clicks, opens);
      const signals = engagementSignals(opens, { sentAt: sent?.get(key) ?? null, clickSummary: clicks });
      // Did it arrive? Answered from the bounce, not from the pixel — a pixel
      // that never loaded is silence, not a failure. Counted loads only, so
      // the sender's own draft previews don't stand in as proof of delivery.
      // Delivery reads the RAW activity, not the filtered counts: a scanner
      // fetch is worthless as engagement and conclusive as delivery, since a
      // gateway can only scan mail it received. Pre-send previews are the one
      // kind that proves nothing — those are ours, before it ever went out.
      const delivery = deliveryStatus(reply, {
        hasActivity: (opens.count + opens.machine) > 0 || clicks.raw > 0,
        sentAt: sent?.get(key) ?? null,
      });
      return { row: r, link, opens, clicks, reply, signals, delivery, screening };
    }),
    [rows, campaigns, sentAtByCampaign, replyByCampaign],
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
    const totalClicks = scoped.reduce((a, l) => a + l.clicks.count, 0);
    const clickedEmails = scoped.filter(l => l.clicks.count > 0).length;
    const screenedEmails = scoped.filter(l => l.screening.screened).length;
    const openRate = trackedEmails ? Math.round((openedEmails / trackedEmails) * 100) : 0;
    const clickRate = trackedEmails ? Math.round((clickedEmails / trackedEmails) * 100) : 0;
    // Reply rate is measured against the sends a campaign actually tracks
    // replies for, not against every tracked email — dividing by sends nobody
    // is watching for a reply would report a rate that only ever falls as
    // untracked drafts pile up.
    // A bounced address never received the email, so it is not a recipient who
    // chose not to answer — counting it as one understates the rate and hides
    // a data problem as a performance problem.
    const bouncedEmails = scoped.filter(l => l.reply?.bounced).length;
    // Measured only over sends a campaign is watching AND that went out —
    // a send nobody is watching has no bounce evidence either way, and
    // counting it as delivered would turn silence into a fact.
    const deliveryKnown = scoped.filter(l => isDeliveryKnown(l.delivery)).length;
    const deliveredEmails = scoped.filter(l => isDelivered(l.delivery)).length;
    const deliveryRate = deliveryKnown ? Math.round((deliveredEmails / deliveryKnown) * 100) : 0;
    const oooEmails = scoped.filter(l => l.reply?.outOfOffice && !l.reply?.replied).length;
    const replyTracked = scoped.filter(l => l.reply && !l.reply.bounced).length;
    const repliedEmails = scoped.filter(l => l.reply?.replied).length;
    const replyRate = replyTracked ? Math.round((repliedEmails / replyTracked) * 100) : 0;
    return { trackedEmails, totalOpens, openedEmails, totalClicks, clickedEmails, openRate, clickRate, replyTracked, repliedEmails, replyRate, bouncedEmails, oooEmails, deliveryKnown, deliveredEmails, deliveryRate, screenedEmails };
  }, [scoped]);

  // Which links are actually pulling, across whatever the campaign filter has
  // selected. Scoped rather than filtered by the search box, same as the tiles:
  // this is a property of the campaign, not of the current search.
  const linkStats = useMemo(() => clicksByLink(scoped.map(l => l.row)), [scoped]);

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
    else if (sortBy === 'clicks') sorted.sort((a, b) => b.clicks.count - a.clicks.count || ms(b) - ms(a));
    else if (sortBy === 'replies') sorted.sort((a, b) => (b.reply?.replied ? 1 : 0) - (a.reply?.replied ? 1 : 0) || ms(b) - ms(a));
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
            ? <>Activity for <strong>{campaignLabel(selectedCampaign)}</strong>.</>
            : 'Image loads, clicks & replies for emails sent with tracking on.'}
        </span>
        {selectedCampaign && onOpenCampaign && (
          <button
            type="button"
            onClick={() => onOpenCampaign(selectedCampaign)}
            style={linkBtn}
          >Open campaign →</button>
        )}
      </div>

      {/* What the two words mean, before the caveats about how well we
          measure them. */}
      <MetricsExplainer />

      {/* Accuracy note — set expectations the way an experienced HubSpot user reads these numbers. */}
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.74rem', lineHeight: 1.45, margin: '0.5rem 0 1rem' }}>
        <strong>Reading these numbers:</strong> the pixel travels inside the Outlook draft, so hits before the send (proof-reading it), automated scanner fetches, and the same client re-loading within 5 minutes are excluded — expand a send to see what was dropped. What's left is still directional: Apple Mail Privacy Protection pre-loads the pixel (inflating the count), Gmail proxies images (so location shows Google), and Outlook blocks images by default (so plenty of real reads never register). <strong>Clicks are the better signal — scanner sweeps excluded — and a reply is the best.</strong>
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
        <div style={tile} title="Drafts created with tracking on, within the campaign filter.">
          <div style={tileNum}>{stats.trackedEmails}</div><div style={tileLabel}>Tracked emails</div>
        </div>
        <div
          style={tile}
          title={stats.deliveryKnown
            ? `${stats.deliveredEmails} of the ${stats.deliveryKnown} send${stats.deliveryKnown === 1 ? '' : 's'} a campaign is watching arrived without bouncing. Sends nobody is watching are left out — no campaign means no bounce would have reached us, which is not the same as delivered.`
            : 'No send here belongs to a saved campaign, so nothing was watching for a bounce and delivery can\'t be established either way.'}
        >
          <div style={tileNum}>{stats.deliveryKnown ? stats.deliveredEmails : '—'}</div>
          <div style={tileLabel}>{stats.deliveryKnown ? `Delivered (${stats.deliveryRate}%)` : 'Delivered'}</div>
        </div>
        <div style={tile} title="Emails whose tracking pixel was fetched at least once. Not the same as being read: a preview pane or a privacy pre-fetch counts, and a client that blocks images never fires it.">
          <div style={tileNum}>{stats.openedEmails}</div><div style={tileLabel}>Images loaded ({stats.openRate}%)</div>
        </div>
        <div style={tile} title="Every fetch of the pixel, not just the first: the same recipient coming back later adds another.">
          <div style={tileNum}>{stats.totalOpens}</div><div style={tileLabel}>Total image loads</div>
        </div>
        <div style={tile} title="Emails where at least one link was followed by a person. Security-gateway link scans are excluded, the same way they are for image loads.">
          <div style={tileNum}>{stats.clickedEmails}</div><div style={tileLabel}>Clicked ({stats.clickRate}%)</div>
        </div>
        <div style={tile} title="Every human click: the same link twice, or two different links in one email, each add one. Repeat clicks are NOT collapsed the way repeat image loads are — two clicks are two decisions, where two loads are one message re-rendered.">
          <div style={tileNum}>{stats.totalClicks}</div><div style={tileLabel}>Total clicks</div>
        </div>
        <div
          style={tile}
          title={stats.replyTracked
            ? `Recipients who wrote back, out of the ${stats.replyTracked} send${stats.replyTracked === 1 ? '' : 's'} a saved campaign is tracking replies for. Out-of-office and auto-replies don't count.`
            : 'No send here belongs to a saved campaign, so no replies are being tracked. Match a campaign by subject line on the Email Campaigns tab.'}
        >
          <div style={tileNum}>{stats.replyTracked ? stats.repliedEmails : '—'}</div>
          <div style={tileLabel}>{stats.replyTracked ? `Replied (${stats.replyRate}%)` : 'Replied'}</div>
        </div>
      </div>

      {(stats.bouncedEmails > 0 || stats.oooEmails > 0 || stats.screenedEmails > 0) && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.74rem' }}>
          {stats.bouncedEmails > 0 && (
            <span
              title="The mail server rejected these addresses, so nobody saw the email. They are left out of the reply rate — a bad address is a data problem, not a recipient who chose not to answer."
              style={{ background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 999, padding: '0.15rem 0.6rem', fontWeight: 600 }}
            >{stats.bouncedEmails} bounced — fix the address{stats.bouncedEmails === 1 ? '' : 'es'}</span>
          )}
          {stats.oooEmails > 0 && (
            <span
              title="Their auto-responder answered. Not a no — hover the row to see what it said, and try again when they are back."
              style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 999, padding: '0.15rem 0.6rem', fontWeight: 600 }}
            >{stats.oooEmails} out of office — worth a second send</span>
          )}
          {stats.screenedEmails > 0 && (
            <span
              title="A security gateway fetched the links or the pixel before these recipients saw them. Those hits are excluded from the counts above. It also means the mail arrived — a scanner can only scan what it received — and that images and links are likely rewritten or blocked for the real reader, so low numbers on these rows say less than usual."
              style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF', borderRadius: 999, padding: '0.15rem 0.6rem', fontWeight: 600 }}
            >{stats.screenedEmails} screened by a security gateway</span>
          )}
        </div>
      )}

      <LinkBreakdown stats={linkStats} />

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
            <option value="opens">Most image loads</option>
            <option value="clicks">Most clicks</option>
            <option value="replies">Replied first</option>
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
          <div style={{ fontSize: '0.8rem' }}>Go to the <strong>Drafts</strong> tab, keep “Track image loads &amp; clicks” checked, and download your drafts. Activity shows up here once recipients engage.</div>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1140 }}>
            <thead>
              <tr>
                <th style={th}></th>
                <th style={th}>Recipient</th>
                <th style={th}>Subject</th>
                <th style={th}>Campaign</th>
                <th style={th} title="When the tracked draft was created. The tool doesn't send the mail — you do, from Outlook — so this is the draft's timestamp, not the send's.">Drafted</th>
                <th style={th} title="Whether the mail arrived, answered from bounces rather than from the pixel — a pixel that never loaded is silence, not a failure. Confirmed means something was fetched or clicked, which can only happen after delivery.">Delivery</th>
                <th style={{ ...th, textAlign: 'center' }} title="Times the email's tracking pixel was fetched. Passive — a preview pane or a privacy pre-fetch fires it, and a client that blocks images never does — so treat it as a weak signal, and a zero as no signal at all.">Loads</th>
                <th style={th} title="When the pixel was last fetched. The most useful thing this metric gives you: a load in the last hour means the message is in front of someone now.">Last load</th>
                <th style={th} title="What the pattern of opens says beyond the count: repeat reads on separate days, opens from several places on several devices (often a forward), a first open within the hour. Inferences, not facts — hover one for its reasoning.">Signals</th>
                <th style={{ ...th, textAlign: 'center' }} title="Times a link in the email was followed. Deliberate, so a click counts for more than any number of image loads — and can happen on a send that never registered one.">Clicks</th>
                <th style={{ ...th, textAlign: 'center' }} title="Whether the recipient wrote back, from the campaign's HubSpot activity. Out-of-office and auto-replies don't count. The one signal here a machine can't produce — so it outranks both of the columns to its left.">Replied</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r, link, opens, clicks, reply, signals, delivery, screening }) => {
                const isOpen = expanded === r.id;
                const clicked = clicks.count > 0;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    link={link}
                    opens={opens}
                    clicks={clicks}
                    screening={screening}
                    reply={reply}
                    signals={signals}
                    delivery={delivery}
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

// Which links the campaign's clicks actually landed on.
//
// A click count on its own says somebody engaged; it doesn't say with what,
// and "opened the savings analysis" is a different conversation from "clicked
// the logo". The redirector has always logged the destination, so this is a
// roll-up of data already on the page — one bar per link, ordered by clicks,
// with the distinct-recipient count beside it because one person clicking five
// times is not five people interested.
function LinkBreakdown({ stats }) {
  const { links, totalClicks, unattributed } = stats;
  if (!links.length) return null;
  const top = links[0].clicks || 1;
  return (
    <details style={{ border: '1px solid #E2E8F0', background: '#fff', borderRadius: 10, padding: '0.55rem 0.85rem', marginBottom: '0.75rem' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#1D4ED8' }}>
        Which links were clicked
        <span style={{ color: '#64748B', fontWeight: 500 }}>
          {' '}— {links.length} link{links.length === 1 ? '' : 's'} across {totalClicks} click{totalClicks === 1 ? '' : 's'}
        </span>
      </summary>
      <ul style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {links.map((l) => (
          <li key={l.url} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 240px', minWidth: 200, fontSize: '0.78rem', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.url}>
              {l.label}
            </span>
            <span style={{ flex: '2 1 200px', minWidth: 120, height: 8, background: '#F1F5F9', borderRadius: 999, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.round((l.clicks / top) * 100)}%`, height: '100%', background: '#3B82F6', borderRadius: 999 }} />
            </span>
            <span style={{ fontSize: '0.76rem', color: '#1E293B', fontWeight: 600, minWidth: 96, textAlign: 'right' }}>
              {l.clicks} click{l.clicks === 1 ? '' : 's'}
            </span>
            <span style={{ fontSize: '0.74rem', color: '#94A3B8', minWidth: 92 }} title="Distinct recipients who clicked this link. One person clicking it five times is one recipient.">
              {l.recipients} recipient{l.recipients === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
      {unattributed > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#B45309', marginTop: 6 }}>
          {unattributed} click{unattributed === 1 ? '' : 's'} can&rsquo;t be attributed to a link: a send&rsquo;s stored click
          history is capped, so the counters ran past the detail. The totals above are unaffected.
        </div>
      )}
    </details>
  );
}

// Why an individual pixel hit didn't make the open count, as shown next to
// it in the expanded detail. 'counted' events get no label.
const OPEN_VERDICT_LABEL = {
  'pre-send': ['· before send', 'The pixel is inside the Outlook draft, so this hit landed before the email was sent — a preview of the draft, not a recipient.'],
  machine: ['· automated', "A scanner or preview bot fetched the pixel; no human read anything."],
  repeat: ['· repeat', 'The same client re-loaded the pixel within 5 minutes of its last hit — one read, re-rendered.'],
};

function FragmentRow({ r, link, opens: openSummary, clicks: clickSummary, screening, reply, signals = [], delivery, onOpenCampaign, isOpen, clicked, onToggle }) {
  const opened = openSummary.count > 0;
  const excluded = describeExcludedOpens(openSummary);
  // Newest first, carrying each event's verdict. Falls back to the raw
  // events for a doc countOpens couldn't classify (no stored event detail).
  const opens = openSummary.events.length
    ? [...openSummary.events].reverse()
    : (Array.isArray(r.opens) ? [...r.opens].reverse().map(event => ({ event, verdict: 'counted' })) : []);
  // Newest first, carrying each click's verdict so a scanner sweep is visible
  // as the thing that was dropped rather than silently missing.
  const clicks = [...clickSummary.events].reverse();
  const excludedClicks = describeExcludedClicks(clickSummary, screening?.scanner);
  // Distinct destinations this recipient went to, for the Clicks tooltip —
  // the count alone doesn't say what they were interested in.
  const rowLinks = linksForRow(r);
  const clickTitle = [
    rowLinks.map(l => `${l.label}${l.clicks > 1 ? ` ×${l.clicks}` : ''}`).join('\n'),
    excludedClicks,
  ].filter(Boolean).join('\n\n') || undefined;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: isOpen ? '#F8FAFC' : 'transparent' }}>
        <td style={{ ...td, width: 28, color: '#94A3B8', textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</td>
        <td style={td}>
          <div style={{ fontWeight: 600 }}>{r.recipientName || '-'}</div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{r.to || ''}</div>
        </td>
        <td style={{ ...td, maxWidth: 220 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={r.subject || ''}>{r.subject || '-'}</div>
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
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          <span title={DELIVERY_TITLE[delivery]} style={{
            display: 'inline-block', borderRadius: 999, padding: '0.05rem 0.45rem',
            fontSize: '0.7rem', fontWeight: 600,
            ...(delivery === DELIVERY.FAILED ? { background: '#FEE2E2', color: '#991B1B' }
              : delivery === DELIVERY.CONFIRMED ? { background: '#DCFCE7', color: '#166534' }
              : delivery === DELIVERY.DELIVERED ? { background: '#F1F5F9', color: '#334155' }
              : { background: 'transparent', color: '#94A3B8' }),
          }}>{DELIVERY_LABEL[delivery]}</span>
        </td>
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
        <td style={{ ...td, maxWidth: 230 }}>
          {signals.length === 0 ? (
            <span style={{ color: '#CBD5E1' }}>—</span>
          ) : (
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {signals.map(sig => (
                <span
                  key={sig.key}
                  title={sig.title}
                  style={{
                    display: 'inline-block', borderRadius: 999, padding: '0.05rem 0.45rem',
                    fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap',
                    background: sig.key === 'shared' ? '#FEF3C7' : '#F1F5F9',
                    color: sig.key === 'shared' ? '#92400E' : '#475569',
                    border: `1px solid ${sig.key === 'shared' ? '#FDE68A' : '#E2E8F0'}`,
                  }}
                >{sig.label}</span>
              ))}
            </span>
          )}
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          <span title={clickTitle}>
            {clicked ? <Pill tone="blue">{clickSummary.count}</Pill> : <Pill tone="grey">0</Pill>}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          {!reply ? (
            <span style={{ color: '#CBD5E1' }} title="No saved campaign claims this send, so nothing is watching for a reply to it. Replies are matched to a campaign by subject line.">—</span>
          ) : reply.replied ? (
            <span title={[reply.repliedBy && `Replied by ${reply.repliedBy}`, reply.replyDate && fmtDateTime(reply.replyDate)].filter(Boolean).join(' · ') || undefined}>
              <Pill tone="green">Replied</Pill>
            </span>
          ) : reply.bounced ? (
            // The Delivery column carries the bounce itself; here it only
            // explains the silence, so a reader doesn't read a dead address as
            // a recipient who ignored them.
            <span style={{ color: '#94A3B8', fontSize: '0.72rem' }} title="Never delivered — see the Delivery column. This is not a recipient who chose not to answer.">n/a</span>
          ) : reply.outOfOffice ? (
            <span title={reply.oooSubject
              ? `Their auto-responder replied: "${reply.oooSubject}". Not a no — usually worth a second send when they're back.`
              : 'Their auto-responder replied. Not a no — usually worth a second send when they are back.'}>
              <Pill tone="amber">Out of office</Pill>
            </span>
          ) : (
            <span style={{ color: '#94A3B8', fontSize: '0.72rem' }} title="This send is in a campaign that tracks replies, and no reply has come in.">No reply</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={11} style={{ padding: '0.75rem 1rem 1rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                  Image loads ({openSummary.count})
                  {excluded && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: '#B45309' }} title={excluded}> · {openSummary.raw - openSummary.count} hit{openSummary.raw - openSummary.count === 1 ? '' : 's'} not counted</span>}
                </div>
                {opens.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No image loads recorded yet.</div>
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
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Reply</div>
                <div style={{ fontSize: '0.78rem', color: reply?.replied ? '#334155' : '#94A3B8', marginBottom: '0.9rem' }}>
                  {!reply
                    ? 'Not tracked — no saved campaign claims this send.'
                    : reply.replied
                      ? <>
                          <span style={{ fontWeight: 600 }}>{reply.repliedBy || 'Replied'}</span>
                          {reply.replyDate && <span style={{ color: '#64748B' }}> · {fmtDateTime(reply.replyDate)}</span>}
                        </>
                      : 'No reply yet.'}
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                  Clicks ({clickSummary.count})
                  {excludedClicks && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: '#B45309' }} title={excludedClicks}> · {clickSummary.machine} scanned</span>}
                </div>
                {clicks.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No link clicks recorded yet.</div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {clicks.map(({ event: ev, verdict }, i) => (
                      <li key={i} style={{ fontSize: '0.76rem', color: verdict === 'machine' ? '#94A3B8' : '#334155' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, textDecoration: verdict === 'machine' ? 'line-through' : 'none' }}>{fmtDateTime(ev.at)}</span>
                          <span style={{ color: '#64748B' }}>· {location(ev)}</span>
                          {verdict === 'machine' && (
                            <span style={{ color: '#B45309', fontWeight: 600 }} title="A security gateway followed this link to scan it before the recipient saw the message. Not a person, so it isn't counted — but it does prove the mail arrived.">· scanned</span>
                          )}
                        </div>
                        {ev.url && (
                          <div>
                            <div style={{ color: '#1E40AF', fontWeight: 600 }}>{shortLinkLabel(ev.url)}</div>
                            <div style={{ color: '#64748B', wordBreak: 'break-all', fontSize: '0.72rem' }}>{ev.url}</div>
                          </div>
                        )}
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
