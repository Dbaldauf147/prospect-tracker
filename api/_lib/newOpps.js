// Shared "New Opps" helpers used by the scheduled-email cron
// (api/new-opps-scheduler.js), the "send now" route
// (api/new-opps-send-now.js) and the CRUD route (api/new-opps-schedules.js).
//
// Mirrors api/_lib/peOpps.js, but instead of the PE filter it selects the
// actively-progressing new opps (BFO name set, Stage in Lead/Qualifying/
// Quoting, combined active-stage age <= 7 days). The on-screen "New Opps"
// subtab of Opps 2 applies the same filter so the emailed table matches
// what the user sees.

// ---- Email column set (fixed) -------------------------------------------
// The digest email always shows exactly these columns, in this order. The
// "BFO Link" column renders a literal "BFO Link" hyperlink pointing at the
// row's BFO Address (the live Salesforce URL); rows with no valid address
// leave the cell blank.
export const NEW_OPPS_EMAIL_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Start Date', label: 'Start Date', value: (r) => formatShortDate(r['Start Date']) },
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Address', label: 'BFO Link' },
];

// New-opps qualification rules (mirror NEW_OPPS_* in OppsView2): an opp shows
// when it has a BFO Opportunity Name, its current Stage is one of these, and
// its combined time across these stages is at most this many days.
export const NEW_OPPS_ACTIVE_STAGES = ['Lead', 'Qualifying', 'Quoting'];
const NEW_OPPS_ACTIVE_STAGES_SET = new Set(NEW_OPPS_ACTIVE_STAGES);
export const NEW_OPPS_MAX_STAGE_AGE_DAYS = 7;

// ---- Date helpers (mirror PEPortfolioView / Opps 2) ---------------------
function parseOppsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// Whole calendar days from an ISO/parseable date up to today (>= 0). Mirrors
// OppsView2's daysFromToday negated + floored at zero.
function daysSince(raw) {
  const d = parseOppsDate(raw);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

// Combined days an opp has spent across the Lead + Qualifying + Quoting
// stages: historical durations from `_stageHistory` plus the live days-so-far
// when the current Stage is one of those three. Mirrors combinedActiveStageAge
// in OppsView2 so the server filter matches the on-screen list.
function combinedActiveStageAge(r) {
  let total = 0;
  for (const h of (Array.isArray(r && r._stageHistory) ? r._stageHistory : [])) {
    const s = String(h && h.stage || '').trim();
    if (!NEW_OPPS_ACTIVE_STAGES_SET.has(s)) continue;
    const d = Number(h && h.days);
    if (Number.isFinite(d) && d >= 0) total += d;
  }
  const stage = String(r && r['Stage'] || '').trim();
  if (NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) {
    const since = daysSince((r && r._stageEnteredAt) || (r && r['Start Date']));
    total += since == null ? 0 : since;
  }
  return total;
}

const bfoMissing = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
};

// True when an opp qualifies for the New Opps report.
function qualifiesNewOpp(r) {
  if (!r || typeof r !== 'object') return false;
  const stage = String(r['Stage'] || '').trim();
  if (!NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) return false; // also excludes Not Started
  if (bfoMissing(r['BFO Link'])) return false;
  return combinedActiveStageAge(r) <= NEW_OPPS_MAX_STAGE_AGE_DAYS;
}

// Short date (M/D/YYYY) for display. Falls back to the raw value when it
// isn't a parseable date so nothing gets blanked unexpectedly.
function formatShortDate(raw) {
  const d = parseOppsDate(raw);
  if (!d) return raw == null ? '' : String(raw);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// ---- Load + filter the user's new opps from Firestore -------------------
// Reads `opps2Data/{uid}` (reassembling the chunked JSON when present) and
// keeps only the opps that qualify for the New Opps report.
export async function loadNewOpps(db, uid) {
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
  const records = Array.isArray(parsed?.records) ? parsed.records : [];

  return filterNewOpps(records);
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
// Renders the records as a plain black-and-white bordered HTML table so the
// digest reads directly in the email body — no attachment to open. Always
// uses NEW_OPPS_EMAIL_COLUMNS, regardless of what older saved schedules
// stored, so every send shows the same agreed set.
export function buildNewOppsTableHtml(records) {
  const columns = NEW_OPPS_EMAIL_COLUMNS;

  if (!Array.isArray(records) || records.length === 0) {
    return '<p style="color:#000000;font-size:13px;margin:0">No new opportunities to report.</p>';
  }

  // Plain black-and-white bordered table — no fills, no accent colour.
  const BORDER = '1px solid #000000';
  const thAlign = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = columns.map((c) =>
    `<th style="text-align:${thAlign(c)};padding:6px 10px;font:700 13px Arial,sans-serif;color:#000000;border:${BORDER};white-space:nowrap">${escapeHtml(c.label)}</th>`
  ).join('');

  // The row's BFO Address, but only when it actually looks like a web URL —
  // blanks and sentinel values ('-', '#N/A') never become hrefs.
  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#000000;text-decoration:underline">${escapeHtml(text)}</a>`;

  // Steps inside a single Next Steps box are stored with U+2028 line
  // separators (and "\n"); render both as <br> so a multi-line note reads
  // as stacked lines instead of one run-on string.
  const multiline = (v) => escapeHtml(v).replace(/\u2028|\r?\n/g, '<br>');

  const rows = records.map((r) => {
    const cells = columns.map((c) => {
      const v = cellValue(r, c);
      let inner;
      if (c.key === 'BFO Address') {
        // Literal "BFO Link" text hyperlinked to the opp's BFO Address;
        // blank when there's no valid web address.
        const url = bfoUrl(r);
        inner = url ? link(url, 'BFO Link') : '';
      } else if (c.key === 'Next Steps') {
        inner = multiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${thAlign(c)};padding:6px 10px;font:13px Arial,sans-serif;color:#000000;border:${BORDER};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4px 0 8px;border:${BORDER}">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---- Send via Gmail (SMTP + App Password) with the table inline ----------
// The new opportunities are rendered as an HTML table in the email body (no
// attachment). `records` are pre-filtered by the caller. The body is
// intentionally minimal — just the optional intro message and the table, with
// no heading, summary line, or footer.
export async function sendNewOppsEmail({ to, subject, message, records, replyTo }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Email not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)');
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .map((e) => String(e || '').trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error('No recipients');

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
    subject: subject || 'New Opportunities',
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
