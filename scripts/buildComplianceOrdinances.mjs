// One-off prep script: turn the "Building Compliance Screening" workbook's
// Master Ordinances Database tab (exported to CSV) into the two committed
// seeds the app bundles:
//
//   src/data/masterOrdinances.js     — one record per Government ID, with the
//                                      raw row plus parsed BBS / Audits / BPS
//                                      summaries (status, deadline, thresholds,
//                                      max penalty, key details/links).
//   src/data/complianceCityLookup.js — city+state -> Government ID. Derived
//                                      here from each jurisdiction's Government
//                                      + State names; replace with the real
//                                      "City Lookup" tab (city -> Government ID)
//                                      when available to cover member cities of
//                                      county / state ordinances.
//
// Regenerate:  node scripts/buildComplianceOrdinances.mjs <path-to.csv>
// The raw CSV is not committed; only the processed seeds are, so the app runs
// offline.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = process.argv[2];
if (!IN) { console.error('Usage: node scripts/buildComplianceOrdinances.mjs <csv>'); process.exit(1); }
const OUT_ORD = path.join(__dirname, '..', 'src', 'data', 'masterOrdinances.js');
const OUT_CITY = path.join(__dirname, '..', 'src', 'data', 'complianceCityLookup.js');

// RFC 4180 parser (quoted fields with embedded commas + newlines).
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- value parsers ---------------------------------------------------------
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const NA_RE = /^(n\/?a|na|not\s*specified|not\s*available|not\s*applicable|tbd|pending|-)?$/i;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function parseDate(v) {
  const s = clean(v);
  if (!s || /not\s+(formally\s+)?adopted|not\s+specified|pending|no\b/i.test(s)) return null;
  // Excel serial date.
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 60000) return new Date(EXCEL_EPOCH + Math.round(n) * 86400000).toISOString().slice(0, 10);
  }
  // M/D/YYYY or M/D/YY.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let [, mo, d, y] = m;
    y = Number(y); if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, Number(mo) - 1, Number(d)));
    if (Number.isFinite(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

// Threshold in ft². "All buildings" -> 0 (any size qualifies); numbers -> value;
// anything non-numeric -> null (no usable threshold).
function parseThreshold(v) {
  const s = clean(v);
  if (!s || NA_RE.test(s)) return null;
  if (/all\s+buildings|any|every/i.test(s)) return 0;
  const digits = s.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

// First dollar amount in a (often messy) penalty string -> number.
function parseMoney(v) {
  const s = clean(v);
  if (!s || NA_RE.test(s)) return null;
  const m = s.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const isActive = (status) => /active/i.test(status) && !/rescind|cancel|repeal/i.test(status);

function main() {
  const buf = fs.readFileSync(IN);
  const text = new TextDecoder('windows-1252').decode(buf);
  const rows = parseCSV(text);
  const header = rows[0].map(clean);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const col = (row, name) => clean(row[idx[name]] ?? '');

  const governments = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const govId = col(row, 'Government ID');
    if (!govId) continue;
    const government = col(row, 'Government');
    const state = col(row, 'State');

    // Preserve the full raw row (all columns) for the downloadable source +
    // any detail the UI wants, keyed by header.
    const raw = {};
    header.forEach((h, i) => { const v = clean(row[i]); if (v) raw[h] = v; });

    const bbsStatus = col(row, 'BBS - Policy Status');
    const auditsStatus = col(row, 'Audits - Policy Status');
    const bpsStatus = col(row, 'BPS - Policy Status');

    governments.push({
      govId, government, state,
      bbs: {
        policyName: col(row, 'BBS - Policy Name'),
        status: bbsStatus,
        active: isActive(bbsStatus),
        deadline: parseDate(col(row, 'BBS - Compliance Deadline')),
        deadlineRaw: col(row, 'BBS - Compliance Deadline') || null,
        thresholds: {
          public: parseThreshold(col(row, 'BBS - Sq Ft Thr / Public')),
          nonResidential: parseThreshold(col(row, 'BBS - Sq Ft Thr / Non-residential')),
          multiFamily: parseThreshold(col(row, 'BBS - Sq Ft Thr / Multi-family')),
          statewide: parseThreshold(col(row, 'BBS - Sq Ft Thr / For  Statewide Applicability')),
        },
        maxPenalty: parseMoney(col(row, 'BBS - Maximun Yearly penalty')),
        dataRequired: col(row, 'BBS - Data Required') || null,
        submissionMethod: col(row, 'BBS - Submission Method') || null,
        link: col(row, 'BBS - City Link') || null,
        espmLink: col(row, 'BBS - ESPM Submission Link/ Connection Guide') || null,
        contact: col(row, 'BBS - Contact email(s)') || null,
      },
      audits: {
        ordinanceName: col(row, 'Audits - Ordinance Name'),
        status: auditsStatus,
        active: isActive(auditsStatus),
        deadline: parseDate(col(row, 'Audits - Due Date')),
        deadlineRaw: col(row, 'Audits - Due Date') || null,
        complianceCycle: col(row, 'Audits - Compliance Cycle') || null,
        thresholds: {
          public: parseThreshold(col(row, 'Audits - Sq Thr / Public')),
          commercial: parseThreshold(col(row, 'Audits - Sq Thr / Commercial')),
          multifamily: parseThreshold(col(row, 'Audits - Sq Thr / Multifamily')),
        },
        maxPenalty: parseMoney(col(row, 'Audits - Max Yearly Penalty')),
        energyAudit: col(row, 'Audits - Energy Audit Requirement') || null,
        waterAudit: col(row, 'Audits - Water Audit Requirement') || null,
        tuneUp: col(row, 'Audits - Tune-Up Requirement') || null,
        rcx: col(row, 'Audits - RCxing Requirement') || null,
        url: col(row, 'Audits - URL') || null,
      },
      bps: {
        policyName: col(row, 'BPS - Policy Name'),
        status: bpsStatus,
        active: isActive(bpsStatus),
        deadline: parseDate(col(row, 'BPS - Reporting Deadline')),
        deadlineRaw: col(row, 'BPS - Reporting Deadline') || null,
        complianceCycle: col(row, 'BPS - Compliance Cycle') || null,
        thresholds: {
          nonResidential: parseThreshold(col(row, 'BPS - Sq Ft Thr/ Non-Residential')),
          multiFamily: parseThreshold(col(row, 'BPS - Sq Ft Thr/ Multi-Family')),
        },
        maxPenalty: parseMoney(col(row, 'BPS - Enforcement Cost (No Reporting)')),
        penaltyUom: col(row, 'BPS - Enforcement UOM (No Reporting)') || null,
        metrics: col(row, 'BPS - Performance Metrics') || null,
        targets: col(row, 'BPS - Performance Targets/ Standards') || null,
        pathways: col(row, 'BPS - Compliance Pathways (Main)') || null,
        url: col(row, 'BPS - URL') || null,
      },
      raw,
    });
  }

  // Derived city lookup: normalized "city+state" (full state name and, when we
  // can infer it, the 2-letter code embedded in the Government ID) -> Government ID.
  const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cityLookup = {};
  const addKey = (k, govId) => { if (k && cityLookup[k] == null) cityLookup[k] = govId; };
  for (const g of governments) {
    // The Government ID embeds the 2-letter code, e.g. "US-MI-Ann Ar-01".
    const codeMatch = /^US-([A-Z]{2})-/.exec(g.govId);
    const stateCode = codeMatch ? codeMatch[1] : '';
    addKey(normKey(g.government + g.state), g.govId);
    if (stateCode) addKey(normKey(g.government + stateCode), g.govId);
    addKey(normKey(g.government), g.govId); // last-resort city-only
  }

  const banner = (src) => `// AUTO-GENERATED by scripts/buildComplianceOrdinances.mjs — do not edit by hand.\n// ${src}\n`;
  fs.writeFileSync(OUT_ORD,
    banner('Master Ordinances Database: one record per Government ID (BBS / Audits / BPS).')
    + `export default ${JSON.stringify(governments)};\n`);
  fs.writeFileSync(OUT_CITY,
    banner('Derived City Lookup: normalized city+state -> Government ID.')
    + `export default ${JSON.stringify(cityLookup)};\n`);

  console.log(`Wrote ${governments.length} governments -> ${path.relative(process.cwd(), OUT_ORD)}`);
  console.log(`Wrote ${Object.keys(cityLookup).length} city-lookup keys -> ${path.relative(process.cwd(), OUT_CITY)}`);
  const active = (k) => governments.filter(g => g[k].active).length;
  console.log(`  active: BBS ${active('bbs')} · Audits ${active('audits')} · BPS ${active('bps')}`);
}

main();
