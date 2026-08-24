// Vercel Cron entry point. Runs hourly (see vercel.json `crons`) and sends
// any Company Acquisition News schedules that are due. Each schedule lives
// in the `companyNewsEmailSchedules` Firestore collection and is owned by a
// user; the digest is rebuilt from that user's flagged prospects, so the
// cron works with no browser open.
//
// Protected by CRON_SECRET: when set, Vercel automatically attaches
// `Authorization: Bearer <CRON_SECRET>` to cron invocations. A matching
// `?secret=` query param is also accepted for manual triggering.

import { adminDb } from './_lib/firebaseAdmin.js';
import { buildDigest, sendCompanyNewsEmail } from './_lib/companyNews.js';
// Plain UTC recurrence math, shared with the PE Opps digest — same
// frequency/hourUtc/dayOfWeek/dayOfMonth fields, nothing PE-specific in it.
import { computeNextRun } from './_lib/peOppsSchedule.js';

// Each due schedule runs a web-search pass per tracked company, so one
// invocation can only carry a couple of them inside the function's time
// budget. The rest stay due and are picked up by the next hourly tick.
const MAX_SCHEDULES_PER_RUN = 2;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.query?.secret || '');
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try { db = adminDb(); }
  catch (err) { return res.status(500).json({ error: String(err.message || err) }); }

  const now = Date.now();
  const results = [];

  let snap;
  try {
    snap = await db.collection('companyNewsEmailSchedules').where('enabled', '==', true).get();
  } catch (err) {
    return res.status(500).json({ error: `Failed to read schedules: ${String(err.message || err)}` });
  }

  // Oldest-due first, so a schedule can't be starved by one that came due
  // later but happens to sort earlier by document id.
  const due = snap.docs
    .map((d) => ({ ref: d.ref, s: { id: d.id, ...d.data() } }))
    .filter(({ s }) => !s.nextRunAt || Number(s.nextRunAt) <= now)
    .sort((a, b) => (Number(a.s.nextRunAt) || 0) - (Number(b.s.nextRunAt) || 0));

  for (const { ref, s } of due.slice(0, MAX_SCHEDULES_PER_RUN)) {
    if (!s.ownerUid || !Array.isArray(s.recipients) || s.recipients.length === 0) {
      await ref.update({
        lastStatus: 'error',
        lastError: 'Schedule missing owner or recipients',
        nextRunAt: computeNextRun(s, now),
      }).catch(() => {});
      results.push({ id: s.id, status: 'error', error: 'missing owner/recipients' });
      continue;
    }

    try {
      const digest = await buildDigest(db, s.ownerUid, s.ownerEmail, {
        lastSentAt: s.lastSentAt,
        message: s.message,
        skipWhenEmpty: s.skipWhenEmpty,
      });

      if (digest.empty) {
        // Nothing sent, so lastSentAt stays put: the window this run
        // covered rolls into the next one instead of being lost.
        await ref.update({
          lastStatus: `skipped-${digest.reason}`,
          lastError: null,
          nextRunAt: computeNextRun(s, now),
        });
        results.push({ id: s.id, status: `skipped-${digest.reason}` });
        continue;
      }

      await sendCompanyNewsEmail({
        to: s.recipients,
        subject: s.subject || digest.defaultSubject,
        html: digest.html,
        replyTo: s.ownerEmail,
      });

      await ref.update({
        lastSentAt: now,
        lastStatus: 'sent',
        lastError: null,
        lastDealCount: digest.deals,
        lastCompanyCount: digest.companies,
        lastRecipientCount: s.recipients.length,
        nextRunAt: computeNextRun(s, now),
      });
      results.push({ id: s.id, status: 'sent', deals: digest.deals, companies: digest.companies });
    } catch (err) {
      await ref.update({
        lastStatus: 'error',
        lastError: String(err.message || err).slice(0, 500),
        nextRunAt: computeNextRun(s, now),
      }).catch(() => {});
      results.push({ id: s.id, status: 'error', error: String(err.message || err) });
    }
  }

  return res.status(200).json({
    ran: results.length,
    deferred: Math.max(0, due.length - results.length),
    results,
    at: new Date(now).toISOString(),
  });
}
