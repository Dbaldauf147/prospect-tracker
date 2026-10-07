// Authenticated "send now" route - backs the "Send now" / "Send test now"
// buttons in the PE Monthly schedule manager. Always builds from the
// *caller's* own data (auth.uid) and sets reply-to to the caller.
// Mirrors api/new-opps-send-now.js.
//
// Body: { recipients: [email], subject?, message?, rows? }
//   or: { scheduleId, rows? } to reuse a saved schedule's config (must be
//        owned by the caller).
//
// `rows` are the PE Monthly rows on screen; when the page sends them they go
// out as they are (cut down to the email's columns), so the email matches
// the table. Without them the rows are rebuilt from the cloud, the way the
// cron does it.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { loadPeMonthlyRows, sendPeMonthlyEmail } from './_lib/peMonthly.js';
import { sanitizePeMonthlyRows } from '../src/utils/peMonthlyEmail.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'pe-monthly-send-now', 20, 5 * 60 * 1000))) return;

  let { recipients, subject, message, scheduleId, rows: postedRows } = req.body || {};

  const db = adminDb();
  if (scheduleId) {
    const snap = await db.collection('peMonthlyEmailSchedules').doc(String(scheduleId)).get();
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
    const rows = Array.isArray(postedRows)
      ? sanitizePeMonthlyRows(postedRows)
      : await loadPeMonthlyRows(db, auth.uid, auth.email);
    const result = await sendPeMonthlyEmail({ to, subject, message, rows, replyTo: auth.email });
    return res.json({ success: true, id: result.id, opps: rows.length, recipients: to.length });
  } catch (err) {
    console.error('pe-monthly-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
