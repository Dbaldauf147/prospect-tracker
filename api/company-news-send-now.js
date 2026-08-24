// Authenticated "send now" route — backs the "Send test now" button in the
// Company Acquisition News schedule manager and any ad-hoc one-off send.
// Always builds from the *caller's* own tracked companies (auth.uid) and
// sets reply-to to the caller.
//
// Body: { recipients: [email], subject?, message?, lookbackDays? }
//   or: { scheduleId } to reuse a saved schedule's config (must be owned
//        by the caller).
//
// A test send deliberately does NOT advance the schedule's lastSentAt: the
// next real digest should still cover the window the test just previewed,
// or recipients would silently miss a week of deals.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { buildDigest, sendCompanyNewsEmail } from './_lib/companyNews.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Each send fans out into a web-search call per tracked company, so this
  // is metered tighter than the other send-now routes.
  if (!(await enforceRateLimit(res, auth.uid, 'company-news-send-now', 6, 30 * 60 * 1000))) return;

  let { recipients, subject, message, lookbackDays, scheduleId } = req.body || {};

  const db = adminDb();
  let schedule = null;
  if (scheduleId) {
    const snap = await db.collection('companyNewsEmailSchedules').doc(String(scheduleId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Schedule not found' });
    schedule = snap.data() || {};
    if (schedule.ownerUid !== auth.uid) return res.status(403).json({ error: 'Not your schedule' });
    recipients = schedule.recipients;
    subject = schedule.subject;
    message = schedule.message;
  }

  const to = (Array.isArray(recipients) ? recipients : String(recipients || '').split(/[,;\n]/))
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (to.length === 0) return res.status(400).json({ error: 'At least one recipient is required' });

  // A test send picks its own window: an explicit lookback when asked for,
  // otherwise the schedule's real anchor so the preview matches what the
  // next scheduled send would actually contain.
  const days = Number(lookbackDays);
  const lastSentAt = Number.isFinite(days) && days > 0
    ? Date.now() - Math.min(days, 60) * DAY_MS
    : schedule?.lastSentAt;

  try {
    const digest = await buildDigest(db, auth.uid, auth.email, {
      lastSentAt,
      message,
      // A manual send always produces an email, even an empty one — the
      // user pressed the button and needs to see the result.
      skipWhenEmpty: false,
    });

    if (digest.empty) {
      return res.status(400).json({
        error: 'No companies are flagged for acquisition news. Tick “Track acquisition news” on a company popup first.',
      });
    }

    const result = await sendCompanyNewsEmail({
      to,
      subject: subject || digest.defaultSubject,
      html: digest.html,
      replyTo: auth.email,
    });

    return res.json({
      success: true,
      id: result.id,
      companies: digest.companies,
      deals: digest.deals,
      recipients: to.length,
    });
  } catch (err) {
    console.error('company-news-send-now error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

export default withAuth(handler);
