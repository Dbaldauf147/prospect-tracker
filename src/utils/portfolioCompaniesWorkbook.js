// Shared Portfolio Companies workbook export.
//
// This is the single source of truth for the polished, Schneider-branded
// \"Portfolio Company Analysis\" Excel file. It is invoked from two places so
// both produce byte-for-byte identical output:
//   1. The company pop-up (ProspectModal) -> \"Download Current Data\" button.
//   2. The PE Portfolio view -> per-firm \"PC Download\" column button.
//
// The sector-scoring helpers below are exported too, since ProspectModal
// reuses them elsewhere (Fit Tier rendering, ranking previews).

import { sanitizeExcelWorkbook } from './exportSanitize.js';
import { STATUS_COLORS } from '../data/enums.js';

// Excel fill/font for a Status cell, derived from the same palette the app
// uses on screen so the workbook can't drift from the UI: the status color
// itself for the text, and that color blended toward white for the fill.
function statusCellColors(status) {
  const hex = STATUS_COLORS[status];
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const tint = (c) => Math.round(c + (255 - c) * 0.85).toString(16).padStart(2, '0').toUpperCase();
  return { fill: `FF${tint(r)}${tint(g)}${tint(b)}`, font: `FF${hex.slice(1).toUpperCase()}` };
}

export const SECTOR_SCORES = {
  'Industrial / Manufacturing': 9.5,
  'Data Centers': 9.3,
  'Cold Storage / Food Mfg': 9.0,
  'Healthcare / Life Sciences': 8.6,
  'Real Estate / Facilities': 8.4,
  'Hospitality / Food Service': 7.8,
  'Retail / Consumer': 6.5,
  'Warehousing / 3PL': 4.2,
  'Tech / Software & Office Occupiers': 3.0,
};

// Fuzzy-match the uploaded Industry value to one of the defined sectors.
// Check order matters: the more specific patterns run first so "Food Mfg"
// isn't swallowed by the generic "manufacturing" rule.
export function industrySector(industry) {
  const s = (industry || '').toLowerCase().trim();
  if (!s) return null;
  // Most specific first — exact sector-label matches always win.
  if (/\bdata\s*cent|datacent|colocation/.test(s)) return 'Data Centers';
  if (/cold\s*storag|food\s*m(fg|anufactur|anuf|nfg)|food\s*process|beverage\s*m(fg|anuf)/.test(s)) return 'Cold Storage / Food Mfg';
  if (/healthcare|life\s*scienc|pharma|biotech|medical|hospital|clinic/.test(s)) return 'Healthcare / Life Sciences';
  // Real Estate / Facilities — incl. facilities management, janitorial, landscaping, security, maintenance
  if (/real\s*estate|facilit|propert|\breit\b|infrastructure|janitor|cleaning\s*serv|landscap|groundskeep|\blawn\b|grounds\s*maint|outdoor\s*maint|pest\s*control|security\s*serv|\bhvac\b|mechanical\s*maint/.test(s)) return 'Real Estate / Facilities';
  if (/hotel|restaurant|food\s*service|lodging|qsr|hospitality|catering/.test(s)) return 'Hospitality / Food Service';
  if (/warehous|\b3pl\b|logistic|distribution|freight|transport|supply\s*chain|last\s*mile/.test(s)) return 'Warehousing / 3PL';
  // Retail / Consumer — incl. consumer auto services (auto glass/repair) before Industrial catches "automotive"
  if (/retail|\bconsumer\b|grocery|apparel|e-?commerce|auto\s*glass|auto\s*repair|vehicle\s*serv|automotive\s*serv/.test(s)) return 'Retail / Consumer';
  // Tech / Office — incl. financial services, insurance, wealth management, professional services
  if (/tech|software|saas|fintech|media|telecom|advertis|\boffice\b|profession|financ|insur|\bbank|asset\s*mgmt|asset\s*managem|wealth\s*managem/.test(s)) return 'Tech / Software & Office Occupiers';
  // Industrial / Manufacturing — incl. TIC (testing/inspection/certification) services for industry
  if (/industrial|manufactur|factory|\bplant\b|chemical|material|\benergy\b|utilit|mining|metal|petroleum|\boil\b|\bgas\b|steel|cement|paper|pulp|automotive|aerospace|\btic\b|testing.*inspect|inspection.*certif|testing\s*&?\s*inspect/.test(s)) return 'Industrial / Manufacturing';
  return null;
}

export function sectorScoreFor(sector) {
  return sector && SECTOR_SCORES[sector] != null ? SECTOR_SCORES[sector] : 0;
}

export function sectorTier(sector) {
  return tierForScoreValue(sectorScoreFor(sector));
}

export function tierForScoreValue(score) {
  if (score >= 8) return 'High';
  if (score >= 5) return 'Medium';
  if (score > 0) return 'Low';
  return null;
}

// Backward-compatible wrapper — callers that just want the High/Medium/Low
// color bucket continue to work. The rank score now uses the raw sector
// score (see computePortfolioFitScore) rather than a coarse tier value.
export function industryTier(industry) {
  return sectorTier(industrySector(industry));
}

export function computePortfolioFitScore(row, maxEnergy, maxSites, yearRange) {
  // If the uploaded file carries an Opportunity Score column, use that
  // value verbatim — never fall back to the composite methodology.
  // Extract the first numeric token so values like "85%", "85/100", or
  // "85 (est.)" parse cleanly. When the cell has an explicit non-
  // numeric value like "N/A" (common for credit strategies where a
  // score doesn't apply) return null so callers can render it as
  // "N/A" rather than a fabricated 0 or a composite score.
  if (row.opportunityScore != null && String(row.opportunityScore).trim() !== '') {
    const cleaned = String(row.opportunityScore).replace(/,/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (match) return Math.round(Number(match[0]));
    return null;
  }
  // Sector fit precedence:
  //   1. Subsector Score — only used when BOTH a Subsector label and a
  //      numeric Subsector Score are present.
  //   2. Sector Score — used when subsector is unmapped or unscored.
  //   3. Keyword-derived sector lookup from the Industry text.
  // All scores are 1-10; normalize to 0-1.
  const explicitSubsectorScore = Number(row.subsectorScore);
  const explicitSectorScore = Number(row.sectorScore);
  const subsectorMapped = !!(row.subsector && String(row.subsector).trim());
  const subsectorUsable = subsectorMapped && explicitSubsectorScore > 0;
  let sectorScoreRaw;
  if (subsectorUsable) sectorScoreRaw = explicitSubsectorScore;
  else if (explicitSectorScore > 0) sectorScoreRaw = explicitSectorScore;
  else sectorScoreRaw = sectorScoreFor(industrySector(row.sector || row.industry));
  const sectorVal = Math.min(1, sectorScoreRaw / 10);
  const energyPct = maxEnergy > 0 ? Math.min(1, (Number(row.energyGwh) || 0) / maxEnergy) : 0;
  const sitesPct = maxSites > 0 ? Math.min(1, (Number(row.siteCount) || 0) / maxSites) : 0;
  // Recency of acquisition: most recent year in the table -> 1.0, oldest -> 0.0
  let yearPct = 0;
  const year = Number(row.acquisitionYear);
  if (year && yearRange && yearRange.max > yearRange.min) {
    yearPct = (year - yearRange.min) / (yearRange.max - yearRange.min);
  } else if (year && yearRange && yearRange.max === yearRange.min) {
    yearPct = 1;
  }
  const raw = energyPct * 0.4 + sectorVal * 0.25 + sitesPct * 0.2 + yearPct * 0.15;
  return Math.round(raw * 100);
}


// Build and download the multi-sheet Portfolio Companies workbook for one
// company. Callers that have richer app-level context (the company pop-up)
// pass the optional helpers so the derived columns (Client Manager fallback,
// Tier, Other CDM, External Reporting) fill in; callers without that data
// (the PE Portfolio view) let them default to empty without changing the
// file's structure or branding.
export async function downloadPortfolioCompaniesWorkbook({
  company,
  rows = [],
  topFive = null,
  overview = null,
  listFlags = new Map(),
  cmForRaClient = () => "",
  tierForTarget = () => "",
  repForTarget = () => "",
  // Resolves the Status cell for a row. The company pop-up passes a resolver
  // that falls back to the matching tracker record's status, exactly as the
  // on-screen column does; callers without that context get the row's own
  // status only.
  statusForRow = (row) => row.status || "",
}) {
                  if (rows.length === 0) {
                    alert('No portfolio companies to download.');
                    return;
                  }
                  const maxE = rows.reduce((m, r) => Math.max(m, Number(r.energyGwh) || 0), 0);
                  const maxS = rows.reduce((m, r) => Math.max(m, Number(r.siteCount) || 0), 0);
                  const years = rows.map(r => Number(r.acquisitionYear)).filter(y => y > 0);
                  const yearRange = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;
                  const headers = ['Opportunity Score', 'Company Name', 'Status', 'HQ Country', 'Est. Energy (GWh/yr)', 'Est. Electricity', 'Est. Natural Gas', 'Site Count', 'Sector', 'Subsector', 'Strategy', 'Acquisition Year', 'PC Description', 'Notes', 'RA Client Match', 'Client Manager', 'Target Account', 'Tier', 'Other CDM', 'External Reporting'];
                  const colWidths = [13, 32, 18, 15, 15, 16, 16, 15, 28, 22, 18, 14, 48, 36, 26, 22, 26, 10, 22, 22];
                  // Parse a site-count cell that may carry a (P)/(E) marker — e.g. "12 (E)" → { num: 12, isEstimate: true }.
                  // The number is what we write; the marker drives italic formatting in the export.
                  function parseSiteCount(raw) {
                    const s = String(raw ?? '').trim();
                    if (!s) return { value: null, isEstimate: false };
                    const isEstimate = /\(\s*e\s*\)/i.test(s);
                    const cleaned = s.replace(/\(\s*[pe]\s*\)/gi, '').trim();
                    const n = Number(cleaned);
                    return { value: Number.isFinite(n) && cleaned !== '' ? n : (cleaned || null), isEstimate };
                  }
                  // Export ordered by Opportunity Score (highest first); ties keep original order.
                  // Rows whose score came back null (explicit N/A) sink to the bottom.
                  const orderedRows = rows
                    .map((r, idx) => ({ r, idx, score: computePortfolioFitScore(r, maxE, maxS, yearRange) }))
                    .sort((a, b) => {
                      const av = a.score == null ? -Infinity : a.score;
                      const bv = b.score == null ? -Infinity : b.score;
                      return bv - av || a.idx - b.idx;
                    });
                  const siteEstimateFlags = orderedRows.map(({ r }) => parseSiteCount(r.siteCount).isEstimate);
                  // Acquisition year recency: 0 = oldest (hurts score), 1 = newest (helps).
                  // null when the row has no year.
                  const yearRecencyPcts = orderedRows.map(({ r }) => {
                    const y = Number(r.acquisitionYear);
                    if (!y || !yearRange) return null;
                    if (yearRange.max === yearRange.min) return 1;
                    return (y - yearRange.min) / (yearRange.max - yearRange.min);
                  });
                  const data = orderedRows.map(({ r, score }) => {
                    const energy = r.energyGwh === '' || r.energyGwh == null ? null : (Number(r.energyGwh) || r.energyGwh);
                    const estElec = r.estElectricity === '' || r.estElectricity == null ? null : (Number(r.estElectricity) || r.estElectricity);
                    const estGas = r.estNaturalGas === '' || r.estNaturalGas == null ? null : (Number(r.estNaturalGas) || r.estNaturalGas);
                    const sites = parseSiteCount(r.siteCount).value;
                    const acqYearNum = Number(r.acquisitionYear);
                    const acqYear = acqYearNum > 0 ? acqYearNum : (r.acquisitionYear || '');
                    const clientMgr = (r.clientManager || '').trim() || cmForRaClient(r.raClientMatch);
                    return [
                      score == null ? 'N/A' : score,
                      r.companyName || '',
                      statusForRow(r) || '',
                      r.hqCountry || '',
                      energy,
                      estElec,
                      estGas,
                      sites,
                      r.sector || r.industry || '',
                      r.subsector || '',
                      r.strategy || '',
                      acqYear,
                      r.pcDescription || '',
                      // Always a single space — keeps the Notes column cells
                      // non-empty so a long PC Description in the preceding
                      // column can't visually spill into the Notes column in
                      // Excel.
                      ' ',
                      r.raClientMatch || '',
                      clientMgr,
                      r.targetAccount || '',
                      tierForTarget(r.targetAccount),
                      repForTarget(r.targetAccount),
                      (() => {
                        const set = listFlags.get((r.companyName || '').toLowerCase().trim());
                        return set ? [...set].join(', ') : '';
                      })(),
                    ];
                  });

                  // Schneider Electric brand palette
                  const SE_GREEN = 'FF3DCD58';       // Life is On green (title band)
                  const SE_GREEN_DARK = 'FF009530';  // Header band
                  const SE_TEXT_DARK = 'FF1E293B';
                  const SE_ZEBRA = 'FFF6F9F4';
                  const SE_BORDER = 'FFD4DDE1';
                  const TIER_FILL = { High: 'FFDCFCE7', Medium: 'FFFEF9C3', Low: 'FFF1F5F9' };
                  const TIER_FG = { High: 'FF166534', Medium: 'FF854D0E', Low: 'FF475569' };

                  try {
                    const { Workbook } = await import('exceljs');
                    const wb = new Workbook();
                    wb.creator = 'Schneider Electric · Prospect Tracker';
                    wb.created = new Date();
                    const ws = wb.addWorksheet('Portfolio Companies', {
                      properties: { tabColor: { argb: SE_GREEN } },
                      views: [{ state: 'frozen', ySplit: 3 }],
                    });
                    ws.columns = colWidths.map(w => ({ width: w }));

                    // Row 1: Title band
                    const titleRow = 1;
                    const subRow = 2;
                    const headerRowIdx = 3;
                    ws.mergeCells(titleRow, 1, titleRow, headers.length);
                    const titleCell = ws.getCell(titleRow, 1);
                    titleCell.value = 'Schneider Electric';
                    titleCell.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
                    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
                    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                    ws.getRow(titleRow).height = 30;

                    // Row 2: Subtitle — "{Company} · Portfolio Companies"
                    ws.mergeCells(subRow, 1, subRow, headers.length);
                    const subCell = ws.getCell(subRow, 1);
                    subCell.value = company || 'Company';
                    subCell.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
                    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                    ws.getRow(subRow).height = 20;

                    // Row 3: Column headers
                    const headerRow = ws.getRow(headerRowIdx);
                    headers.forEach((h, i) => {
                      const cell = headerRow.getCell(i + 1);
                      cell.value = h;
                      cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
                      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
                      cell.border = {
                        top: { style: 'thin', color: { argb: SE_BORDER } },
                        bottom: { style: 'thin', color: { argb: SE_BORDER } },
                        left: { style: 'thin', color: { argb: SE_BORDER } },
                        right: { style: 'thin', color: { argb: SE_BORDER } },
                      };
                    });
                    headerRow.height = 30;

                    // Data rows. Any row whose Company Name appears on the
                    // Top 5 Deep Dives tab gets a medium SE-green frame so
                    // the reader sees at a glance which firms were selected
                    // for deep dives. Rows aren't guaranteed contiguous, so
                    // each match carries its own full 4-sided frame.
                    const frameBorder = { style: 'medium', color: { argb: SE_GREEN_DARK } };
                    const thinBorder = { style: 'thin', color: { argb: SE_BORDER } };
                    // Accept either the wrapped-row shape ({ cells: [...] }) or
                    // a bare 2-D array for legacy data.
                    const rowCells = (r) => Array.isArray(r) ? r : (r?.cells || []);
                    const deepDiveNames = (() => {
                      const t5 = topFive;
                      if (!t5 || !Array.isArray(t5.rows) || !Array.isArray(t5.headers)) return new Set();
                      const nameColIdx = t5.headers.findIndex(h => {
                        const s = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        return s.includes('company') || s === 'name' || s.includes('portfolio');
                      });
                      const col = nameColIdx >= 0 ? nameColIdx : 1;
                      const set = new Set();
                      for (const r of t5.rows) {
                        const v = String(rowCells(r)[col] ?? '').trim().toLowerCase();
                        if (v) set.add(v);
                      }
                      return set;
                    })();
                    data.forEach((vals, idx) => {
                      const row = ws.getRow(headerRowIdx + 1 + idx);
                      const companyKey = String(vals[1] ?? '').trim().toLowerCase();
                      const isFrameRow = companyKey && deepDiveNames.has(companyKey);
                      vals.forEach((v, i) => {
                        const cell = row.getCell(i + 1);
                        cell.value = v === '' || v == null ? null : v;
                        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                        const isFirstCol = i === 0;
                        const isLastCol = i === headers.length - 1;
                        // Each framed row is its own standalone rectangle —
                        // top + bottom are medium on every cell, left/right
                        // medium only at the row's outer columns.
                        if (isFrameRow) {
                          cell.border = {
                            top: frameBorder,
                            bottom: frameBorder,
                            left: isFirstCol ? frameBorder : thinBorder,
                            right: isLastCol ? frameBorder : thinBorder,
                          };
                        } else {
                          cell.border = {
                            bottom: thinBorder,
                            left: thinBorder,
                            right: thinBorder,
                          };
                        }
                        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left', wrapText: false };
                        // Light SE-green wash on deep-dive rows; the year-column
                        // override below can still replace it with its recency tint.
                        if (isFrameRow) {
                          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        }
                        // Number formats. Column order here is:
                        //   0 Opportunity Score · 1 Company Name · 2 Status ·
                        //   3 HQ Country · 4 Energy · 5 Est. Electricity ·
                        //   6 Est. Natural Gas · 7 Site Count · 8 Sector ·
                        //   9 Subsector · 10 Strategy · 11 Acquisition Year · ...
                        if (i === 0 || i === 11) cell.numFmt = '0';
                        if (i >= 4 && i <= 7) cell.numFmt = '#,##0';
                        // Status (col 2): same color coding as the on-screen column.
                        if (i === 2 && v) {
                          const statusColors = statusCellColors(String(v));
                          if (statusColors) {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors.fill } };
                            cell.font = { ...cell.font, bold: true, color: { argb: statusColors.font } };
                          }
                        }
                        // Acquisition Year (col 11): color-code by recency so older years
                        // visibly show they're pulling the opportunity score down.
                        if (i === 11 && v != null) {
                          const yPct = yearRecencyPcts[idx];
                          if (yPct != null) {
                            if (yPct >= 0.7) {
                              // Recent — helping the score
                              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                              cell.font = { ...cell.font, color: { argb: 'FF166534' }, bold: true };
                            } else if (yPct >= 0.3) {
                              // Mid-range — moderate drag
                              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
                              cell.font = { ...cell.font, color: { argb: 'FF854D0E' } };
                            } else {
                              // Old — hurting the score
                              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                              cell.font = { ...cell.font, color: { argb: 'FF991B1B' }, bold: true };
                            }
                          }
                        }
                        // Estimated site counts (originally tagged with "(E)" in the source):
                        // italic font + a custom number format that appends " est." while keeping
                        // the cell numeric and sortable.
                        if (i === 7 && siteEstimateFlags[idx]) {
                          cell.font = { ...cell.font, italic: true };
                          cell.numFmt = '#,##0" est."';
                        }
                      });
                      row.height = 18;
                    });

                    // Auto-filter on the header row so users can sort/filter immediately
                    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: headers.length } };

                    // Re-apply column widths AFTER all cells are written. ExcelJS
                    // sometimes recalculates a column's width when cells are added
                    // via getCell(), so an authoritative second pass guarantees the
                    // widths the user configured (e.g. Opportunity Score = 12) are
                    // what's actually saved in the workbook.
                    colWidths.forEach((w, idx) => {
                      ws.getColumn(idx + 1).width = w;
                    });

                    // ── Aux tabs carried over from the uploaded workbook ──
                    // "Top 5 Overview" is a quick high-level roll-up (tab 2);
                    // "Top 5 Deep Dives" is the long-form research (tab 3).
                    // Both share the Portfolio tab's branding.
                    const FIT_COLORS = {
                      strong: { bg: 'FFDCFCE7', fg: 'FF166534' },
                      some:   { bg: 'FFFEF9C3', fg: 'FF854D0E' },
                      weak:   { bg: 'FFFEE2E2', fg: 'FF991B1B' },
                    };
                    function renderAuxSheet(tabName, subtitleSuffix, rawSource, opts = {}) {
                      if (!rawSource || !Array.isArray(rawSource.headers) || rawSource.headers.length === 0) return;
                      // Optionally drop columns by header match.
                      const shouldDrop = (h) => {
                        const header = String(h || '');
                        // Match any column whose header contains "notes" — some
                        // source files name the column "Top 5 Overview — Notes"
                        // or "Overview Notes" rather than a bare "Notes".
                        if (opts.dropNotesColumn && /\bnotes?\b/i.test(header)) return true;
                        if (opts.dropOpportunityScore && /opportunity\s*score|^\s*opp\s*score\s*$/i.test(header)) return true;
                        return false;
                      };
                      const keepIdx = rawSource.headers
                        .map((h, i) => ({ h, i }))
                        .filter(({ h }) => !shouldDrop(h));
                      if (keepIdx.length === 0) return;
                      // Header rewrites — rename "Infra Risk" (or
                      // "Infrastructure Risk") to "Climate Risk" so
                      // the aux sheets land on the canonical naming
                      // we use everywhere else in the app. Case- and
                      // punctuation-insensitive, leaves every other
                      // header untouched.
                      const renameHeader = (h) => {
                        const norm = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (norm === 'infrarisk' || norm === 'infrastructurerisk') return 'Climate Risk';
                        return h;
                      };
                      const headers = keepIdx.map(({ h }) => renameHeader(h));
                      // Optionally slice off a trailing free-text "Notes" block —
                      // a blank row, a row whose leading text is "Notes", or a
                      // bullet row all count as the boundary.
                      const rawRows = rawSource.rows || [];
                      const effectiveRows = (() => {
                        if (!opts.trimTrailingNotes) return rawRows;
                        const isBoundary = (r) => {
                          const cells = Array.isArray(r) ? r : (r?.cells || []);
                          const nonEmpty = cells.map(c => String(c ?? '').trim()).filter(s => s !== '');
                          if (nonEmpty.length === 0) return true;
                          const first = nonEmpty[0];
                          if (/^notes?\s*:?\s*$/i.test(first)) return true;
                          if (/^[•·\-*▪●◦]/.test(first)) return true;
                          return false;
                        };
                        const boundary = rawRows.findIndex(isBoundary);
                        return boundary >= 0 ? rawRows.slice(0, boundary) : rawRows;
                      })();
                      const rows = effectiveRows.map(r => {
                        const cells = Array.isArray(r) ? r : (r?.cells || []);
                        return keepIdx.map(({ i }) => cells[i] ?? '');
                      });

                      const ws2 = wb.addWorksheet(tabName, {
                        properties: { tabColor: { argb: SE_GREEN } },
                        views: [{ state: 'frozen', ySplit: 3 }],
                      });
                      const colCount = headers.length;
                      // Columns whose header reads like prose get a wider column
                      // and wrap; everything else stays compact.
                      const isWrapCol = (h) => /narrative|description|thesis|summary/i.test(String(h || ''));
                      const hasWrapCol = headers.some(isWrapCol);
                      const widths = headers.map((h, i) => {
                        if (isWrapCol(h)) return 80;
                        if (i === 0) return 7;
                        return 22;
                      });
                      ws2.columns = widths.map(w => ({ width: w }));

                      // Row 1: Title band
                      ws2.mergeCells(1, 1, 1, colCount);
                      const title = ws2.getCell(1, 1);
                      title.value = 'Schneider Electric';
                      title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
                      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
                      title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      ws2.getRow(1).height = 30;

                      // Row 2: Subtitle
                      ws2.mergeCells(2, 1, 2, colCount);
                      const sub = ws2.getCell(2, 1);
                      sub.value = `${company || 'Company'}  ·  ${subtitleSuffix}`;
                      sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
                      sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      ws2.getRow(2).height = 20;

                      // Row 3: Column headers
                      const headerRow2 = ws2.getRow(3);
                      headers.forEach((h, i) => {
                        const cell = headerRow2.getCell(i + 1);
                        cell.value = h;
                        cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
                        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
                        cell.border = {
                          top: { style: 'thin', color: { argb: SE_BORDER } },
                          bottom: { style: 'thin', color: { argb: SE_BORDER } },
                          left: { style: 'thin', color: { argb: SE_BORDER } },
                          right: { style: 'thin', color: { argb: SE_BORDER } },
                        };
                      });
                      headerRow2.height = 30;

                      // Data rows
                      rows.forEach((rowVals, idx) => {
                        const row = ws2.getRow(4 + idx);
                        for (let i = 0; i < colCount; i++) {
                          const raw = rowVals[i];
                          const cell = row.getCell(i + 1);
                          cell.value = raw === '' || raw == null ? null : raw;
                          cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                          cell.border = {
                            bottom: { style: 'thin', color: { argb: SE_BORDER } },
                            left: { style: 'thin', color: { argb: SE_BORDER } },
                            right: { style: 'thin', color: { argb: SE_BORDER } },
                          };
                          cell.alignment = { vertical: 'top', horizontal: i === 0 ? 'center' : 'left', wrapText: opts.wrapAllText || isWrapCol(headers[i]) };
                          // Strong / Some / Weak → green / yellow / red.
                          // Match on the leading word so enriched cells like
                          // "Strong - 35 sites" or "Some - 42 GWh/yr" still
                          // pick up the right tint.
                          if (opts.colorFitCells) {
                            const leading = String(raw ?? '').trim().toLowerCase().match(/^(strong|some|weak)\b/);
                            const fit = leading ? FIT_COLORS[leading[1]] : null;
                            if (fit) {
                              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fit.bg } };
                              cell.font = { ...cell.font, color: { argb: fit.fg }, bold: true };
                            }
                          }
                        }
                        row.height = hasWrapCol ? 120 : 22;
                      });

                      ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
                      widths.forEach((w, i) => { ws2.getColumn(i + 1).width = w; });
                    }
                    renderAuxSheet('Top 5 Overview', 'Top 5 Overview', overview, { dropNotesColumn: true, dropOpportunityScore: true, colorFitCells: true, trimTrailingNotes: true });
                    renderAuxSheet('Top 5 Deep Dives', 'Top 5 Deep Dives', topFive, { wrapAllText: true });

                    // ── Methodology & Assumptions tab (hidden by default) ──
                    // The sheet is still included so it can be unhidden in Excel when a
                    // reader wants to see how the Opportunity Score was derived.
                    const mws = wb.addWorksheet('Methodology', {
                      properties: { tabColor: { argb: SE_GREEN } },
                      views: [{ state: 'frozen', ySplit: 2 }],
                      state: 'hidden',
                    });
                    mws.columns = [{ width: 28 }, { width: 90 }];

                    // Row 1: Title band
                    mws.mergeCells(1, 1, 1, 2);
                    const mTitle = mws.getCell(1, 1);
                    mTitle.value = 'Schneider Electric';
                    mTitle.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
                    mTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
                    mTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                    mws.getRow(1).height = 30;

                    // Row 2: Subtitle
                    mws.mergeCells(2, 1, 2, 2);
                    const mSub = mws.getCell(2, 1);
                    mSub.value = `${company || 'Company'}  ·  Ranking Methodology & Assumptions`;
                    mSub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
                    mSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                    mws.getRow(2).height = 20;

                    let mRow = 4;
                    function addSectionHeader(text) {
                      mws.mergeCells(mRow, 1, mRow, 2);
                      const c = mws.getCell(mRow, 1);
                      c.value = text;
                      c.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
                      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
                      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                      mws.getRow(mRow).height = 22;
                      mRow++;
                    }
                    function addKV(label, value) {
                      const a = mws.getCell(mRow, 1);
                      const b = mws.getCell(mRow, 2);
                      a.value = label;
                      b.value = value;
                      a.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_TEXT_DARK } };
                      b.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                      a.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
                      b.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
                      mRow++;
                    }
                    function addParagraph(text) {
                      mws.mergeCells(mRow, 1, mRow, 2);
                      const c = mws.getCell(mRow, 1);
                      c.value = text;
                      c.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
                      c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
                      mws.getRow(mRow).height = Math.max(18, Math.ceil(text.length / 90) * 16);
                      mRow++;
                    }
                    function addBlank() { mRow++; }

                    addSectionHeader('Overview');
                    addParagraph('The Opportunity Score is a 0–100 composite value computed for each portfolio company. Higher values indicate a better fit for Schneider Electric engagement based on industry alignment, operational scale, and acquisition recency. The score is computed relative to the other companies in this table: energy, site count, and acquisition year are normalized against the rows exported here.');
                    addBlank();

                    addSectionHeader('Component Weights');
                    addKV('Est. Energy (GWh/yr)', '40%: linearly normalized against the maximum value in the exported table. Largest single driver of the score.');
                    addKV('Sector Fit Score', '25%: uses the per-row Subsector Score (1-10) only when both a Subsector label AND its score are present. If the subsector is missing or unscored, falls back to the per-row Sector Score; if that is also missing, falls back to the keyword-derived sector lookup (table below). Divided by 10.');
                    addKV('Site Count', '20%: linearly normalized against the maximum value in the exported table.');
                    addKV('Acquisition Year', '15%: most recent acquisition year scores 1.0, oldest scores 0.0, others linearly between.');
                    addBlank();

                    addSectionHeader('Sector Fit Scores');
                    addParagraph('The Industry column is fuzzy-matched to one of the sectors below. The sector score (1-10) is divided by 10 and contributes 25% to the composite. Unmatched industries contribute 0. Fit Tier in the data tab reflects the same mapping: High for 8.0+, Medium for 5.0-7.9, Low for under 5.0.');
                    addKV('Industrial / Manufacturing', '9.5: industrial, manufacturing, factory, plant, chemical, materials, energy, utilities, mining, metal, petroleum/oil & gas, steel, cement, paper/pulp, automotive, aerospace');
                    addKV('Data Centers', '9.3: data center, colocation');
                    addKV('Cold Storage / Food Mfg', '9.0: cold storage, food mfg/processing, beverage mfg');
                    addKV('Healthcare / Life Sciences', '8.6: healthcare, life sciences, pharma, biotech, medical, hospital, clinic');
                    addKV('Real Estate / Facilities', '8.4: real estate, facilities, property, REIT, infrastructure');
                    addKV('Hospitality / Food Service', '7.8: hotel, restaurant, food service, lodging, QSR, hospitality');
                    addKV('Retail / Consumer', '6.5: retail, consumer, grocery, apparel, e-commerce');
                    addKV('Warehousing / 3PL', '4.2: warehousing, 3PL, logistics, distribution, freight, transport, supply chain');
                    addKV('Tech / Software & Office Occupiers', '3.0: tech, software, SaaS, fintech, media, telecom, advertising, office, professional services, financial services, insurance, banking, asset management');
                    addBlank();

                    addSectionHeader('Normalization Formulas');
                    addKV('Energy %', 'min(1, row.Energy ÷ max(Energy in table))');
                    addKV('Sites %', 'min(1, row.Sites ÷ max(Sites in table))');
                    addKV('Year %', '(row.Year − min(Year)) ÷ (max(Year) − min(Year)). Missing year contributes 0.');
                    addKV('Sector %', 'SectorScore ÷ 10. Unmatched industries contribute 0.');
                    addBlank();

                    addSectionHeader('Composite Formula');
                    addParagraph('Opportunity Score = round( 100 × ( 0.40 × Energy% + 0.25 × Sector% + 0.20 × Sites% + 0.15 × Year% ) )');
                    addBlank();

                    addSectionHeader('Key Assumptions & Caveats');
                    addKV('Relative scoring', 'Scores are relative to the current table. Adding or removing rows changes the normalization max/min and can shift every row\'s score.');
                    addKV('Estimates', 'Energy (GWh/yr) and Site Count are best-effort estimates: Claude research output or manual input. They are not audited figures.');
                    addKV('Industry keywords', 'Matching is substring-based and may mis-classify broad terms. Review the Fit Tier column and correct the Industry text if needed.');
                    addKV('Missing values', 'Blank energy / sites / year cells contribute 0 to their component, never negative.');

                    sanitizeExcelWorkbook(wb);
                    const buf = await wb.xlsx.writeBuffer();
                    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    // Filename: "{Company Name}_Portfolio Company Analysis.xlsx".
                    // Strip only filesystem-illegal characters; keep spaces and the rest of the name as-is.
                    const safeName = (company || 'Company').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Company';
                    a.href = url;
                    a.download = `${safeName}_Portfolio Company Analysis.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  } catch (err) {
                    alert('Failed to build Excel: ' + (err?.message || err));
                  }
}
