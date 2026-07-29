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
  { key: 'Contact', label: 'Contacts' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Type', label: 'Type' },
  { key: 'Source', label: 'Source' },
  { key: 'Sales Partner', label: 'Sales Partner' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Status', label: 'Status' },
  { key: 'BFO Link', label: 'BFO Opportunity Name' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'Last Client Heard From Us', label: 'Last Client Heard From Us', value: formatLastHeardDate },
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

// Render the "Last Client Heard From Us" value as a short M/D/YYYY date in
// local time, mirroring formatDateDisplay from src/utils/oppsCallIn so the
// scheduled email matches the on-screen PE Opps tab. Falls back to the raw
// string when it can't be parsed, and leaves blanks untouched.
function formatLastHeardDate(r) {
  const raw = r['Last Client Heard From Us'];
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const d = parseOppsDate(s);
  if (!d) return s;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// ---- Account ↔ company matching (mirror PEPortfolioView) -----------------
// Used to tie an opp's Account to a PE firm or one of its portfolio
// companies. Kept in lock-step with the client so a firm-scoped scheduled
// file matches what the PE Opps tab shows for that firm.
const CO_SUFFIX_RE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|holdings?)\b\.?/gi;
function normalizeAccount(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CO_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function accountMatchesCompany(companyName, oppAccount) {
  const a = normalizeAccount(companyName);
  const b = normalizeAccount(oppAccount);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const [shortW, longW] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  if (shortW.length < 2) return false;
  return (' ' + longW.join(' ') + ' ').includes(' ' + shortW.join(' ') + ' ');
}

// Split a comma/semicolon PE Owner string into individual firm names,
// gluing a lone corporate suffix back onto the previous name (mirror
// src/utils/peOwners.splitPeOwners).
const CORP_SUFFIX_FRAGMENT = /^(l\.?l\.?c|l\.?p|l\.?l\.?p|inc|incorporated|ltd|limited|plc|co|corp|corporation|s\.?a|n\.?v|gmbh|ag)\.?$/i;
function splitPeOwners(value) {
  const out = [];
  for (const raw of String(value || '').split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    if (out.length > 0 && CORP_SUFFIX_FRAGMENT.test(part)) out[out.length - 1] += `, ${part}`;
    else out.push(part);
  }
  return out;
}
function prospectOwnedByFirm(peOwnerStr, firm) {
  const f = String(firm || '').trim().toLowerCase();
  if (!f) return false;
  return splitPeOwners(peOwnerStr).some((o) => {
    const t = o.trim().toLowerCase();
    if (!t) return false;
    if (t.includes(f)) return true;
    if (t.length >= 4 && f.includes(t)) return true;
    return false;
  });
}

// Drop deals closed (Sold / Not Sold) more than a month ago — the same
// recency rule the PE Opps tab applies, used by both the all-PE and the
// firm-scoped loaders.
function passesRecency(r) {
  const stage = String(r['Stage'] || '').trim().toLowerCase();
  if (stage === 'sold' || stage === 'not sold') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const closed = parseOppsDate(r['Close Date']);
    if (!closed || closed < cutoff) return false;
  }
  return true;
}

// ---- Read the user's raw Opps 2 records from Firestore -------------------
// Reads `opps2Data/{uid}`, reassembling the chunked JSON when present.
// Returns every stored opp record (no filtering).
async function readOpps2Records(db, uid) {
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

// ---- Load + filter the user's PE opps from Firestore --------------------
// Applies the same PE filter the PE Opps tab uses: Type = "Private Equity"
// OR Source = "PE partner", dropping opps closed (Sold / Not Sold) more
// than a month ago.
export async function loadPeOpps(db, uid) {
  const records = await readOpps2Records(db, uid);
  const norm = (s) => String(s || '').trim().toLowerCase();
  return records.filter((r) => {
    const type = norm(r['Type']);
    const source = norm(r['Source']);
    if (type !== 'private equity' && source !== 'pe partner') return false;
    return passesRecency(r);
  });
}

// ---- Load all opps tied to one PE firm or its portfolio companies --------
// Mirrors the PE Opps tab's firm picker (the "all opps on the firm + owned
// companies" scope): every opp — regardless of Type / Source — whose
// Account matches the firm itself or any prospect whose PE Owner names the
// firm. The recency rule still applies so the digest stays focused. Falls
// back to the all-PE list when no firm is given.
export async function loadOppsForFirm(db, uid, email, firm) {
  const f = String(firm || '').trim();
  if (!f) return loadPeOpps(db, uid);
  const [records, prospects] = await Promise.all([
    readOpps2Records(db, uid),
    loadProspectsForUser(db, uid, email),
  ]);
  const names = new Set([f.toLowerCase()]);
  for (const p of prospects) {
    if (prospectOwnedByFirm(p.peOwner, f)) {
      const n = String(p.company || '').trim().toLowerCase();
      if (n) names.add(n);
    }
  }
  const nameList = [...names];
  return records.filter((r) => passesRecency(r) && nameList.some((n) => accountMatchesCompany(n, r['Account'])));
}

// ---- Load the user's prospects (raw) ------------------------------------
// Admin (baldaufdan@gmail.com) reads the shared `prospects` collection;
// every other user reads `users/{uid}/prospects` — matching
// firestoreSync.getCol and loadPeFirms below.
async function loadProspectsForUser(db, uid, email) {
  const col = email === 'baldaufdan@gmail.com'
    ? db.collection('prospects')
    : db.collection('users').doc(uid).collection('prospects');
  let snap;
  try { snap = await col.get(); } catch { return []; }
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---- Load the user's PE firms for the PE Stages board -------------------
// Mirrors PEPortfolioView's peFirms + portfolioByPe: every prospect with
// Type = "Private Equity" is a firm, and any prospect's `peOwner` points
// at the firm it belongs to (counted as a portfolio company). Admin
// (baldaufdan@gmail.com) reads the shared `prospects` collection; every
// other user reads `users/{uid}/prospects` — matching firestoreSync.getCol.
export async function loadPeFirms(db, uid, email) {
  const prospects = await loadProspectsForUser(db, uid, email);

  // Portfolio-company count per firm, keyed by lowercased firm name.
  const pcByFirm = new Map();
  for (const p of prospects) {
    const owner = String(p.peOwner || '').trim().toLowerCase();
    if (!owner) continue;
    pcByFirm.set(owner, (pcByFirm.get(owner) || 0) + 1);
  }

  return prospects
    .filter((p) => p.type === 'Private Equity')
    .map((p) => ({
      company: p.company || '',
      peStage: p.peStage || '',
      peAum: p.peAum ?? null,
      geography: p.geography || '',
      pcCount: pcByFirm.get(String(p.company || '').trim().toLowerCase()) || 0,
    }))
    .sort((a, b) => a.company.localeCompare(b.company));
}

// ---- PE Stages board (mirror PEStagesTab.exportToExcel) ------------------
const PE_STAGE_ORDER = ['Discovery', 'Piloting', 'Existing Partnership', 'Not Sold'];
const PE_STAGE_META = [
  { stage: 'Discovery', accent: '2563EB', bg: 'EFF6FF', border: 'BFDBFE' },
  { stage: 'Piloting', accent: 'D97706', bg: 'FFFBEB', border: 'FDE68A' },
  { stage: 'Existing Partnership', accent: '059669', bg: 'ECFDF5', border: 'A7F3D0' },
  { stage: 'Not Sold', accent: 'DC2626', bg: 'FEF2F2', border: 'FECACA' },
  { stage: 'Unassigned', accent: '64748B', bg: 'F8FAFC', border: 'E2E8F0' },
];

// AUM formatting identical to src/utils/formatters.formatAum.
function formatAum(value) {
  if (value == null || value === 0) return '—';
  if (value >= 1) return `$${value.toFixed(1)}B`;
  return `$${(value * 1000).toFixed(0)}M`;
}

// Add the Kanban-style PE Stages worksheet to an existing workbook: one
// column per stage, stacked firm "cards" in each stage's palette. Mirrors
// the on-screen board so the emailed file matches the PE Stages tab.
function addPeStagesSheet(wb, firms) {
  const argb = (hex) => 'FF' + hex.toUpperCase();
  const cardBorder = (m) => ({
    left: { style: 'thick', color: { argb: argb(m.accent) } },
    top: { style: 'thin', color: { argb: argb(m.border) } },
    bottom: { style: 'thin', color: { argb: argb(m.border) } },
    right: { style: 'thin', color: { argb: argb(m.border) } },
  });
  const SE_GREEN_DARK = 'FF009530';
  const SE_GREEN = 'FF3DCD58';

  const ws = wb.addWorksheet('PE Stages', {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
  });

  const stageOf = (f) => (PE_STAGE_ORDER.includes(f.peStage) ? f.peStage : 'Unassigned');
  const groups = new Map(PE_STAGE_META.map((m) => [m.stage, []]));
  for (const f of firms) groups.get(stageOf(f)).push(f);

  // One column per stage with a slim spacer column between them.
  const stageCol = {};
  const colSpecs = [];
  PE_STAGE_META.forEach((m, i) => {
    stageCol[m.stage] = colSpecs.length + 1;
    colSpecs.push({ width: 34 });
    if (i < PE_STAGE_META.length - 1) colSpecs.push({ width: 3 });
  });
  ws.columns = colSpecs;
  const lastCol = colSpecs.length;

  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `PE Stages · ${firms.length} PE firm${firms.length === 1 ? '' : 's'}`;
  title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 6; // spacer

  const headerRow = ws.getRow(3);
  PE_STAGE_META.forEach((m) => {
    const list = groups.get(m.stage) || [];
    const cell = headerRow.getCell(stageCol[m.stage]);
    cell.value = `${m.stage}  (${list.length})`;
    cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.accent) } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  headerRow.height = 24;

  const maxLen = Math.max(0, ...PE_STAGE_META.map((m) => (groups.get(m.stage) || []).length));
  for (let i = 0; i < Math.max(maxLen, 1); i++) {
    const row = ws.getRow(4 + i);
    row.height = 46;
    PE_STAGE_META.forEach((m) => {
      const list = groups.get(m.stage) || [];
      const cell = row.getCell(stageCol[m.stage]);
      const f = list[i];
      if (!f) {
        if (i === 0 && list.length === 0) {
          cell.value = 'No PE firms at this stage.';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.bg) } };
          cell.font = { name: 'Nunito Sans', italic: true, size: 9, color: { argb: 'FF94A3B8' } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = cardBorder(m);
        }
        return;
      }
      cell.value = {
        richText: [
          { text: f.company || '—', font: { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FF1E293B' } } },
          { text: `\n${formatAum(f.peAum)}   ·   ${f.geography || '—'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF475569' } } },
          { text: `\n${f.pcCount} portfolio co${f.pcCount === 1 ? '' : 's'}`, font: { name: 'Nunito Sans', size: 9, color: { argb: 'FF64748B' } } },
        ],
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(m.bg) } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      cell.border = cardBorder(m);
    });
  }
  return ws;
}

// ---- Build the SE-branded workbook (mirror PEOppsTab.handleExport) -------
// Returns a Node Buffer of the .xlsx file. `columnKeys` selects/orders the
// PE Opps columns; unknown keys are ignored and an empty list falls back
// to all. When `firms` is non-empty a second "PE Stages" worksheet is
// appended, mirroring the on-screen PE Stages board.
export async function buildPeOppsWorkbook(records, columnKeys, firms = [], opts = {}) {
  const firmLabel = String(opts.firmLabel || '').trim();
  // exceljs is CommonJS; under Node's ESM loader its classes may sit on
  // `.default` rather than as named exports, so resolve defensively.
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || exceljs.default?.Workbook;
  if (typeof Workbook !== 'function') throw new Error('exceljs Workbook unavailable');
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
  title.value = `${firmLabel ? `${firmLabel} · ` : ''}PE Opportunities · ${records.length} opp${records.length === 1 ? '' : 's'}`;
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

  // Second tab: the PE Stages board, when the caller supplied PE firms.
  if (Array.isArray(firms) && firms.length) addPeStagesSheet(wb, firms);

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
