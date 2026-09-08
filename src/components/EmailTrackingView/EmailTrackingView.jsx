// Email Tracking — a sub-tab of Draft Emails, sitting next to the composer
// and the campaign report that produce the rows it shows. Every email sent
// with tracking on, and what came back from it. Reads the server-written
// `emailTracking` collection live; the client never writes here.
//
// Each send is attributed to a saved email campaign by subject, so the
// dashboard can be narrowed to one campaign and the tiles then read as that
// campaign's engagement. The campaign name is a link across to
// the Email Campaigns tab.
//
// TWO THINGS ARE MEASURED HERE, and image loads are deliberately not one of
// them any more. The tracking pixel still rides along in every send and still
// does the one job it is good at — proving the mail arrived, which is what the
// Delivery column reads — but it was shown as a metric for a long time and it
// never earned the space. A load fires when Apple's privacy pre-fetch collects
// a message nobody has looked at, and never fires at all for the Outlook users
// who read every word, so the number moved for reasons that had nothing to do
// with the recipient. It sat at the widest column on the page and answered no
// question a seller actually has.
//
// What replaced it is depth on the click, which is the event a person has to
// choose to produce:
//
//   • Clicks are gated on the send time now, the way the pixel always was.
//     The links are rewritten inside the Outlook DRAFT, so following one while
//     proof-reading it used to count as the recipient clicking.
//   • A gateway that sweeps every link in a message inside a minute is scored
//     as a machine however innocent its user-agent looks.
//   • Sends addressed to the user's own address are marked as the tests they
//     are and kept out of the rates.
//   • The scheduling link is broken out from every other destination, because
//     "they opened your calendar" is a different sentence from "they clicked
//     something" — and because a click on it is NOT a booking, which is the
//     single most misread number on this page.
//
// Every click event carries a device and a location, and the expanded row
// shows both. That is not decoration: a gateway with an ordinary browser
// user-agent that follows exactly one link cannot be told from a reader by any
// rule, and the honest answer is to put the evidence in front of the person
// who can judge it rather than to invent a verdict.
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
// countOpens stays imported with the pixel still in the mail: the loads are no
// longer shown as a metric, but they remain the strongest delivery evidence
// there is, and the Delivery column reads them.
import { countOpens } from '../../utils/emailOpens';
import { countClicks, describeExcludedClicks, screeningEvidence } from '../../utils/emailClicks';
import { useSavedCampaigns, campaignForSubject, campaignLabel } from '../../hooks/useSavedCampaigns';
import { clicksByLink, linksForRow, linkLabel, isSchedulingLink } from '../../utils/emailLinks';
import { clickSignals } from '../../utils/emailSignals';
import { isSelfSend } from '../../utils/selfSends';
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

// Counted clicks on this send that landed on a scheduling link. Reads the
// classified events rather than the row, so a gateway sweeping the signature
// can't sort a recipient to the top of the follow-up list.
function bookingClicks(linkedRow) {
  let n = 0;
  for (const { event, verdict } of linkedRow?.clicks?.events || []) {
    if (verdict === 'counted' && isSchedulingLink(event?.url)) n += 1;
  }
  return n;
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

// Plain-English definitions of what this page measures, plus how each
// summary tile is derived from them.
//
// The definitions stay visible because they are the whole answer to "what
// does this number mean". Two of the three are events a person had to choose
// to produce; the third is what the mail system did with the message. The
// arithmetic, and the reasons a click is not always a person, sit in a
// collapsed <details> so the top of the page doesn't turn into an essay.
function MetricsExplainer() {
  return (
    <section
      aria-label="What clicks, replies and delivery mean"
      style={{ border: '1px solid #E2E8F0', background: '#fff', borderRadius: 10, padding: '0.7rem 0.85rem', margin: '0.6rem 0 0.75rem' }}
    >
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Clicks vs. replies vs. delivery
      </div>

      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #93C5FD', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1E40AF', marginBottom: 2 }}>Click — a link was followed</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Every web link in the body is rewritten to point at our redirector, which logs the click and forwards straight
            to the real page. A click is <strong>deliberate</strong> — somebody read far enough to act. If your only link is
            the scheduling link in your signature, then a click means <strong>they opened your calendar</strong>, and the
            row says <em>Opened booking page</em>. It does <strong>not</strong> mean they booked: that happens on the booking
            site and reaches you as its own notification. Clicks with no booking are people who looked and didn&rsquo;t commit.
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #6EE7B7', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#047857', marginBottom: 2 }}>Reply — they wrote back</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Matched from the campaign&rsquo;s HubSpot activity, with out-of-office and auto-replies filtered out. Nothing
            automated produces one, so it outranks everything else here — and it only shows on sends a saved campaign claims
            by subject line.
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260, borderLeft: '3px solid #CBD5E1', paddingLeft: '0.7rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: 2 }}>Delivery — did it arrive</div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Read from bounces, not from engagement: silence is not a failure. <strong>Confirmed</strong> means something in
            the message was fetched or clicked, which can only happen after it landed — including by a security scanner,
            since a scanner can only scan what it received. The invisible tracking image still travels with every send and
            still does this job; it is no longer shown as a metric of its own, because a fetch of it says nothing reliable
            about whether a person read anything.
          </div>
        </div>
      </div>

      <details style={{ marginTop: '0.7rem', borderTop: '1px dashed #E2E8F0', paddingTop: '0.55rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, color: '#1D4ED8' }}>
          How each number is counted, and when a click isn&rsquo;t a person
        </summary>
        <div style={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.55, marginTop: '0.5rem' }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>The tiles</div>
          <ul style={{ margin: '0 0 0.7rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li><strong>Tracked emails</strong> — drafts created with tracking on, inside the campaign filter above. Tests you sent yourself are shown in the table but left out of every rate below.</li>
            <li><strong>Delivered (%)</strong> — of the sends a campaign is watching, how many arrived without bouncing. Sends nobody is watching are left out rather than assumed delivered: no campaign means no bounce would have reached us, which is not the same as arriving.</li>
            <li><strong>Clicked (%)</strong> — how many emails had at least one link followed by a person.</li>
            <li><strong>Total clicks</strong> — every human click: the same link twice, or two different links in one email, each add one. Two clicks are two decisions, so they are never collapsed.</li>
            <li><strong>Booking page</strong> — clicks that landed on your scheduling link, and how many people they came from. The number to compare against your actual bookings: the gap is the people who opened your availability and didn&rsquo;t pick a slot.</li>
            <li><strong>Replied (%)</strong> — of the sends a saved campaign is tracking, how many wrote back. Sends no campaign claims are left out of both halves of that fraction rather than counted as silence, and so are bounced addresses: nobody received those, so they aren&rsquo;t recipients who chose not to answer.</li>
          </ul>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>Clicks that aren&rsquo;t people, and how they&rsquo;re caught</div>
          <ul style={{ margin: '0 0 0.7rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li><strong>You, proof-reading the draft.</strong> The links are rewritten inside the Outlook draft, so they work before the mail is sent. Any click before the send time is excluded and shown struck through when you expand the row.</li>
            <li><strong>Tests you sent yourself.</strong> A send addressed to your own address is marked <em>Test</em> and kept out of the rates — clearing the composer leaves your address in the To line on purpose, so these accumulate.</li>
            <li><strong>Security gateways that identify themselves.</strong> Mimecast, Proofpoint, Microsoft Defender and the rest name themselves in the request; those are excluded and the row says <em>Screened</em>.</li>
            <li><strong>Gateways that don&rsquo;t.</strong> Caught by behaviour instead: one machine following several different links inside a minute is a sweep, not a reader choosing between them.</li>
            <li><strong>What nothing can catch.</strong> A gateway with an ordinary browser user-agent that follows exactly <em>one</em> link is indistinguishable from a person, and a message whose only link is your signature gives it nowhere to give itself away. Expand the row and read the device and timing: a click seconds after the send, from a datacentre rather than the recipient&rsquo;s city, is a machine whatever the count says.</li>
          </ul>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>Reading a row</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li><strong>Clicks on separate days is the strongest shape here.</strong> A gateway scans a message once, when it arrives, and never comes back on Thursday.</li>
            <li><strong>A reply with no click is the best outcome on the page</strong> — someone read the message and answered it without needing to follow anything.</li>
            <li><strong>Delivered with no click is not a no.</strong> It is the ordinary state of most outreach, and it says nothing beyond the fact that the mail arrived.</li>
            <li><strong>A <em>Screened</em> row reads differently from every other row.</strong> A gateway is following links before the recipient sees them, which proves the mail arrived but usually means links are rewritten for the real reader — so a low count there says less than it would elsewhere.</li>
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
  const [sortBy, setSortBy] = useState('sent'); // 'sent' | 'clicks' | 'booking' | 'replies'
  const [search, setSearch] = useState('');
  // '' = every send, 'none' = sends no campaign claims, otherwise the saved
  // campaign's index (subjects aren't unique, so the index is the identity).
  const [campaignFilter, setCampaignFilter] = useState('');

  // Attribute every tracked send to a saved campaign once, up front, and
  // classify its clicks while we're there.
  //
  // Both the pixel and the links are injected into the Outlook DRAFT (see
  // api/outlook-draft.js), so both fire while the draft is still being
  // proof-read — the pixel when the preview pane renders it, a link when the
  // sender follows it to check that it works. countOpens() has gated on the
  // send time since it was written and countClicks() now does the same. The
  // send time isn't on the tracking doc (it only knows when its draft was
  // created), so it comes from the saved campaign that claims this send;
  // unclaimed sends keep their raw timeline.
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
      // Present-with-null and absent mean different things: a recipient the
      // campaign lists but has no send date for is known NOT sent (gate on,
      // every hit is a preview), while an address no campaign lists gets no
      // gate at all, because we'd have nothing to gate against.
      const gate = sent?.has(key) ? { sentAt: sent.get(key) ?? null } : undefined;
      const opens = gate ? countOpens(r, gate) : countOpens(r);
      const clicks = gate ? countClicks(r, gate) : countClicks(r);
      const replies = link ? replyByCampaign.get(link.index) : null;
      // null = nobody is tracking replies for this send (no campaign owns it).
      const reply = replies?.get(key) ?? null;
      const screening = screeningEvidence(clicks, opens);
      // What the SHAPE of the clicks says over and above the count: repeat
      // clicks across days, several places on several devices, a fast first
      // click, and whether the booking page was one of the destinations.
      // See emailSignals.js for why each is worth more than a raw total.
      const signals = clickSignals(clicks, { sentAt: sent?.get(key) ?? null, openSummary: opens });
      // A send addressed to the person who sent it. Kept and labelled rather
      // than hidden — a test send is the fastest way to confirm tracking works
      // at all — but excluded from every rate, where it would otherwise count
      // the sender's own clicking as a prospect's interest.
      const self = isSelfSend(r, user?.email);
      // Did it arrive? Answered from the bounce, not from engagement — silence
      // is not a failure. Delivery reads the RAW activity, not the filtered
      // counts: a scanner fetch is worthless as engagement and conclusive as
      // delivery, since a gateway can only scan mail it received. Pre-send
      // previews are the one kind that proves nothing — those are ours, before
      // it ever went out.
      const delivery = deliveryStatus(reply, {
        hasActivity: (opens.count + opens.machine) > 0 || (clicks.count + clicks.machine + clicks.sweep) > 0,
        sentAt: sent?.get(key) ?? null,
      });
      return { row: r, link, opens, clicks, reply, signals, delivery, screening, self };
    }),
    [rows, campaigns, sentAtByCampaign, replyByCampaign, user?.email],
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

  // Every rate on this page is measured over real outreach, so the sender's
  // own test sends are separated out once here rather than filtered at each
  // use. They stay in `scoped` — the table still shows them, labelled — and
  // are simply not part of any denominator.
  const outreach = useMemo(() => scoped.filter(l => !l.self), [scoped]);
  const selfSends = scoped.length - outreach.length;

  const stats = useMemo(() => {
    const trackedEmails = outreach.length;
    const totalClicks = outreach.reduce((a, l) => a + l.clicks.count, 0);
    const clickedEmails = outreach.filter(l => l.clicks.count > 0).length;
    const screenedEmails = outreach.filter(l => l.screening.screened).length;
    const clickRate = trackedEmails ? Math.round((clickedEmails / trackedEmails) * 100) : 0;
    // Reply rate is measured against the sends a campaign actually tracks
    // replies for, not against every tracked email — dividing by sends nobody
    // is watching for a reply would report a rate that only ever falls as
    // untracked drafts pile up.
    // A bounced address never received the email, so it is not a recipient who
    // chose not to answer — counting it as one understates the rate and hides
    // a data problem as a performance problem.
    const bouncedEmails = outreach.filter(l => l.reply?.bounced).length;
    // Measured only over sends a campaign is watching AND that went out —
    // a send nobody is watching has no bounce evidence either way, and
    // counting it as delivered would turn silence into a fact.
    const deliveryKnown = outreach.filter(l => isDeliveryKnown(l.delivery)).length;
    const deliveredEmails = outreach.filter(l => isDelivered(l.delivery)).length;
    const deliveryRate = deliveryKnown ? Math.round((deliveredEmails / deliveryKnown) * 100) : 0;
    const oooEmails = outreach.filter(l => l.reply?.outOfOffice && !l.reply?.replied).length;
    const replyTracked = outreach.filter(l => l.reply && !l.reply.bounced).length;
    const repliedEmails = outreach.filter(l => l.reply?.replied).length;
    const replyRate = replyTracked ? Math.round((repliedEmails / replyTracked) * 100) : 0;
    return { trackedEmails, totalClicks, clickedEmails, clickRate, replyTracked, repliedEmails, replyRate, bouncedEmails, oooEmails, deliveryKnown, deliveredEmails, deliveryRate, screenedEmails };
  }, [outreach]);

  // Which links are actually pulling, across whatever the campaign filter has
  // selected. Scoped rather than filtered by the search box, same as the tiles:
  // this is a property of the campaign, not of the current search.
  // Passes each row WITH the click summary already computed for it, so the
  // breakdown agrees with the tiles about which clicks were real — recomputing
  // here would lose the send-time gate and quietly count draft previews.
  const linkStats = useMemo(
    () => clicksByLink(outreach.map(l => ({ row: l.row, summary: l.clicks }))),
    [outreach],
  );

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
    if (sortBy === 'clicks') sorted.sort((a, b) => b.clicks.count - a.clicks.count || ms(b) - ms(a));
    // Booking-page clicks first: the shortlist of people who went to look at
    // the calendar is the one worth working before anything else on the page.
    else if (sortBy === 'booking') sorted.sort((a, b) => bookingClicks(b) - bookingClicks(a) || b.clicks.count - a.clicks.count || ms(b) - ms(a));
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
            : 'Clicks, replies & delivery for emails sent with tracking on.'}
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

      {/* Accuracy note — what is excluded from the click count, and the one
          case nothing can exclude. */}
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.74rem', lineHeight: 1.45, margin: '0.5rem 0 1rem' }}>
        <strong>Reading these numbers:</strong> the links are rewritten inside the Outlook draft, so clicks before the send
        (you proof-reading it), security-gateway scans, and one machine following several links inside a minute are all
        excluded — expand a send to see what was dropped and why. One case survives all of that: <strong>a gateway using an
        ordinary browser user-agent that follows a single link cannot be told apart from a person</strong>, and an email whose
        only link is your signature gives it nowhere to give itself away. Expand the row and read the device and timing —
        a click seconds after the send, from somewhere the recipient isn&rsquo;t, is a machine whatever the count says.
        <strong> A reply is the only signal nothing automated can produce.</strong>
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
        <div style={tile} title="Emails where at least one link was followed by a person. Clicks before the send (you proof-reading the draft), security-gateway scans, automated sweeps and your own test sends are all excluded.">
          <div style={tileNum}>{stats.clickedEmails}</div><div style={tileLabel}>Clicked ({stats.clickRate}%)</div>
        </div>
        <div style={tile} title="Every human click: the same link twice, or two different links in one email, each add one. Two clicks are two decisions, so repeats are never collapsed.">
          <div style={tileNum}>{stats.totalClicks}</div><div style={tileLabel}>Total clicks</div>
        </div>
        <div
          style={tile}
          title={linkStats.schedulingClicks
            ? `${linkStats.schedulingRecipients} ${linkStats.schedulingRecipients === 1 ? 'person' : 'people'} followed your scheduling link, ${linkStats.schedulingClicks} time${linkStats.schedulingClicks === 1 ? '' : 's'} — they went to look at your availability. This is NOT a count of bookings: whether they picked a slot happens on the booking site and reaches you as its own notification. Compare this number against the meetings actually in your calendar — the gap is the people who opened your availability and didn't commit, which is the best follow-up list on this page.`
            : 'Clicks that landed on your scheduling link. None yet in this selection. If your signature carries a booking link, this is the number to compare against the meetings actually in your calendar — a click here means somebody opened your availability, not that they booked.'}
        >
          <div style={tileNum}>{linkStats.schedulingClicks || 0}</div>
          <div style={tileLabel}>Booking page{linkStats.schedulingRecipients ? ` (${linkStats.schedulingRecipients})` : ''}</div>
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

      {(stats.bouncedEmails > 0 || stats.oooEmails > 0 || stats.screenedEmails > 0 || selfSends > 0) && (
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
          {selfSends > 0 && (
            <span
              title="Sends addressed to your own address — tests, not outreach. They are still listed in the table, marked Test, because a test send is the quickest way to confirm tracking is working at all. They are left out of every rate above, where your own clicking would otherwise read as a prospect's interest."
              style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569', borderRadius: 999, padding: '0.15rem 0.6rem', fontWeight: 600 }}
            >{selfSends} test send{selfSends === 1 ? '' : 's'} to yourself — not counted in the rates</span>
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
            <option value="clicks">Most clicks</option>
            <option value="booking">Opened booking page</option>
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
          <div style={{ fontSize: '0.8rem' }}>Go to the <strong>Drafts</strong> tab, keep “Track clicks &amp; delivery” checked, and download your drafts. Activity shows up here once recipients engage.</div>
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
                <th style={th} title="Whether the mail arrived, answered from bounces rather than from engagement — silence is not a failure. Confirmed means something in the message was fetched or clicked, which can only happen after delivery.">Delivery</th>
                <th style={{ ...th, textAlign: 'center' }} title="Times a link in the email was followed by a person. Clicks before the send, security-gateway scans and automated sweeps are excluded — expand a row to see what was dropped and why.">Clicks</th>
                <th style={th} title="When a link was last followed. A click in the last hour means someone is on your page right now.">Last click</th>
                <th style={th} title="What the pattern of clicks says beyond the count: whether the booking page was one of them, repeat clicks on separate days, clicks from several places on several devices (often a forward), a first click within the hour. Inferences, not facts — hover one for its reasoning.">Signals</th>
                <th style={{ ...th, textAlign: 'center' }} title="Whether the recipient wrote back, from the campaign's HubSpot activity. Out-of-office and auto-replies don't count. The one signal here a machine can't produce — so it outranks both of the columns to its left.">Replied</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row: r, link, clicks, reply, signals, delivery, screening, self }) => {
                const isOpen = expanded === r.id;
                return (
                  <FragmentRow
                    key={r.id}
                    r={r}
                    link={link}
                    clicks={clicks}
                    screening={screening}
                    reply={reply}
                    signals={signals}
                    delivery={delivery}
                    self={self}
                    onOpenCampaign={onOpenCampaign}
                    isOpen={isOpen}
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

// Why an individual click didn't make the count, as shown next to it in the
// expanded detail. 'counted' events get no label.
//
// Every exclusion is shown rather than silently subtracted. A number that
// quietly shrinks is a number nobody can check, and these three verdicts are
// exactly where a reader's own knowledge beats ours — the sender knows whether
// they were proof-reading a draft on Tuesday afternoon, and we don't.
const CLICK_VERDICT_LABEL = {
  'pre-send': ['· before send', 'The links are rewritten inside the Outlook draft, so this click landed before the email was sent — you following your own link while proof-reading it, not a recipient.'],
  machine: ['· scanned', 'A security gateway followed this link to scan it before the recipient saw the message. Not a person — but it does prove the mail arrived.'],
  sweep: ['· swept', 'One machine followed several different links in this message inside a minute. A reader picks a link; a scanner walks the whole message, so this is a gateway that did not identify itself in the ordinary way.'],
};

function FragmentRow({ r, link, clicks: clickSummary, screening, reply, signals = [], delivery, self, onOpenCampaign, isOpen, onToggle }) {
  const clicked = clickSummary.count > 0;
  // Newest first, carrying each click's verdict so an exclusion is visible as
  // the thing that was dropped rather than silently missing.
  const clicks = [...clickSummary.events].reverse();
  const excludedClicks = describeExcludedClicks(clickSummary, screening?.scanner);
  // Distinct destinations this recipient went to, for the Clicks tooltip —
  // the count alone doesn't say what they were interested in. Reads the
  // already-gated summary so it agrees with the number beside it.
  const rowLinks = linksForRow(r, clickSummary);
  const clickTitle = [
    rowLinks.map(l => `${l.label}${l.clicks > 1 ? ` ×${l.clicks}` : ''}`).join('\n'),
    excludedClicks,
  ].filter(Boolean).join('\n\n') || undefined;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: isOpen ? '#F8FAFC' : 'transparent' }}>
        <td style={{ ...td, width: 28, color: '#94A3B8', textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</td>
        <td style={td}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {r.recipientName || '-'}
            {self && (
              <span
                title="You sent this to yourself. It stays listed because a test send is the quickest way to confirm tracking is working — but it is left out of every rate above, where your own clicking would read as a prospect's interest."
                style={{ background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 999, padding: '0 0.4rem', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}
              >Test</span>
            )}
          </div>
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
          <span title={clickTitle}>
            {clicked ? <Pill tone="blue">{clickSummary.count}</Pill> : <Pill tone="grey">0</Pill>}
          </span>
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>
          {clickSummary.lastClickAt
            ? <span title={fmtDateTime(clickSummary.lastClickAt)}>{fmtRelative(clickSummary.lastClickAt)}</span>
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
                    ...(sig.key === 'booking'
                      ? { background: '#DBEAFE', color: '#1E40AF', border: '1px solid #BFDBFE' }
                      : sig.key === 'shared'
                        ? { background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }
                        : { background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0' }),
                  }}
                >{sig.label}</span>
              ))}
            </span>
          )}
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
          <td colSpan={10} style={{ padding: '0.75rem 1rem 1rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              {/* Every click, with the evidence that decides what it was.
                  Device and location are the whole reason this panel exists:
                  a gateway with a browser user-agent following one link is
                  invisible to every rule we have, and the reader can still
                  see that it fired from a datacentre eleven seconds after the
                  send. So the events are shown in full — excluded ones struck
                  through with their reason — rather than summarised into a
                  number that hides its own workings. */}
              <div style={{ flex: '1 1 420px', minWidth: 320 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
                  Clicks ({clickSummary.count})
                  {excludedClicks && (
                    <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: '#B45309' }} title={excludedClicks}>
                      {' '}· {clickSummary.raw - clickSummary.count} not counted
                    </span>
                  )}
                </div>
                {clicks.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                    No link clicks recorded yet.
                    {clickSummary.raw > 0 && ' Every click on this send was excluded — hover the count above for what was dropped.'}
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {clicks.map(({ event: ev, verdict }, i) => {
                      const label = CLICK_VERDICT_LABEL[verdict];
                      const booking = isSchedulingLink(ev?.url);
                      return (
                        <li key={i} style={{ fontSize: '0.76rem', color: label ? '#94A3B8' : '#334155' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <span style={{ fontWeight: 600, textDecoration: label ? 'line-through' : 'none' }}>{fmtDateTime(ev.at)}</span>
                            <span style={{ color: '#64748B' }}>· {location(ev)}</span>
                            {/* The device is the evidence no rule can weigh
                                for the reader, so it is never abbreviated
                                away — the full user-agent is on hover. */}
                            <span style={{ color: '#94A3B8' }} title={ev.ua || 'No user-agent was sent — no ordinary browser does that, which is why this was excluded.'}>· {deviceFromUa(ev.ua)}</span>
                            {label && <span style={{ color: '#B45309', fontWeight: 600 }} title={label[1]}>{label[0]}</span>}
                          </div>
                          {ev.url && (
                            <div>
                              <div style={{ color: booking ? '#1D4ED8' : '#1E40AF', fontWeight: 600 }}>
                                {linkLabel(ev.url)}
                                {booking && !label && (
                                  <span style={{ color: '#64748B', fontWeight: 500 }} title="They followed your scheduling link, so they went to look at your availability. Whether they picked a slot happens on the booking site and reaches you as its own notification — it is not recorded here.">
                                    {' '}— opened your availability, which is not a booking
                                  </span>
                                )}
                              </div>
                              <div style={{ color: '#64748B', wordBreak: 'break-all', fontSize: '0.72rem' }}>{ev.url}</div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div style={{ flex: '1 1 260px', minWidth: 240 }}>
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
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Delivery</div>
                <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700 }}>{DELIVERY_LABEL[delivery]}</span> — {DELIVERY_TITLE[delivery]}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
