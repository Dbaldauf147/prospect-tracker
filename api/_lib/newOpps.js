// Shared "New Opps" helpers used by the scheduled-email cron
// (api/new-opps-scheduler.js), the "send now" route
// (api/new-opps-send-now.js) and the CRUD route (api/new-opps-schedules.js).
//
// Mirrors api/_lib/peOpps.js, but instead of the PE filter it selects the
// actively-progressing new opps (BFO name set, Stage in Lead/Qualifying/
// Quoting, combined active-stage age <= 7 days). The on-screen "New Opps"
// subtab of Opps 2 applies the same filter so the emailed table matches
// what the user sees.

import { withVerticalCoverage, OPP_SALESPERSON_KEY } from '../../src/utils/oppVerticalCoverage.js';
import {
  NEW_OPPS_DIGEST_COLUMNS, NEW_OPPS_CDMS_ALIGNED_KEY, buildNewOppsDigestTableHtml, withTierAndAlignment,
} from '../../src/utils/newOppsDigestEmail.js';
import { buildTargetTierResolver, buildTargetCdmResolver } from '../../src/utils/targetTier.js';
import { loadTargetAccounts } from './firestoreChunks.js';
import { NEW_OPPS_ACTIVE_STAGES, NEW_OPPS_MAX_STAGE_AGE_DAYS, combinedActiveStageAge, qualifiesNewOpp } from '../../src/utils/newOppsFilter.js';
import { chunk, needsSummary, oppNotesText } from '../../src/utils/notesSummary.js';
import { needsScopeSummary, oppScopeText } from '../../src/utils/scopeSummary.js';
import { MAX_ITEMS, summarizeBatch } from './summarizeNotes.js';
import { summarizeScopeBatch } from './summarizeScope.js';

// ---- Email column set (fixed) -------------------------------------------
// The digest email always shows exactly these columns, in this order: the
// Outlook draft's (src/utils/newOppsDigestEmail.js), so the two can't
// drift. The "BFO Link" column renders a literal "BFO Link" hyperlink
// pointing at the row's BFO Address (the live Salesforce URL); rows with no
// valid address leave the cell blank.
export const NEW_OPPS_EMAIL_COLUMNS = NEW_OPPS_DIGEST_COLUMNS;

// New-opps qualification rules live in src/utils/newOppsFilter.js so the
// Issues tab reads the same list the subtab and this email do.
export { NEW_OPPS_ACTIVE_STAGES, NEW_OPPS_MAX_STAGE_AGE_DAYS };

// ---- Load + filter the user's new opps from Firestore -------------------
// Reads `opps2Data/{uid}` (reassembling the chunked JSON when present) and
// keeps only the opps that qualify for the New Opps report.
// ---- Vertical, Vertical CDM, Tier, CDMs aligned -----------------------------
// The columns the page fills from the Coverage tab, the company cards and
// the Target Accounts list. Rows the page posted already carry them; rows
// read here from the cloud are filled the same way, from the owner's saved
// settings, their prospects and their Target Accounts list. A failed read
// leaves the cells blank (or N/A) rather than failing the send.
const ADMIN_EMAIL = 'baldaufdan@gmail.com';
// The company fields the columns read: vertical, tier, the aligned box.
const PROSPECT_FIELDS = ['company', 'vertical', 'tier', 'tierSource', 'cdmAligned'];
export async function addVerticalCoverage(db, uid, email, records) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0 || list.every((r) => OPP_SALESPERSON_KEY in (r || {}) && NEW_OPPS_CDMS_ALIGNED_KEY in (r || {}))) return list;
  let settings = null;
  let prospects = [];
  let targetAccountsData = null;
  try {
    const snap = await db.collection('userSettings').doc(uid).get();
    settings = snap.exists ? (snap.data() || null) : null;
  } catch { /* the shipped Coverage default still applies */ }
  try {
    const col = email === ADMIN_EMAIL
      ? db.collection('prospects')
      : db.collection('users').doc(uid).collection('prospects');
    const snap = await col.select(...PROSPECT_FIELDS).get();
    // The id is what settings.targetMap (the Target Accounts "Map") keys on.
    prospects = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch { /* opps' own verticals still apply */ }
  try {
    targetAccountsData = await loadTargetAccounts(db, uid);
  } catch { /* Tier falls back to the company card */ }
  // Mirrors App's cdmName, which scopes the Target Accounts tier lookup and
  // decides when the vertical is yours (CDMs aligned reads N/A).
  const cdmName = settings?.cdmName || (email === ADMIN_EMAIL ? 'Dan Baldauf' : '');
  const targetTierFor = targetAccountsData
    ? buildTargetTierResolver({ targetAccountsData, cdmName, settings, includeAllReps: true })
    : null;
  // The account's own CDM off the Target Accounts list, which beats the
  // vertical's in the Vertical CDM column.
  const targetCdmFor = targetAccountsData ? buildTargetCdmResolver({ targetAccountsData, settings }) : null;
  return withTierAndAlignment(withVerticalCoverage(list, { settings, prospects }), { prospects, targetTierFor, targetCdmFor, cdmName });
}

export async function loadNewOpps(db, uid) {
  return filterNewOpps(await loadOpps2Records(db, uid));
}

// Every opp in the user's `opps2Data` doc, unfiltered. Shared with the PE
// Monthly email (api/_lib/peMonthly.js), which picks its own rows.
export async function loadOpps2Records(db, uid) {
  const ref = db.collection('opps2Data').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return [];
  const raw = snap.data() || {};

  let json = null;
  if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
    const parts = new Array(raw.chunkCount).fill('');
    const chunksSnap = await ref.collection('chunks').get();
    chunksSnap.forEach((d) => {
      const idx = Number(d.id);
      if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) {
        parts[idx] = String(d.data()?.json || '');
      }
    });
    json = parts.join('');
  } else if (raw.json) {
    json = raw.json;
  }
  if (!json) return [];

  let parsed;
  try { parsed = JSON.parse(json); } catch { return []; }
  return Array.isArray(parsed?.records) ? parsed.records : [];
}

// Filter + sort an in-memory record list to the qualifying new opps. Freshest
// (lowest combined active-stage age) first so the newest leads the report.
export function filterNewOpps(records) {
  return (Array.isArray(records) ? records : [])
    .filter(qualifiesNewOpp)
    .map((r) => ({ r, age: combinedActiveStageAge(r) }))
    .sort((a, b) =>
      a.age - b.age || String(a.r['Account'] || '').localeCompare(String(b.r['Account'] || '')))
    .map(({ r }) => r);
}

// ---- Build the inline HTML table (fixed email column set) ----------------
// Renders the records as a bordered HTML table in the PE Monthly colours so
// the digest reads directly in the email body, no attachment to open. The
// Outlook draft's own builder, so every send shows the same agreed set
// regardless of what older saved schedules stored.
export function buildNewOppsTableHtml(records) {
  return buildNewOppsDigestTableHtml(records);
}

// ---- Notes summaries -------------------------------------------------------
// Each opp with its notes summarised into a few bullets as `_notesSummary`,
// the same summaries the Notes column on the New Opps subtab shows (same
// text in, same prompt: api/_lib/summarizeNotes.js). Short notes are left
// as written. Best effort: with no API key, or when a batch fails, those
// opps keep their full notes and the email still goes out.
export async function addNotesSummaries(records, { client } = {}) {
  return addSummaries(records, {
    client, textOf: oppNotesText, needs: needsSummary, batchFn: summarizeBatch, what: 'notes',
    attach: (r, bullets) => ({ ...r, _notesSummary: bullets }),
  });
}

// ---- Scope summaries -------------------------------------------------------
// Each opp with a long Scope summarised into one line as `_scopeSummary`,
// the same line the Scope column on the New Opps subtab shows (same text
// in, same prompt: api/_lib/summarizeScope.js). Best effort, like notes: a
// failed batch leaves those opps with their full Scope.
export async function addScopeSummaries(records, { client } = {}) {
  return addSummaries(records, {
    client, textOf: oppScopeText, needs: needsScopeSummary, batchFn: summarizeScopeBatch, what: 'scope',
    attach: (r, lines) => ({ ...r, _scopeSummary: lines[0] }),
  });
}

async function addSummaries(records, { client, textOf, needs, batchFn, attach, what }) {
  if (!Array.isArray(records) || records.length === 0) return records;
  const items = [];
  const idFor = new Map(); // text -> id, so identical text shares one
  const texts = records.map((r) => {
    const text = textOf(r);
    if (needs(text) && !idFor.has(text)) {
      idFor.set(text, String(items.length));
      items.push({ id: String(items.length), text });
    }
    return text;
  });
  if (items.length === 0) return records;

  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) return records;
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod;
    client = new Anthropic();
  }

  const got = {};
  for (const batch of chunk(items, MAX_ITEMS)) {
    try {
      Object.assign(got, (await batchFn(client, batch)) || {});
    } catch (err) {
      console.error(`new-opps ${what} summary failed:`, err?.message || err);
    }
  }
  return records.map((r, i) => {
    const out = got[idFor.get(texts[i])];
    return out?.length ? attach(r, out) : r;
  });
}

// ---- Send via Gmail (SMTP + App Password) with the table inline ----------
// The new opportunities are rendered as an HTML table in the email body (no
// attachment). `records` are pre-filtered by the caller. The body is
// intentionally minimal — just the optional intro message and the table, with
// no heading, summary line, or footer.
export async function sendNewOppsEmail({ to, subject, message, records, replyTo }) {
  records = await addScopeSummaries(await addNotesSummaries(records));
  const intro = message
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 16px">${escapeHtml(message)}</p>`
    : '';
  const table = buildNewOppsTableHtml(records);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto">
      ${intro}
      ${table}
    </div>
  `;
  return sendHtmlEmail({ to, subject: subject || 'New Opportunities', html, replyTo });
}

// Send an already-built HTML body from the connected Gmail account. Shared
// with the PE Monthly email so both go out the same way.
export async function sendHtmlEmail({ to, subject, html, replyTo }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Email not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)');
  }
  const recipients = (Array.isArray(to) ? to : [to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error('No recipients');

  const nm = await import('nodemailer');
  const nodemailer = nm.default || nm;
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  const fromName = process.env.GMAIL_FROM_NAME || 'Prospect Tracker';
  const result = await transporter.sendMail({
    from: `${fromName} <${user}>`,
    to: recipients,
    replyTo: replyTo || user,
    subject,
    html,
  });
  return { id: result.messageId };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
