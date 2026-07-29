// Authenticated "send now" route — backs the "Send test now" button in
// the PE Opps schedule manager and any ad-hoc one-off send. Always builds
// from the *caller's* own opps (auth.uid) and sets reply-to to the caller.
//
// Body: { recipients: [email], subject?, message?, columns?: [colKey] }
//   or: { scheduleId } to reuse a saved schedule's config (must be owned
//        by the caller).

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { loadPeOpps, loadOppsForFirm, loadPeFirms, buildPeOppsWorkbook, sendPeOppsEmail, peOppsFilename } from './_lib/peOpps.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'pe-opps-send-now', 20, 5 * 60 * 1000))) return;

  let { recipients, subject, message, columns, scheduleId, firm, records: postedRecords } = req.body || {};

  const db = adminDb();
  if (scheduleId) {
    const snap = await db.collection('peOppsEmailSchedules').doc(String(scheduleId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Schedule not found' });
    const s = snap.data() || {};
    if (s.ownerUid !== auth.uid) return res.status(403).json({ error: 'Not your schedule' });
    recipients = s.recipients;
    subject = s.subject;
    message = s.message;
    columns = s.columns;
    firm = s.firm;
  }
  firm = String(firm || '').trim();

  const to = (Array.isArray(recipients) ? recipients : String(recipients || '').split(/[,;\n]/))
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (to.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  try {
    // When the PE Opps page supplies its on-screen rows, send exactly
    // those so the email matches what the user sees — the page reads the
    // newest of local/cloud Opps 2 data, which can be ahead of the cloud
    // copy this route would otherwise re-read. Fall back to the cloud
    // (loadPeOpps) for callers that don't post rows. PE firms still come
    // from the shared prospects store (same source the page uses).
    const records = Array.isArray(postedRecords)
      ? postedRecords.filter((r) => r && typeof r === 'object').slice(0, 5000)
      : firm
        ? await loadOppsForFirm(db, auth.uid, auth.email, firm)
        : await loadPeOpps(db, auth.uid);
    // The PE Stages second sheet is only meaningful for the all-firms
    // digest — drop it when the send is scoped to one firm.
    const firms = firm ? [] : await loadPeFirms(db, auth.uid, auth.email);
    const buffer = await buildPeOppsWorkbook(records, columns, firms, { firmLabel: firm });
    const result = await sendPeOppsEmail({
      to,
      subject,
      message,
      buffer,
      filename: peOppsFilename(),
      replyTo: auth.email,
    });
    return res.json({ success: true, id: result.id, opps: records.length, recipients: to.length });
  } catch (err) {
    console.error('pe-opps-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
