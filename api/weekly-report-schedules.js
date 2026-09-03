// Authenticated CRUD for Weekly Report email schedules, plus the endpoint
// the Weekly Report tab uses to publish its snapshot. Backed by the admin
// SDK so neither depends on client-side Firestore rules — the cron
// (api/weekly-report-scheduler) reads the same two collections the same
// way. Mirrors api/pe-opps-schedules.js.
//
// Body: { action: 'list' }
//       { action: 'create', schedule: {...} } -> { id }
//       { action: 'update', id, schedule: {...} } -> { ok }
//       { action: 'setEnabled', id, enabled } -> { ok }
//       { action: 'delete', id } -> { ok }
//       { action: 'publishSnapshot', snapshot: {...} } -> { ok }
//
// The client computes the timezone-aware recurrence fields (it knows the
// user's local zone); the server still re-validates and forces ownerUid /
// ownerEmail from the verified token so a caller can't write someone
// else's schedule or snapshot.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { buildSnapshotDoc, clampInt } from './_lib/weeklyReportSnapshot.js';

const COLLECTION = 'weeklyReportEmailSchedules';
const SNAPSHOTS = 'weeklyReportSnapshots';

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
    subject: String(s.subject || 'Weekly Report').slice(0, 300),
    message: String(s.message || '').slice(0, 5000),
    enabled: s.enabled !== false,
    frequency,
    hourLocal: clampInt(s.hourLocal, 0, 23, 6),
    dayOfWeekLocal: frequency === 'weekly' ? clampInt(s.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: frequency === 'monthly' ? clampInt(s.dayOfMonthLocal, 1, 28, 1) : null,
    // The IANA zone the user picked the time in. The cron resolves each
    // run against it so "06:00" stays 06:00 across a DST change; hourUtc
    // below stays as the fallback for schedules saved before this existed.
    timeZone: String(s.timeZone || '').slice(0, 64),
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
  const { action, id, schedule, enabled, snapshot } = req.body || {};

  if (action === 'list') {
    const snap = await col.where('ownerUid', '==', auth.uid).get();
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const shot = await db.collection(SNAPSHOTS).doc(auth.uid).get();
    return res.json({
      schedules: items,
      snapshotAt: shot.exists ? (shot.data().capturedAt || null) : null,
    });
  }

  // The tab publishes on every visit, so this is deliberately cheap and
  // rate-limited on its own budget rather than the mutation budget below.
  if (action === 'publishSnapshot') {
    if (!(await enforceRateLimit(res, auth.uid, 'weekly-report-snapshot', 120, 5 * 60 * 1000))) return;
    await db.collection(SNAPSHOTS).doc(auth.uid).set(buildSnapshotDoc(snapshot, auth));
    return res.json({ ok: true });
  }

  if (!(await enforceRateLimit(res, auth.uid, 'weekly-report-schedules', 60, 5 * 60 * 1000))) return;

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
