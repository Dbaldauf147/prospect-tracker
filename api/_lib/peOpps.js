// Shared PE Opps helpers used by the scheduled-email cron
// (api/pe-opps-scheduler.js) and the "send now" route
// (api/pe-opps-send-now.js).
//
// The on-screen PE Opps tab (src/components/PEPortfolioView) builds the
// same SE-branded workbook client-side from the Opps 2 store. This module
// rebuilds it server-side from the user's `opps2Data` Firestore doc so a
// schedule can fire without the browser open. The column set, filter
// rules and Excel styling are kept in lock-step with the client so a
// scheduled file matches what the user would get from the Export button.

// ---- Column definitions (mirror PEOppsTab.ALL_COLUMNS) ------------------
export const PE_OPPS_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Type', label: 'Type' },
  { key: 'Source', label: 'Source' },
  { key: 'Sales Partner', label: 'Sales Partner' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Status', label: 'Status' },
  { key: 'BFO Link', label: 'BFO Opportunity Name' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'Last Client Heard From Us', label: 'Last Client Heard From Us' },
  { key: 'Call In', label: 'Call In', align: 'right', value: resolveCallIn },
  { key: 'Close Date', label: 'Close Date' },
];

export const PE_OPPS_COLUMN_KEYS = PE_OPPS_COLUMNS.map((c) => c.key);

// ---- Opps-cell helpers (mirror PEPortfolioView) -------------------------
const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

function parseOppsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// Resolve a row's "Call In" exactly the way Opps 2 / the PE Opps tab does:
// a blank-sentinel stored value wins; otherwise it's the calendar-day
// count from today to the Follow Up date, falling back to the stored
// number when there's no parseable Follow Up.
function resolveCallIn(r) {
  if (r && 'Call In' in r) {
    const s = r['Call In'] == null ? '' : String(r['Call In']).trim();
    if (BLANK_SENTINELS.has(s)) return '';
  }
  const followUp = parseOppsDate(r['Follow Up']);
  if (followUp) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    followUp.setHours(0, 0, 0, 0);
    return String(Math.round((followUp - today) / 86400000));
  }
  if (r && 'Call In' in r) {
    const n = parseFloat(String(r['Call In']).replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return String(n);
  }
  return '';
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// ---- Load + filter the user's PE opps from Firestore --------------------
// Reads `opps2Data/{uid}` (reassembling the chunked JSON when present) and
// applies the same PE filter the PE Opps tab uses: Type = "Private Equity"
// OR Source = "PE partner", dropping opps closed (Sold / Not Sold) more
// than a month ago.
export async function loadPeOpps(db, uid) {
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

  const norm = (s) => String(s || '').trim().toLowerCase();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);
  return records.filter((r) => {
    const type = norm(r['Type']);
    const source = norm(r['Source']);
    if (type !== 'private equity' && source !== 'pe partner') return false;
    const stage = norm(r['Stage']);
    if (stage === 'sold' || stage === 'not sold') {
      const closed = parseOppsDate(r['Close Date']);
      if (closed && closed < cutoff) return false;
    }
    return true;
  });
}

// ---- Build the SE-branded workbook (mirror PEOppsTab.handleExport) -------
// Returns a Node Buffer of the .xlsx file. `columnKeys` selects/orders the
// columns; unknown keys are ignored and an empty list falls back to all.
export async function buildPeOppsWorkbook(records, columnKeys) {
  const { Workbook } = await import('exceljs');
  const keys = Array.isArray(columnKeys) && columnKeys.length ? columnKeys : PE_OPPS_COLUMN_KEYS;
  const byKey = new Map(PE_OPPS_COLUMNS.map((c) => [c.key, c]));
  // Account is the row anchor — always keep it, and preserve canonical order.
  const selected = new Set([...keys, 'Account']);
  const columns = PE_OPPS_COLUMNS.filter((c) => selected.has(c.key));

  const SE_GREEN_DARK = 'FF009530';
  const SE_GREEN_LIGHT = 'FFE6F7EC';
  const SE_GREEN = 'FF3DCD58';
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();
  const ws = wb.addWorksheet('PE Opps', {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
  });
  ws.columns = columns.map((c) => ({ width: Math.min(Math.max(c.label.length + 4, 16), 40) }));

  ws.mergeCells(1, 1, 1, columns.length);
  const title = ws.getCell(1, 1);
  title.value = `PE Opportunities · ${records.length} opp${records.length === 1 ? '' : 's'}`;
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
// Uses a Gmail account + App Password (GMAIL_USER / GMAIL_APP_PASSWORD) so
// the digest can be sent to any recipient for free, without a paid email
// domain. The message is sent from — and replies go to — the Gmail account.
export async function sendPeOppsEmail({ to, subject, message, buffer, filename, replyTo }) {
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
      <h2 style="color:#009530;margin:0 0 8px">PE Opportunities</h2>
      ${intro}
      <p style="color:#5A6B7E;font-size:13px;margin:0">The latest PE opportunities are attached as an Excel file.</p>
      <p style="color:#8896A6;font-size:11px;margin-top:24px">Sent automatically from Prospect Tracker.</p>
    </div>
  `;

  const { default: nodemailer } = await import('nodemailer');
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
    subject: subject || 'PE Opportunities',
    html,
    attachments: [{
      filename: filename || 'pe-opps.xlsx',
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
export function peOppsFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `pe-opps-${date}.xlsx`;
}
