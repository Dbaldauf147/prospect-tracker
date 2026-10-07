// Shared "PE Monthly" helpers used by the scheduled-email cron
// (api/pe-monthly-scheduler.js) and the "send now" route
// (api/pe-monthly-send-now.js).
//
// The rows are the Opps page's PE Monthly subtab: the PE overlap deals off
// the Keith agenda (every PE / Portfolio Company opp at Stage 3+), with the
// owner, vertical, Coverage salesperson and the Target Accounts tier / CDM.
// They are built by the same function the page's list rests on
// (src/utils/peMonthlyEmail.js buildPeMonthlyRows), from what this user
// has in Firestore, so a schedule can fire with no browser open and still
// match the tab. The body is the scheduled New Opps body - intro + the
// black-and-white table - sent from the same Gmail account.

import { loadOpps2Records, sendHtmlEmail } from './newOpps.js';
import { buildPeMonthlyRows, buildPeMonthlyEmailHtml, PE_MONTHLY_DRAFT_DEFAULTS } from '../../src/utils/peMonthlyEmail.js';

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// The company fields the PE list reads: ownership, vertical, tier.
const PROSPECT_FIELDS = ['company', 'type', 'peOwner', 'portfolioCompanies', 'vertical', 'tier', 'tierSource'];

export async function loadPeMonthlyRows(db, uid, email) {
  const records = await loadOpps2Records(db, uid);

  let settings = null;
  try {
    const snap = await db.collection('userSettings').doc(uid).get();
    settings = snap.exists ? (snap.data() || null) : null;
  } catch { /* shipped Coverage default, no Target Accounts mapping */ }

  let prospects = [];
  try {
    const col = email === ADMIN_EMAIL
      ? db.collection('prospects')
      : db.collection('users').doc(uid).collection('prospects');
    const snap = await col.select(...PROSPECT_FIELDS).get();
    prospects = snap.docs.map((d) => d.data() || {});
  } catch { /* the opps' own owner / vertical still apply */ }

  // Same doc the Target Accounts page saves (a JSON string under `json`).
  let targetAccountsData = null;
  try {
    const snap = await db.collection('targetAccounts').doc(uid).get();
    if (snap.exists) {
      const raw = snap.data() || {};
      targetAccountsData = raw.json ? JSON.parse(raw.json) : raw;
    }
  } catch { /* Tier falls back to the company card, CDM stays blank */ }

  // Mirrors App's cdmName, which scopes the Target Accounts tier lookup.
  const cdmName = settings?.cdmName || (email === ADMIN_EMAIL ? 'Dan Baldauf' : '');

  return buildPeMonthlyRows({ records, prospects, settings, targetAccountsData, cdmName });
}

export async function sendPeMonthlyEmail({ to, subject, message, rows, replyTo }) {
  const html = buildPeMonthlyEmailHtml(rows, { message });
  return sendHtmlEmail({ to, subject: subject || PE_MONTHLY_DRAFT_DEFAULTS.subject, html, replyTo });
}
