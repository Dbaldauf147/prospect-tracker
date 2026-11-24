// Authenticated "send now" route - backs the "Send now" / "Send test now"
// buttons in the Not Sold weekly schedule manager. Always builds from the
// *caller's* own opps (auth.uid) and sets reply-to to the caller.
// Mirrors api/new-opps-send-now.js.
//
// Body: { recipients: [email], subject?, message?, records? }
//   or: { scheduleId, records? } to reuse a saved schedule's config (must
//        be owned by the caller).
//
// `records` are the closed opps on the page; when it sends them they are
// filtered here by the same rule the cron applies, so the email matches the
// page even when the page is ahead of the cloud copy. Without them the opps
// are read from the cloud, the way the cron does it.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { loadNotSoldLastWeek, sendNotSoldWeeklyEmail } from './_lib/notSoldWeekly.js';
import { notSoldLastWeek } from '../src/utils/notSoldWeeklyEmail.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'not-sold-weekly-send-now', 20, 5 * 60 * 1000))) return;

  let { recipients, subject, message, scheduleId, records: postedRecords } = req.body || {};

  const db = adminDb();
  if (scheduleId) {
    const snap = await db.collection('notSoldWeeklyEmailSchedules').doc(String(scheduleId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Schedule not found' });
    const s = snap.data() || {};
    if (s.ownerUid !== auth.uid) return res.status(403).json({ error: 'Not your schedule' });
    recipients = s.recipients;
    subject = s.subject;
    message = s.message;
  }

  const to = (Array.isArray(recipients) ? recipients : String(recipients || '').split(/[,;\n]/))
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (to.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  try {
    const nowMs = Date.now();
    const rows = Array.isArray(postedRecords)
      ? notSoldLastWeek(postedRecords.slice(0, 5000), { nowMs })
      : await loadNotSoldLastWeek(db, auth.uid, nowMs);
    const result = await sendNotSoldWeeklyEmail({ to, subject, message, rows, replyTo: auth.email, nowMs });
    return res.json({ success: true, id: result.id, opps: rows.length, recipients: to.length });
  } catch (err) {
    console.error('not-sold-weekly-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
