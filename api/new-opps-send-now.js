// Authenticated "send now" route — backs the "Send test now" button in the
// New Opps schedule manager and any ad-hoc one-off send. Always builds from
// the *caller's* own opps (auth.uid) and sets reply-to to the caller.
// Mirrors api/pe-opps-send-now.js.
//
// Body: { recipients: [email], subject?, message?, columns?: [colKey] }
//   or: { scheduleId } to reuse a saved schedule's config (must be owned
//        by the caller).

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { loadNewOpps, filterNewOpps, buildNewOppsWorkbook, sendNewOppsEmail, newOppsFilename } from './_lib/newOpps.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'new-opps-send-now', 20, 5 * 60 * 1000))) return;

  let { recipients, subject, message, columns, scheduleId, records: postedRecords } = req.body || {};

  const db = adminDb();
  if (scheduleId) {
    const snap = await db.collection('newOppsEmailSchedules').doc(String(scheduleId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Schedule not found' });
    const s = snap.data() || {};
    if (s.ownerUid !== auth.uid) return res.status(403).json({ error: 'Not your schedule' });
    recipients = s.recipients;
    subject = s.subject;
    message = s.message;
    columns = s.columns;
  }

  const to = (Array.isArray(recipients) ? recipients : String(recipients || '').split(/[,;\n]/))
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (to.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  try {
    // When the New Opps page supplies its on-screen rows, filter + send
    // exactly those so the email matches what the user sees — the page
    // reads the newest of local/cloud Opps 2 data, which can be ahead of
    // the cloud copy this route would otherwise re-read. Fall back to the
    // cloud (loadNewOpps) for callers that don't post rows.
    const records = Array.isArray(postedRecords)
      ? filterNewOpps(postedRecords.filter((r) => r && typeof r === 'object').slice(0, 5000))
      : await loadNewOpps(db, auth.uid);
    const buffer = await buildNewOppsWorkbook(records, columns);
    const result = await sendNewOppsEmail({
      to,
      subject,
      message,
      buffer,
      filename: newOppsFilename(),
      replyTo: auth.email,
    });
    return res.json({ success: true, id: result.id, opps: records.length, recipients: to.length });
  } catch (err) {
    console.error('new-opps-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
