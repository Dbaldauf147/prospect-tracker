// Weekly HubSpot import files, emailed (see api/_lib/hubspotWeekly.js).
//
//   Vercel Cron (vercel.json, Mondays)   build and email; Authorization:
//                                        Bearer <CRON_SECRET>
//   POST ?action=send                    the same, now (admin only), for the
//                                        "Send it now" button
//   GET  ?action=status                  the last run and where it goes
//                                        (admin only)
//
// Env:
//   HUBSPOT_ACCESS_TOKEN        the current portal (contacts, activity)
//   HUBSPOT_IMPORT_OWNER_EMAIL  owner of every record in the new portal
//                               (default daniel.baldauf@se.com)
//   HUBSPOT_WEEKLY_TO           where the email goes (default: the owner)
//   GMAIL_USER / GMAIL_APP_PASSWORD, CRON_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY
//
// Reads HubSpot, never writes to it. Each run is logged to
// hubspotWeekly/latest, so the tab can show when the last email went and
// what went wrong if it didn't.

import { withAuth, isAdminEmail } from './_lib/http.js';
import { adminDb, adminAuth } from './_lib/firebaseAdmin.js';
import { hubspotScope } from './_lib/hubspotScope.js';
import { loadOpps2 } from './_lib/firestoreChunks.js';
import { sendEmail } from './_lib/mailer.js';
import { getAllContacts } from './hubspot.js';
import { liveActivity, hubspotGetter, flatContact, buildWeeklyFiles, weeklyEmailHtml } from './_lib/hubspotWeekly.js';

// The account whose companies, settings and Opps the files are built from.
// Its prospects live in the shared top-level collection (see dataBackup.js).
const ADMIN_EMAIL = 'baldaufdan@gmail.com';
const DEFAULT_OWNER = 'daniel.baldauf@se.com';

// vercel.json runs it at 12:35 UTC on Mondays.
export const SCHEDULE_TEXT = 'Mondays at 7:35am Eastern (8:35am in summer)';

function settingsFromEnv(env = process.env) {
  const owner = String(env.HUBSPOT_IMPORT_OWNER_EMAIL || DEFAULT_OWNER).trim();
  const to = String(env.HUBSPOT_WEEKLY_TO || owner).split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return { owner, to };
}

// Everything the files are built from. Split out so the tests can hand in
// their own.
async function loadSources(db, token) {
  const uid = (await adminAuth().getUserByEmail(ADMIN_EMAIL)).uid;
  const [settingsSnap, prospectsSnap, opps] = await Promise.all([
    db.collection('userSettings').doc(uid).get(),
    db.collection('prospects').get(),
    loadOpps2(db, uid),
  ]);
  const scope = await hubspotScope(token);
  const contacts = (await getAllContacts(token, scope)).map(flatContact);
  const { activity, errors } = await liveActivity(hubspotGetter(token));
  return {
    settings: settingsSnap.exists ? settingsSnap.data() || {} : {},
    prospects: prospectsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    opps,
    contacts,
    activity,
    activityErrors: errors,
  };
}

/** Build and send one week's email. Returns the log entry it wrote. */
export async function runWeekly({ db, token, env = process.env, load = loadSources, send = sendEmail, now = () => new Date() }) {
  const { owner, to } = settingsFromEnv(env);
  const startedAt = now().toISOString();
  const log = db.collection('hubspotWeekly').doc('latest');
  try {
    if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN is not configured.');
    const src = await load(db, token);
    const date = startedAt.slice(0, 10);
    const { attachments, counts } = buildWeeklyFiles({ ...src, ownerEmail: owner, date });
    await send({
      to,
      subject: `HubSpot import files for the week of ${date}`,
      html: weeklyEmailHtml({ counts, attachments, activityErrors: src.activityErrors }),
      attachments,
    });
    const entry = { ok: true, startedAt, finishedAt: now().toISOString(), to, counts, activityErrors: src.activityErrors || {}, error: null };
    await log.set(entry).catch(() => {});
    return entry;
  } catch (err) {
    const entry = { ok: false, startedAt, finishedAt: now().toISOString(), to, counts: null, error: String(err?.message || err).slice(0, 500) };
    await log.set(entry).catch(() => {});
    return entry;
  }
}

const authed = withAuth(async (req, res, auth) => {
  if (!isAdminEmail(auth?.email)) return res.status(403).json({ error: 'Only the admin account can send the weekly HubSpot files.' });
  const db = adminDb();
  const action = req.query?.action;
  if (action === 'status') {
    const snap = await db.collection('hubspotWeekly').doc('latest').get();
    return res.json({ schedule: SCHEDULE_TEXT, ...settingsFromEnv(), last: snap.exists ? snap.data() : null });
  }
  if (action === 'send' && req.method === 'POST') {
    const entry = await runWeekly({ db, token: process.env.HUBSPOT_ACCESS_TOKEN });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return res.status(400).json({ error: 'Missing or invalid action parameter.' });
});

export default async function handler(req, res) {
  // The cron's own call carries the cron secret; everything else is a
  // signed-in user and goes through the usual auth.
  const secret = process.env.CRON_SECRET;
  const header = String(req.headers?.authorization || '');
  if (secret && header === `Bearer ${secret}`) {
    const entry = await runWeekly({ db: adminDb(), token: process.env.HUBSPOT_ACCESS_TOKEN });
    return res.status(entry.ok ? 200 : 500).json(entry);
  }
  return authed(req, res);
}
