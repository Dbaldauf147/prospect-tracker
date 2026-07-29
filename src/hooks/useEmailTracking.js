import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/apiFetch';

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

// Roll the tracking rows for one campaign subject up per recipient.
//
// A campaign matches HubSpot emails whose subject *contains* the campaign
// subject, so the same containment test is used here — that way a tracked
// draft whose subject picked up a prefix/suffix still counts. Recipients
// can appear more than once (a re-send mints a new tracking doc), so the
// counts are summed and the timestamps reduced to first-open / last-click.
//
// Returns a Map keyed by normalized recipient email:
//   { openCount, clickCount, firstOpenAt, lastClickAt, sends }
export function trackingByRecipient(rows, subject) {
  const want = String(subject || '').trim().toLowerCase();
  const byEmail = new Map();
  if (!want) return byEmail;

  const millis = (t) => {
    if (!t) return 0;
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (typeof t._seconds === 'number') return t._seconds * 1000;
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    const parsed = new Date(t).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  for (const r of rows || []) {
    if (!String(r?.subject || '').toLowerCase().includes(want)) continue;
    const key = normalizeTrackedEmail(r.to);
    if (!key) continue;
    const prev = byEmail.get(key) || {
      openCount: 0, clickCount: 0, firstOpenAt: 0, lastClickAt: 0, sends: 0,
    };
    const firstOpen = millis(r.firstOpenAt);
    const lastClick = millis(r.lastClickAt);
    byEmail.set(key, {
      openCount: prev.openCount + (r.openCount || 0),
      clickCount: prev.clickCount + (r.clickCount || 0),
      firstOpenAt: firstOpen && (!prev.firstOpenAt || firstOpen < prev.firstOpenAt) ? firstOpen : prev.firstOpenAt,
      lastClickAt: lastClick > prev.lastClickAt ? lastClick : prev.lastClickAt,
      sends: prev.sends + 1,
    });
  }
  return byEmail;
}
