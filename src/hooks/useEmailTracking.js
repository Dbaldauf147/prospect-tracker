import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/apiFetch';
import { countOpens, trackingMillis } from '../utils/emailOpens';

// Loads this user's email-tracking rows (the docs api/track-prepare writes
// when a draft is generated with "Track opens & clicks" on).
//
// Two-tier read, shared by the Email Tracking dashboard and the Email
// Campaign report so they can't drift apart:
//   1. A realtime Firestore listener, filtered by owner only — a
//      single-field equality filter, so no composite index is needed.
//   2. On permission-denied (the emailTracking read rule isn't deployed to
//      the project yet), a one-shot authenticated read through
//      /api/track-list, which uses the Admin SDK and bypasses rules.
//      `fallback` reports that we're on this path: no live updates.
export function useEmailTracking() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;

    const loadViaApi = async () => {
      try {
        const res = await apiFetch('/api/track-list');
        if (!res.ok) throw new Error(`track-list ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setRows(Array.isArray(data.items) ? data.items : []);
        setFallback(true);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('track-list fallback failed:', e?.message || e);
        setError('Failed to load tracking data');
        setLoading(false);
      }
    };

    const q = query(
      collection(db, 'emailTracking'),
      where('uid', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setFallback(false);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('emailTracking snapshot error:', err);
        if (err?.code === 'permission-denied') {
          loadViaApi();
          return;
        }
        if (cancelled) return;
        setError(err?.message || 'Failed to load tracking data');
        setLoading(false);
      }
    );
    return () => { cancelled = true; unsub(); };
  }, [user?.uid]);

  return { rows, loading, error, fallback };
}

// Normalize an address for joining tracking rows to campaign contacts.
export function normalizeTrackedEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim();
}

// Build the send-time map trackingByRecipient (and the tracking dashboard)
// gate opens on, from a campaign's contact rows.
//
// A contact row can list several addresses ("a@x; b@y"), and each gets the
// row's send date. A contact with no send date maps to NULL on purpose —
// "HubSpot has no record of this being sent", which is a different thing
// from an address the campaign never listed (absent from the map).
export function sentAtByRecipient(contacts) {
  const map = new Map();
  for (const c of contacts || []) {
    const sentAt = c?.sentDate || null;
    for (const part of String(c?.email || '').split(';')) {
      const key = normalizeTrackedEmail(part);
      if (!key) continue;
      // The same address can appear twice (duplicate rows, one sent and one
      // not). The earliest real send wins: anything after it can be genuine.
      const prev = map.get(key);
      if (prev === undefined || (sentAt && (!prev || sentAt < prev))) map.set(key, sentAt);
    }
  }
  return map;
}

// Build the reply map, from the same campaign contact rows sentAtByRecipient
// reads.
//
// A reply is the one signal on this page a machine can't manufacture: the open
// pixel fires for privacy pre-fetches and preview panes, and even a click can
// come from a link scanner, but somebody typed the reply. It is already
// computed — api/email-campaign.js pulls incoming HubSpot mail matched to the
// campaign's subject and drops out-of-office / auto-reply / bounce
// notifications before marking a contact replied — and the Email Campaigns tab
// has shown it all along. The tracking dashboard just never read it.
//
// Same multi-address handling as sentAtByRecipient: a contact row listing
// "a@x; b@y" marks both addresses. Where an address appears twice, a reply
// wins over no reply and the EARLIEST reply wins between two — first response
// is the one that matters.
//
// Returns a Map of normalized address to { replied, replyDate, repliedBy }.
// Absent from the map = no campaign claims the address, which is different
// from present-but-not-replied.
export function replyByRecipient(contacts) {
  const map = new Map();
  for (const c of contacts || []) {
    const entry = {
      replied: !!c?.replied,
      replyDate: c?.replyDate || null,
      repliedBy: c?.repliedBy || '',
      // Non-answers that aren't a no: the address failed, or their
      // auto-responder says they're away. api/email-campaign.js classifies
      // both out of the incoming mail it was already suppressing.
      bounced: !!c?.bounced,
      outOfOffice: !!c?.outOfOffice,
      oooSubject: c?.oooSubject || '',
    };
    for (const part of String(c?.email || '').split(';')) {
      const key = normalizeTrackedEmail(part);
      if (!key) continue;
      const prev = map.get(key);
      if (prev === undefined) { map.set(key, entry); continue; }
      // Merge the delivery facts rather than letting a later duplicate row
      // with neither flag erase one the earlier row recorded.
      entry.bounced = entry.bounced || prev.bounced;
      entry.outOfOffice = entry.outOfOffice || prev.outOfOffice;
      entry.oooSubject = entry.oooSubject || prev.oooSubject;
      if (!prev.replied && entry.replied) { map.set(key, entry); continue; }
      if (!prev.bounced && entry.bounced) { map.set(key, { ...prev, bounced: true }); continue; }
      if (!prev.outOfOffice && entry.outOfOffice) {
        map.set(key, { ...prev, outOfOffice: true, oooSubject: entry.oooSubject });
        continue;
      }
      if (prev.replied && entry.replied && entry.replyDate && prev.replyDate
        && entry.replyDate < prev.replyDate) {
        map.set(key, entry);
      }
    }
  }
  return map;
}

// Roll the tracking rows for one campaign subject up per recipient.
//
// A campaign matches HubSpot emails whose subject *contains* the campaign
// subject, so the same containment test is used here — that way a tracked
// draft whose subject picked up a prefix/suffix still counts. Recipients
// can appear more than once (a re-send mints a new tracking doc), so the
// counts are summed and the timestamps reduced to first-open / last-click.
//
// Opens are counted through countOpens() rather than read off the doc's
// openCount: the raw counter includes the sender's own pre-send previews of
// the draft, automated fetches and re-renders (see src/utils/emailOpens.js).
// Pass `sentAtByEmail` — a Map of normalized recipient address to that
// contact's send time, or null for a contact the campaign never sent to — to
// enable the pre-send rule. Addresses missing from the map keep their raw
// timeline, since we then have nothing to gate on.
//
// Returns a Map keyed by normalized recipient email:
//   { openCount, raw, preSend, machine, repeat,
//     clickCount, firstOpenAt, lastClickAt, sends }
export function trackingByRecipient(rows, subject, { sentAtByEmail } = {}) {
  const want = String(subject || '').trim().toLowerCase();
  const byEmail = new Map();
  if (!want) return byEmail;

  for (const r of rows || []) {
    if (!String(r?.subject || '').toLowerCase().includes(want)) continue;
    const key = normalizeTrackedEmail(r.to);
    if (!key) continue;
    // Present-with-null and absent mean different things here: a contact
    // known not to have been sent maps to null (gate on — every hit is a
    // pre-send preview), while an address the campaign doesn't list is
    // absent from the map, and gets no gate at all.
    const opens = sentAtByEmail?.has(key)
      ? countOpens(r, { sentAt: sentAtByEmail.get(key) ?? null })
      : countOpens(r);
    const prev = byEmail.get(key) || {
      openCount: 0, raw: 0, preSend: 0, machine: 0, repeat: 0,
      clickCount: 0, firstOpenAt: 0, lastClickAt: 0, sends: 0,
    };
    const firstOpen = opens.firstOpenAt;
    const lastClick = trackingMillis(r.lastClickAt);
    byEmail.set(key, {
      openCount: prev.openCount + opens.count,
      raw: prev.raw + opens.raw,
      preSend: prev.preSend + opens.preSend,
      machine: prev.machine + opens.machine,
      repeat: prev.repeat + opens.repeat,
      clickCount: prev.clickCount + (r.clickCount || 0),
      firstOpenAt: firstOpen && (!prev.firstOpenAt || firstOpen < prev.firstOpenAt) ? firstOpen : prev.firstOpenAt,
      lastClickAt: lastClick > prev.lastClickAt ? lastClick : prev.lastClickAt,
      sends: prev.sends + 1,
    });
  }
  return byEmail;
}
