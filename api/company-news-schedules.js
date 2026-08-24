// Authenticated CRUD for Company Acquisition News email schedules, backed
// by the admin SDK so it doesn't depend on client-side Firestore rules
// (the cron reads the same collection the same way). Single POST entry
// point with an `action` so same-origin calls never need a preflight.
//
// Body: { action: 'list' }
//       { action: 'create', schedule: {...} } -> { id }
//       { action: 'update', id, schedule: {...} } -> { ok }
//       { action: 'setEnabled', id, enabled } -> { ok }
//       { action: 'delete', id } -> { ok }
//
// Mirrors api/pe-opps-schedules.js: the client computes the timezone-aware
// recurrence fields (it knows the user's local zone); the server still
// re-validates and forces ownerUid / ownerEmail from the verified token so
// a caller can't write someone else's schedule.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';

const COLLECTION = 'companyNewsEmailSchedules';

function clampInt(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Whitelist + coerce the client payload into a storable doc. Never trusts
// ownerUid from the body. Deliberately omits createdAt / lastStatus /
// lastSentAt so an update preserves them — lastSentAt in particular is the
// anchor for the next digest window, and resetting it would re-send a week
// of deals the recipients already read.
function buildScheduleDoc(input, auth) {
  const s = input || {};
  const rawRecipients = Array.isArray(s.recipients)
    ? s.recipients
    : String(s.recipients || '').split(/[,;\n]/);
  const recipients = [...new Set(
    rawRecipients.map((e) => String(e || '').trim()).filter(Boolean),
  )].slice(0, 100);
  const frequency = ['daily', 'weekly', 'monthly'].includes(s.frequency) ? s.frequency : 'weekly';
  return {
    ownerUid: auth.uid,
    ownerEmail: auth.email || '',
    name: String(s.name || '').slice(0, 200),
    recipients,
    // Left blank by default: the send derives a subject that carries the
    // deal count and window, which is more useful than a fixed string.
    subject: String(s.subject || '').slice(0, 300),
    message: String(s.message || '').slice(0, 5000),
    skipWhenEmpty: !!s.skipWhenEmpty,
    enabled: s.enabled !== false,
    frequency,
    hourLocal: clampInt(s.hourLocal, 0, 23, 9),
    dayOfWeekLocal: frequency === 'weekly' ? clampInt(s.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: frequency === 'monthly' ? clampInt(s.dayOfMonthLocal, 1, 28, 1) : null,
    hourUtc: clampInt(s.hourUtc, 0, 23, 13),
    dayOfWeek: clampInt(s.dayOfWeek, 0, 6, 1),
    dayOfMonth: clampInt(s.dayOfMonth, 1, 28, 1),
    nextRunAt: Number.isFinite(Number(s.nextRunAt)) ? Number(s.nextRunAt) : Date.now(),
  };
}

async function ownedDoc(db, id, auth, res) {
  if (!id) { res.status(400).json({ error: 'id is required' }); return null; }
  const ref = db.collection(COLLECTION).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || snap.data().ownerUid !== auth.uid) {
    res.status(403).json({ error: 'Schedule not found or not yours' });
    return null;
  }
  return ref;
}

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = adminDb();
  const col = db.collection(COLLECTION);
  const { action, id, schedule, enabled } = req.body || {};

  if (action === 'list') {
    const snap = await col.where('ownerUid', '==', auth.uid).get();
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return res.json({ schedules: items });
  }

  // Mutations are rate-limited; reads above are cheap and frequent.
  if (!(await enforceRateLimit(res, auth.uid, 'company-news-schedules', 60, 5 * 60 * 1000))) return;

  if (action === 'create') {
    const doc = buildScheduleDoc(schedule, auth);
    if (doc.recipients.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });
    const now = Date.now();
    doc.createdAt = now;
    doc.updatedAt = now;
    doc.lastStatus = null;
    doc.lastSentAt = null;
    const ref = await col.add(doc);
    return res.json({ id: ref.id });
  }

  if (action === 'update') {
    const ref = await ownedDoc(db, id, auth, res);
    if (!ref) return undefined;
    const patch = buildScheduleDoc(schedule, auth);
    if (patch.recipients.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });
    patch.updatedAt = Date.now();
    await ref.update(patch);
    return res.json({ ok: true });
  }

  if (action === 'setEnabled') {
    const ref = await ownedDoc(db, id, auth, res);
    if (!ref) return undefined;
    await ref.update({ enabled: !!enabled, updatedAt: Date.now() });
    return res.json({ ok: true });
  }

  if (action === 'delete') {
    const ref = await ownedDoc(db, id, auth, res);
    if (!ref) return undefined;
    await ref.delete();
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

export default withAuth(handler);
