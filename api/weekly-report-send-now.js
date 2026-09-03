// Authenticated "send now" route — backs the "Send test now" button in the
// Weekly Report email scheduler. Always builds from the *caller's* own
// snapshot (auth.uid) and sets reply-to to the caller. Mirrors
// api/new-opps-send-now.js.
//
// Body: { recipients: [email], subject?, message?, snapshot? }
//   or: { scheduleId } to reuse a saved schedule's config (must be owned
//        by the caller).
//
// When the tab posts its live `snapshot`, that is what gets mailed, so a
// test send matches the screen exactly rather than whatever was last
// published. Callers that omit it fall back to the stored snapshot — the
// same one the cron would use, which is what a test is usually checking.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { sendWeeklyReportEmail } from './_lib/weeklyReportEmail.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'weekly-report-send-now', 20, 5 * 60 * 1000))) return;

  let { recipients, subject, message, scheduleId, snapshot: postedSnapshot } = req.body || {};

  const db = adminDb();
  if (scheduleId) {
    const snap = await db.collection('weeklyReportEmailSchedules').doc(String(scheduleId)).get();
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
    let snapshot = postedSnapshot && typeof postedSnapshot === 'object' ? postedSnapshot : null;
    if (!snapshot) {
      const shot = await db.collection('weeklyReportSnapshots').doc(auth.uid).get();
      if (!shot.exists) {
        return res.status(400).json({
          error: 'No Weekly Report snapshot saved yet. Open Charts → Weekly Report once so there is something to send.',
        });
      }
      snapshot = shot.data();
    }
    const result = await sendWeeklyReportEmail({
      to,
      subject,
      message,
      snapshot,
      replyTo: auth.email,
    });
    return res.json({ success: true, id: result.id, recipients: to.length });
  } catch (err) {
    console.error('weekly-report-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
