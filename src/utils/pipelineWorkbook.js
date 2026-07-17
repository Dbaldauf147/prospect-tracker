// Pipeline tab → Schneider-Electric-formatted Excel report.
//
// Mirrors the house ExcelJS style used by portfolioCompaniesWorkbook.js:
// the SE "Life is On" green palette, Nunito Sans, a three-row branded header
// band per sheet (title / subtitle / column headers), frozen panes, thin
// SE borders and the repo-standard blob-anchor download. ExcelJS is lazy
// imported so it never lands in the main bundle.
//
// The caller (PipelineView) passes an already-computed payload — this module
// only formats; it does no metric math of its own.

// Schneider Electric brand palette (ExcelJS ARGB — note the FF alpha prefix).
const SE_GREEN = 'FF3DCD58';       // Life is On green — title band
const SE_GREEN_DARK = 'FF009530';  // header / section band
const SE_TEXT_DARK = 'FF1E293B';
const SE_ZEBRA = 'FFF6F9F4';
const SE_BORDER = 'FFD4DDE1';
const SE_MUTED = 'FF64748B';
const FONT = 'Nunito Sans';

// Status tints reused from the app's green / yellow / red convention.
const OK_FILL = 'FFDCFCE7', OK_FG = 'FF166534';
const WARN_FILL = 'FFFEF9C3', WARN_FG = 'FF854D0E';
const BAD_FILL = 'FFFEE2E2', BAD_FG = 'FF991B1B';

const MONEY = '$#,##0';
const PCT = '0%';
const PCT1 = '0.0%';
const INT = '#,##0';

const thin = { style: 'thin', color: { argb: SE_BORDER } };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Write the two-row brand band (title + subtitle) spanning `colCount` columns;
// returns the row index where the caller should place its column headers.
function brandBand(ws, colCount, subtitle) {
  ws.mergeCells(1, 1, 1, colCount);
  const t = ws.getCell(1, 1);
  t.value = 'Schneider Electric';
  t.font = { name: FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colCount);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, italic: true, size: 10, color: { argb: SE_MUTED } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  return 3;
}

// A green-dark column-header row.
function headerRow(ws, rowIdx, headers, aligns = []) {
  const row = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    c.alignment = { vertical: 'middle', horizontal: aligns[i] || 'left', wrapText: true, indent: aligns[i] === 'left' || !aligns[i] ? 1 : 0 };
    c.border = allThin;
  });
  row.height = 28;
}

// A full-width green-dark section title (for the KV summary + notes sheets).
function sectionTitle(ws, rowIdx, colCount, text) {
  ws.mergeCells(rowIdx, 1, rowIdx, colCount);
  const c = ws.getCell(rowIdx, 1);
  c.value = text;
  c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(rowIdx).height = 22;
}

function styleBody(cell, { align = 'left', numFmt, bold = false, zebra = false, fill, fg, size = 10, wrap = false, vertical = 'middle' } = {}) {
  cell.font = { name: FONT, size, bold, color: { argb: fg || SE_TEXT_DARK } };
  cell.alignment = { vertical, horizontal: align, indent: align === 'left' ? 1 : 0, wrapText: wrap };
  cell.border = allThin;
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  else if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_ZEBRA } };
  if (numFmt) cell.numFmt = numFmt;
}

// Green when the actual beats the goal, red when it misses — matching the
// on-screen compareClass. dir: 'higher' (actual ≥ goal good) or 'lower'.
function cmpTint(actual, goal, dir = 'higher') {
  const a = num(actual), g = num(goal);
  if (a == null || g == null || g === 0) return null;
  const good = dir === 'higher' ? a >= g : a <= g;
  return good ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG };
}

// ── Single-tab layout ───────────────────────────────────────────────────
// Everything on one polished worksheet: a brand band, a KPI card strip, the
// per-stage metrics table (grouped two-row header), Current-Client-vs-
// Greenfield, New Opps by Month, Client Renewals and the strategy notes —
// stacked over a shared 13-column grid with merges so each section reads as
// its own card.
function buildSingleSheet(wb, p, { lbl, sub }) {
  const COLS = 13;
  const ws = wb.addWorksheet('Pipeline Report', {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  ws.columns = [20, 11, 12, 11, 12, 12, 12, 10, 11, 13, 11, 11, 22].map(w => ({ width: w }));

  // Merge a block and style every covered cell (so the full outline renders),
  // writing `value` into the anchor.
  const put = (r1, c1, r2, c2, value, opts = {}) => {
    if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1, r2, c2);
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) {
        const cell = ws.getCell(rr, cc);
        if (rr === r1 && cc === c1) cell.value = value === '' || value == null ? null : value;
        styleBody(cell, opts);
      }
    }
  };
  const HEAD = { bold: true, fg: 'FFFFFFFF', fill: SE_GREEN_DARK, align: 'center', wrap: true };

  let r = brandBand(ws, COLS, sub);
  const gap = (h = 6) => { ws.getRow(r).height = h; r++; };
  const title = (text) => { sectionTitle(ws, r, COLS, text); r++; };

  // ── KPI card strip (6 cards × 2 cols) ──
  gap();
  const cg = p.clientGreenfield;
  const kpis = [
    { label: lbl('q-target', 'Target'), value: num(p.quota.target), fmt: MONEY },
    { label: lbl('q-closed-ytd', 'Closed YTD'), value: num(p.quota.closedYTD), fmt: MONEY },
    { label: lbl('q-pct-quota', '% of Quota'), value: num(p.quota.pctOfQuota), fmt: PCT1 },
    { label: 'Coverage Ratio', value: num(p.coverage.actual), fmt: '0.00', tint: cmpTint(p.coverage.actual, p.coverage.goal, 'higher') },
    { label: '% Not Quoted (Yr)', value: num(p.notQuoted.year), fmt: PCT, tint: cmpTint(p.notQuoted.year, p.notQuoted.goal, 'lower') },
    { label: 'Current Client %', value: num(cg.clientActualPct), fmt: PCT, tint: cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower') },
  ];
  kpis.forEach((k, i) => {
    const c0 = i * 2 + 1;
    const c1 = i === kpis.length - 1 ? COLS : c0 + 1; // last card fills to the right edge
    put(r, c0, r, c1, k.label.toUpperCase(), { align: 'center', bold: true, size: 8, fg: SE_MUTED, fill: 'FFEFF7F0' });
    put(r + 1, c0, r + 1, c1, k.value, { align: 'center', bold: true, size: 15, numFmt: k.fmt, fill: k.tint ? k.tint.fill : 'FFFFFFFF', fg: k.tint ? k.tint.fg : SE_TEXT_DARK });
  });
  ws.getRow(r).height = 15; ws.getRow(r + 1).height = 26;
  r += 2;

  // ── Pipeline Metrics (grouped two-row header) ──
  gap();
  title(lbl('t-pipeline-metrics', 'Pipeline Metrics'));
  const h1 = r, h2 = r + 1;
  put(h1, 1, h2, 1, lbl('m-stage', 'Stage'), { ...HEAD, align: 'left' });
  put(h1, 2, h1, 3, lbl('m-active-opps', 'Active Opportunities'), HEAD);
  put(h1, 4, h1, 5, lbl('m-deal-size', 'Deal Size'), HEAD);
  put(h1, 6, h1, 7, lbl('m-pipeline', 'Pipeline'), HEAD);
  put(h1, 8, h1, 9, lbl('m-close-rate', 'Close Rate'), HEAD);
  put(h1, 10, h2, 10, lbl('m-target-proj', 'Target Projection'), HEAD);
  put(h1, 11, h1, 12, lbl('m-opp-life', 'Avg Opp Life'), HEAD);
  put(h1, 13, h2, 13, lbl('m-flagged-opps', 'Flagged Opps'), HEAD);
  ['Goal', 'Actual', 'Goal', 'Actual', 'Goal', 'Actual', 'Goal', 'Actual'].forEach((t, i) => put(h2, 2 + i, h2, 2 + i, t, HEAD));
  put(h2, 11, h2, 11, 'Goal', HEAD);
  put(h2, 12, h2, 12, 'Actual', HEAD);
  ws.getRow(h1).height = 16; ws.getRow(h2).height = 16;
  r += 2;

  const metricRow = (s, opts) => {
    // Show the flagged opps by name (comma-separated, single line) rather than
    // a bare count. The Flagged Opps column is the last one, so a long list
    // overflows cleanly to the right instead of wrapping.
    const flaggedNames = (s.flaggedNames || []).join(', ');
    const flagged = s.flaggedCount
      ? (s.flaggedLabel ? `${s.flaggedLabel}: ${flaggedNames}` : flaggedNames)
      : '—';
    const cells = [
      [s.label, 'left', null, null],
      [num(s.activeGoal), 'right', INT, null],
      [num(s.activeActual), 'right', INT, cmpTint(s.activeActual, s.activeGoal, 'higher')],
      [num(s.dealSizeGoal), 'right', MONEY, null],
      [num(s.dealSizeActual), 'right', MONEY, cmpTint(s.dealSizeActual, s.dealSizeGoal, 'higher')],
      [num(s.pipelineGoal), 'right', MONEY, null],
      [num(s.pipelineActual), 'right', MONEY, cmpTint(s.pipelineActual, s.pipelineGoal, 'higher')],
      [num(s.closeGoal), 'right', PCT, null],
      [num(s.closeActual), 'right', PCT, cmpTint(s.closeActual, s.closeGoal, 'higher')],
      [num(s.targetProjGoal), 'right', MONEY, null],
      [num(s.lifeGoal), 'right', INT, null],
      [num(s.lifeActual), 'right', INT, cmpTint(s.lifeActual, s.lifeGoal, 'lower')],
      [flagged, 'left', null, s.flaggedCount ? { fill: WARN_FILL, fg: WARN_FG } : null],
    ];
    cells.forEach(([v, align, numFmt, tint], i) => {
      const cell = ws.getRow(r).getCell(i + 1);
      cell.value = v === '' || v == null ? null : v;
      styleBody(cell, { align, numFmt, ...opts, ...(tint || {}) });
    });
    ws.getRow(r).height = 17;
    r++;
  };
  p.stages.forEach((s, i) => metricRow(s, { zebra: i % 2 === 1 }));
  // Total row
  const t = p.totals;
  const totCells = [
    [lbl('m-total', 'Total'), 'left', null],
    [num(t.activeGoal), 'right', INT], [num(t.activeActual), 'right', INT],
    [num(t.dealSizeGoal), 'right', MONEY], [num(t.dealSizeActual), 'right', MONEY],
    [num(t.pipelineGoal), 'right', MONEY], [num(t.pipelineActual), 'right', MONEY],
    ['', 'right', null], [num(t.closeRate), 'right', PCT],
    [num(t.targetProjGoal), 'right', MONEY],
    [num(t.lifeGoal), 'right', INT], [num(t.lifeActual), 'right', INT],
    ['', 'left', null],
  ];
  totCells.forEach(([v, align, numFmt], i) => {
    const cell = ws.getRow(r).getCell(i + 1);
    cell.value = v === '' || v == null ? null : v;
    styleBody(cell, { align, numFmt, bold: true, fill: OK_FILL });
  });
  ws.getRow(r).height = 18; r++;

  // ── Current Client vs Greenfield ──
  gap();
  title('Current Client vs Greenfield');
  put(r, 1, r, 4, 'Segment', { ...HEAD, align: 'left' });
  put(r, 5, r, 7, 'Opps', { ...HEAD, align: 'left' });
  put(r, 8, r, 10, 'Amount', { ...HEAD, align: 'left' });
  put(r, 11, r, 13, 'Client Mix', { ...HEAD, align: 'left' });
  r++;
  put(r, 1, r, 4, 'Current client', { bold: true });
  put(r, 5, r, 7, num(cg.clientCount), { align: 'left', numFmt: INT });
  put(r, 8, r, 10, num(cg.clientAmt), { align: 'left', numFmt: MONEY });
  put(r, 11, r, 13, cg.clientGoalPct != null ? `Goal ${Math.round(cg.clientGoalPct * 100)}%` : '—', { align: 'left' });
  r++;
  put(r, 1, r, 4, 'Greenfield', { bold: true });
  put(r, 5, r, 7, num(cg.greenfieldCount), { align: 'left', numFmt: INT });
  put(r, 8, r, 10, num(cg.greenfieldAmt), { align: 'left', numFmt: MONEY });
  put(r, 11, r, 13, cg.clientActualPct != null ? `Actual ${Math.round(cg.clientActualPct * 100)}%` : '—', { align: 'left', ...(cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower') || {}) });
  r++;

  // ── New Opps by Month (horizontal) ──
  gap();
  title(`${lbl('nom-month', 'Month')} · ${lbl('nom-new-opps', 'New Opps')}`);
  const months = p.newOppsByMonth || [];
  put(r, 1, r, 1, lbl('nom-month', 'Month'), HEAD);
  put(r + 1, 1, r + 1, 1, lbl('nom-new-opps', 'New Opps'), { ...HEAD, align: 'left' });
  months.slice(0, 6).forEach((m, i) => {
    const c0 = 2 + i * 2;
    put(r, c0, r, c0 + 1, m.label, HEAD);
    put(r + 1, c0, r + 1, c0 + 1, num(m.count), { align: 'center', bold: true, numFmt: INT, ...(m.count >= 5 ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG }) });
  });
  ws.getRow(r).height = 16; ws.getRow(r + 1).height = 18;
  r += 2;

  // ── Service Exploration Coverage ──
  // Only rendered when the user tracks at least one service on the Pipeline
  // page — otherwise the section is omitted entirely (no empty shell).
  {
    const sc = p.serviceCoverage || {};
    const scRows = sc.rows || [];
    if (scRows.length) {
      gap();
      title(sc.title || 'Service Exploration Coverage');
      const scCols = [[1, 7], [8, 9], [10, 11], [12, 13]]; // Service | Explored | Clients | Coverage
      const scHdr = sc.headers || ['Service', 'Explored', 'Clients', 'Coverage'];
      scHdr.forEach((h, i) => put(r, scCols[i][0], r, scCols[i][1], h, { ...HEAD, align: 'left' }));
      r++;
      scRows.forEach((row, idx) => {
        const zebra = idx % 2 === 1 ? { zebra: true } : {};
        put(r, scCols[0][0], r, scCols[0][1], row.service || '—', { align: 'left', wrap: true, ...zebra });
        put(r, scCols[1][0], r, scCols[1][1], num(row.explored), { align: 'left', numFmt: INT, ...zebra });
        put(r, scCols[2][0], r, scCols[2][1], num(row.total), { align: 'left', numFmt: INT, ...zebra });
        put(r, scCols[3][0], r, scCols[3][1], num(row.pct), { align: 'left', numFmt: PCT, bold: true, ...zebra });
        r++;
      });
    }
  }

  // ── Client Renewals ──
  gap();
  title(lbl('ren-title', `Client Renewals — Contracts Expiring Within ${p.renewals.windowDays} Days`));
  const renCols = [[1, 2], [3, 4], [5, 6], [7, 9], [10, 11], [12, 13]];
  const renHdr = [lbl('ren-client', 'Client'), lbl('ren-status', 'Renewal Status'), lbl('ren-client-manager', 'Client Manager'), lbl('ren-decision-maker', 'Decision Maker'), lbl('ren-invited', 'Invited to Louisville'), lbl('ren-days-until', 'Days Until Expiration')];
  renHdr.forEach((h, i) => put(r, renCols[i][0], r, renCols[i][1], h, { ...HEAD, align: 'left' }));
  r++;
  const renRows = p.renewals.rows || [];
  if (!renRows.length) {
    put(r, 1, r, COLS, `No clients with contracts expiring in the next ${p.renewals.windowDays} days.`, { fg: SE_MUTED });
    r++;
  } else {
    renRows.forEach((row, idx) => {
      const zebra = idx % 2 === 1;
      const overdue = num(row.daysUntil) != null && row.daysUntil < 0;
      const vals = [row.company || '—', row.renewalStatus || '—', row.clientManager || '—', row.decisionMaker || '—', row.invited || '—', num(row.daysUntil)];
      vals.forEach((v, i) => {
        const isDays = i === 5;
        put(r, renCols[i][0], r, renCols[i][1], v === '' || v == null ? null : v, {
          align: 'left', numFmt: isDays ? INT : undefined, wrap: i === 3,
          ...(isDays && overdue ? { fill: BAD_FILL, fg: BAD_FG } : (zebra ? { zebra: true } : {})),
        });
      });
      r++;
    });
  }

  // ── Strategic Accounts — My Accounts ──
  {
    const sa = p.strategicAccounts || {};
    gap();
    title(sa.title || 'Strategic Accounts — My Accounts');
    const saCols = [[1, 6], [7, 10], [11, 13]]; // Account | Account Owner | Type
    const saHdr = sa.headers || ['Account', 'Account Owner', 'Type'];
    saHdr.forEach((h, i) => put(r, saCols[i][0], r, saCols[i][1], h, { ...HEAD, align: 'left' }));
    r++;
    const saRows = sa.rows || [];
    if (!saRows.length) {
      put(r, 1, r, COLS, 'No strategic accounts mapped to My Accounts.', { fg: SE_MUTED });
      r++;
    } else {
      saRows.forEach((row, idx) => {
        const zebra = idx % 2 === 1;
        const vals = [row.account || '—', row.owner || '—', row.type || '—'];
        vals.forEach((v, i) => put(r, saCols[i][0], r, saCols[i][1], v, { align: 'left', wrap: i === 0, ...(zebra ? { zebra: true } : {}) }));
        r++;
      });
    }
  }

  // ── Strategy Notes ──
  gap();
  (p.notes || []).forEach(({ title: nt, text }) => {
    title(nt);
    String(text || '').split('\n').forEach((line) => {
      put(r, 1, r, COLS, line, { wrap: true, vertical: 'top' });
      ws.getRow(r).height = Math.max(15, Math.ceil((line.length || 1) / 120) * 14);
      r++;
    });
  });
}

export async function downloadPipelineWorkbook(p) {
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || (exceljs.default && exceljs.default.Workbook);
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();
  const lbl = p.lbl || ((_id, def) => def);
  const dateStr = (p.generatedAt || new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const sub = `Pipeline Report${p.cdmName ? ` — ${p.cdmName}` : ''}  ·  ${dateStr}`;
  if (!p.hasBfo) {
    // Not fatal — the report still exports the manually-entered numbers.
    wb.description = 'BFO Activity not loaded; live actuals reflect manually entered values.';
  }

  if (p.layout === 'single') {
    buildSingleSheet(wb, p, { lbl, sub });
  } else {

  // ── Sheet 1: Summary (KV blocks) ──────────────────────────────────────
  {
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    ws.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 20 }];
    let r = brandBand(ws, 4, sub);

    const kv = (label, value, numFmt, tint) => {
      const a = ws.getCell(r, 1); a.value = label;
      styleBody(a, { bold: true });
      const b = ws.getCell(r, 2); b.value = value === '' || value == null ? null : value;
      styleBody(b, { align: 'right', numFmt, ...(tint || {}) });
      // pad remaining cols so borders line up
      styleBody(ws.getCell(r, 3), {}); styleBody(ws.getCell(r, 4), {});
      ws.mergeCells(r, 2, r, 4);
      r++;
    };
    const gap = () => { r++; };

    sectionTitle(ws, r, 4, lbl('t-quota', 'Quota')); r++;
    kv(lbl('q-target', 'Target'), num(p.quota.target), MONEY);
    kv(lbl('q-closed-ytd', 'Closed YTD'), num(p.quota.closedYTD), MONEY);
    kv(lbl('q-pct-quota', '% of Quota'), num(p.quota.pctOfQuota), PCT1);
    gap();

    sectionTitle(ws, r, 4, lbl('cov-title', 'Coverage Ratio')); r++;
    kv(lbl('cov-goal', 'Goal'), num(p.coverage.goal), '0.00');
    kv(lbl('cov-actual', 'Actual'), num(p.coverage.actual), '0.00', cmpTint(p.coverage.actual, p.coverage.goal, 'higher'));
    gap();

    sectionTitle(ws, r, 4, lbl('nq-title', '% of deals not Quoted')); r++;
    kv(lbl('nq-goal', 'Goal'), num(p.notQuoted.goal), PCT);
    kv(lbl('nq-actual-year', 'Actual Year'), num(p.notQuoted.year), PCT, cmpTint(p.notQuoted.year, p.notQuoted.goal, 'lower'));
    kv(lbl('nq-actual-month', 'Actual Month'), num(p.notQuoted.month), PCT, cmpTint(p.notQuoted.month, p.notQuoted.goal, 'lower'));
    gap();

    sectionTitle(ws, r, 4, 'Current Client vs Greenfield'); r++;
    const cg = p.clientGreenfield;
    kv(lbl('cg-row-client-opps', 'Current client opps'), num(cg.clientCount), INT);
    kv(lbl('cg-row-green-opps', 'Greenfield opps'), num(cg.greenfieldCount), INT);
    kv(lbl('cg-row-client-amt', 'Current client $'), num(cg.clientAmt), MONEY);
    kv(lbl('cg-row-green-amt', 'Greenfield $'), num(cg.greenfieldAmt), MONEY);
    kv(`${lbl('cg-goal-client', 'Goal - Client')} %`, num(cg.clientGoalPct), PCT);
    kv(`${lbl('cg-actual-client', 'Actual - Client')} %`, num(cg.clientActualPct), PCT, cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower'));
  }

  // ── Sheet 2: Pipeline Metrics (per-stage) ─────────────────────────────
  {
    const headers = [
      lbl('m-stage', 'Stage'),
      'Active Opps Goal', 'Active Opps Actual',
      'Deal Size Goal', 'Deal Size Actual',
      'Pipeline Goal', 'Pipeline Actual',
      'Close Rate Goal', 'Close Rate Actual',
      lbl('m-target-proj', 'Target Projection'),
      'Avg Opp Life Goal', 'Avg Opp Life Actual',
      lbl('m-flagged-opps', 'Flagged Opps'),
    ];
    const widths = [16, 14, 15, 13, 14, 14, 14, 13, 14, 15, 14, 15, 26];
    const aligns = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'];
    const ws = wb.addWorksheet('Pipeline Metrics', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }],
    });
    ws.columns = widths.map(w => ({ width: w }));
    const hdrRow = brandBand(ws, headers.length, sub);
    headerRow(ws, hdrRow, headers, aligns);

    let r = hdrRow + 1;
    p.stages.forEach((s, idx) => {
      const zebra = idx % 2 === 1;
      const row = ws.getRow(r);
      const cells = [
        [s.label, 'left', null],
        [num(s.activeGoal), 'right', INT],
        [num(s.activeActual), 'right', INT, cmpTint(s.activeActual, s.activeGoal, 'higher')],
        [num(s.dealSizeGoal), 'right', MONEY],
        [num(s.dealSizeActual), 'right', MONEY, cmpTint(s.dealSizeActual, s.dealSizeGoal, 'higher')],
        [num(s.pipelineGoal), 'right', MONEY],
        [num(s.pipelineActual), 'right', MONEY, cmpTint(s.pipelineActual, s.pipelineGoal, 'higher')],
        [num(s.closeGoal), 'right', PCT],
        [num(s.closeActual), 'right', PCT, cmpTint(s.closeActual, s.closeGoal, 'higher')],
        [num(s.targetProjGoal), 'right', MONEY],
        [num(s.lifeGoal), 'right', INT],
        [num(s.lifeActual), 'right', INT, cmpTint(s.lifeActual, s.lifeGoal, 'lower')],
        [s.flaggedLabel && s.flaggedCount ? `${s.flaggedLabel}: ${s.flaggedCount}` : (s.flaggedCount ? String(s.flaggedCount) : '—'), 'left', null,
          s.flaggedCount ? { fill: WARN_FILL, fg: WARN_FG } : null],
      ];
      cells.forEach(([v, align, numFmt, tint], i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        styleBody(cell, { align, numFmt, zebra: zebra && !tint, ...(tint || {}) });
      });
      row.height = 18;
      r++;
    });

    // Total row
    const t = p.totals;
    const totRow = ws.getRow(r);
    const totCells = [
      [lbl('m-total', 'Total'), 'left', null],
      [num(t.activeGoal), 'right', INT],
      [num(t.activeActual), 'right', INT],
      [num(t.dealSizeGoal), 'right', MONEY],
      [num(t.dealSizeActual), 'right', MONEY],
      [num(t.pipelineGoal), 'right', MONEY],
      [num(t.pipelineActual), 'right', MONEY],
      ['', 'right', null],
      [num(t.closeRate), 'right', PCT],
      [num(t.targetProjGoal), 'right', MONEY],
      [num(t.lifeGoal), 'right', INT],
      [num(t.lifeActual), 'right', INT],
      ['', 'left', null],
    ];
    totCells.forEach(([v, align, numFmt], i) => {
      const cell = totRow.getCell(i + 1);
      cell.value = v === '' || v == null ? null : v;
      styleBody(cell, { align, numFmt, bold: true, fill: OK_FILL, fg: SE_TEXT_DARK });
    });
    totRow.height = 20;

    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  // ── Sheet 3: New Opps by Month ────────────────────────────────────────
  {
    const headers = [lbl('nom-month', 'Month'), lbl('nom-new-opps', 'New Opps')];
    const ws = wb.addWorksheet('New Opps by Month', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    ws.columns = [{ width: 20 }, { width: 14 }];
    const hdrRow = brandBand(ws, headers.length, sub);
    headerRow(ws, hdrRow, headers, ['left', 'right']);
    let r = hdrRow + 1;
    (p.newOppsByMonth || []).forEach((m, idx) => {
      const a = ws.getCell(r, 1); a.value = m.label; styleBody(a, { zebra: idx % 2 === 1 });
      const b = ws.getCell(r, 2); b.value = num(m.count);
      styleBody(b, { align: 'right', numFmt: INT, ...(m.count >= 5 ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG }) });
      ws.getRow(r).height = 18;
      r++;
    });
    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
  }

  // ── Sheet 4: Client Renewals ──────────────────────────────────────────
  {
    const headers = [
      lbl('ren-client', 'Client'),
      lbl('ren-status', 'Renewal Status'),
      lbl('ren-client-manager', 'Client Manager'),
      lbl('ren-decision-maker', 'Decision Maker'),
      lbl('ren-invited', 'Invited to Louisville'),
      lbl('ren-days-until', 'Days Until Expiration'),
    ];
    const widths = [30, 20, 20, 24, 18, 18];
    const ws = wb.addWorksheet('Client Renewals', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }],
    });
    ws.columns = widths.map(w => ({ width: w }));
    const hdrRow = brandBand(ws, headers.length, lbl('ren-title', `Client Renewals — Contracts Expiring Within ${p.renewals.windowDays} Days`));
    headerRow(ws, hdrRow, headers, ['left', 'left', 'left', 'left', 'left', 'right']);
    let r = hdrRow + 1;
    (p.renewals.rows || []).forEach((row, idx) => {
      const zebra = idx % 2 === 1;
      const overdue = num(row.daysUntil) != null && row.daysUntil < 0;
      const vals = [
        [row.company || '—', 'left', null],
        [row.renewalStatus || '—', 'left', null],
        [row.clientManager || '—', 'left', null],
        [row.decisionMaker || '—', 'left', null],
        [row.invited || '—', 'left', null],
        [num(row.daysUntil), 'right', INT, overdue ? { fill: BAD_FILL, fg: BAD_FG } : null],
      ];
      vals.forEach(([v, align, numFmt, tint], i) => {
        const cell = ws.getRow(r).getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        styleBody(cell, { align, numFmt, zebra: zebra && !tint, ...(tint || {}) });
      });
      ws.getRow(r).height = 18;
      r++;
    });
    if (!(p.renewals.rows || []).length) {
      ws.mergeCells(r, 1, r, headers.length);
      const c = ws.getCell(r, 1);
      c.value = `No clients with contracts expiring in the next ${p.renewals.windowDays} days.`;
      styleBody(c, { align: 'left', fg: SE_MUTED });
    }
    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  // ── Sheet 5: Strategy Notes ───────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Strategy Notes', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    ws.columns = [{ width: 110 }];
    let r = brandBand(ws, 1, sub);
    (p.notes || []).forEach(({ title, text }) => {
      sectionTitle(ws, r, 1, title); r++;
      const lines = String(text || '').split('\n');
      lines.forEach((line) => {
        const c = ws.getCell(r, 1);
        c.value = line;
        c.font = { name: FONT, size: 10, color: { argb: SE_TEXT_DARK } };
        c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(r).height = Math.max(16, Math.ceil((line.length || 1) / 100) * 15);
        r++;
      });
      r++; // blank line between sections
    });
  }

  } // end multi-sheet layout

  // ── Download (repo-standard blob-anchor idiom) ────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = (p.generatedAt || new Date()).toISOString().slice(0, 10);
  a.href = url;
  a.download = `Pipeline Report${p.layout === 'single' ? ' (1 page)' : ''} — ${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
