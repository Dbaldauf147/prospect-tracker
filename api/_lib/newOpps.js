// Shared "New Opps" helpers used by the scheduled-email cron
// (api/new-opps-scheduler.js), the "send now" route
// (api/new-opps-send-now.js) and the CRUD route (api/new-opps-schedules.js).
//
// Mirrors api/_lib/peOpps.js, but instead of the PE filter it selects the
// opps a user *created in the past 7 days*. Opps 2 records carry no explicit
// creation timestamp; a brand-new opp seeds its "Start Date" to today (see
// makeBlankOpp in src/components/OppsView2/OppsView2.jsx), so Start Date is
// used as the creation proxy. The on-screen "New Opps" subtab of Opps 2
// applies the same window so the emailed file matches what the user sees.

// ---- Column definitions (mirror NewOppsTab default report columns) ------
export const NEW_OPPS_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Open Year', label: 'Open Year' },
  { key: 'Contact', label: 'Contact' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Type', label: 'Type' },
  { key: 'Sales Partner', label: 'Sales Partner' },
  { key: 'Start Date', label: 'Start Date' },
  { key: 'Status', label: 'Status' },
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Sites', label: 'Sites', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
];

export const NEW_OPPS_COLUMN_KEYS = NEW_OPPS_COLUMNS.map((c) => c.key);

// Number of days back the "new opps" window covers (inclusive of today).
export const NEW_OPPS_WINDOW_DAYS = 7;

// ---- Date helpers (mirror PEPortfolioView / Opps 2) ---------------------
function parseOppsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// Midnight `days` days before today (local server time), used as the
// inclusive lower bound of the "created in the past N days" window.
export function newOppsCutoff(days = NEW_OPPS_WINDOW_DAYS, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1)); // window includes today + (days-1) prior
  return d;
}

// True when a record's Start Date falls on/after the cutoff (and isn't in
// the future) — i.e. the opp was created within the window.
export function isNewOpp(r, cutoff = newOppsCutoff(), now = new Date()) {
  const start = parseOppsDate(r && r['Start Date']);
  if (!start) return false;
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  return start >= cutoff && start <= todayEnd;
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// ---- Load + filter the user's new opps from Firestore -------------------
// Reads `opps2Data/{uid}` (reassembling the chunked JSON when present) and
// keeps only opps whose Start Date is within the past NEW_OPPS_WINDOW_DAYS.
export async function loadNewOpps(db, uid, days = NEW_OPPS_WINDOW_DAYS) {
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

  const cutoff = newOppsCutoff(days);
  return filterNewOpps(records, days, cutoff);
}

// Filter + sort an in-memory record list to the new-opps window. Newest
// Start Date first so the most recent additions lead the report.
export function filterNewOpps(records, days = NEW_OPPS_WINDOW_DAYS, cutoff = newOppsCutoff(days)) {
  const now = new Date();
  return (Array.isArray(records) ? records : [])
    .filter((r) => isNewOpp(r, cutoff, now))
    .sort((a, b) => {
      const da = parseOppsDate(a['Start Date']);
      const dbb = parseOppsDate(b['Start Date']);
      const ta = da ? da.getTime() : 0;
      const tb = dbb ? dbb.getTime() : 0;
      if (tb !== ta) return tb - ta;
      return String(a['Account'] || '').localeCompare(String(b['Account'] || ''));
    });
}

// ---- Build the SE-branded workbook (mirror PE Opps export) --------------
// Returns a Node Buffer of the .xlsx file. `columnKeys` selects/orders the
// New Opps columns; unknown keys are ignored and an empty list falls back
// to all. Account is always kept as the row anchor.
export async function buildNewOppsWorkbook(records, columnKeys, days = NEW_OPPS_WINDOW_DAYS) {
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || exceljs.default?.Workbook;
  if (typeof Workbook !== 'function') throw new Error('exceljs Workbook unavailable');
  const keys = Array.isArray(columnKeys) && columnKeys.length ? columnKeys : NEW_OPPS_COLUMN_KEYS;
  const byKey = new Map(NEW_OPPS_COLUMNS.map((c) => [c.key, c]));
  const selected = new Set([...keys, 'Account']);
  const columns = NEW_OPPS_COLUMNS.filter((c) => selected.has(c.key));

  const SE_GREEN_DARK = 'FF009530';
  const SE_GREEN_LIGHT = 'FFE6F7EC';
  const SE_GREEN = 'FF3DCD58';
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();
  const ws = wb.addWorksheet('New Opps', {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
  });
  ws.columns = columns.map((c) => ({ width: Math.min(Math.max(c.label.length + 4, 16), 40) }));

  ws.mergeCells(1, 1, 1, columns.length);
  const title = ws.getCell(1, 1);
  title.value = `New Opportunities · last ${days} days · ${records.length} opp${records.length === 1 ? '' : 's'}`;
  title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 6;

  const headerRow = ws.getRow(3);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
  });
  headerRow.height = 22;

  records.forEach((r, idx) => {
    const row = ws.getRow(4 + idx);
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = cellValue(r, byKey.get(col.key) || col);
      cell.font = { name: 'Nunito Sans', size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: col.align === 'right' ? 'right' : 'left', indent: 1, wrapText: false };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FCF8' } };
    });
    row.height = 18;
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---- Send via Gmail (SMTP + App Password) with the workbook attached ----
export async function sendNewOppsEmail({ to, subject, message, buffer, filename, replyTo, days = NEW_OPPS_WINDOW_DAYS }) {
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
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto">
      <h2 style="color:#009530;margin:0 0 8px">New Opportunities</h2>
      ${intro}
      <p style="color:#5A6B7E;font-size:13px;margin:0">The opportunities created in the past ${days} days are attached as an Excel file.</p>
      <p style="color:#8896A6;font-size:11px;margin-top:24px">Sent automatically from Prospect Tracker.</p>
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
    attachments: [{
      filename: filename || 'new-opps.xlsx',
      content: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
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

// Filename stamped with today's date, matching the client export.
export function newOppsFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `new-opps-${date}.xlsx`;
}
