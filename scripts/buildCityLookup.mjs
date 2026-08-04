// Prep script: turn the Building Compliance Screening workbook's real
// "City Lookup" tab into the committed seed the app bundles:
//
//   src/data/complianceCityLookup.js — every city / spelling variant the
//     reference covers → Government ID, plus the per-jurisdiction reference
//     columns so the in-app "City Lookup" download reproduces the tab.
//
// This replaces the placeholder lookup that buildComplianceOrdinances.mjs used
// to derive from the Master Ordinances tab (one key per jurisdiction city).
// The real tab is what makes member cities work: Silver Spring resolves to
// Montgomery County, West Hollywood to Los Angeles, Sacramento to the
// California state program.
//
// Regenerate:  node scripts/buildCityLookup.mjs <path-to-CityLookup.xlsx|.csv>
// The raw workbook is not committed; only the processed seed is, so the app
// runs offline.
//
// Rows with no Government ID are dropped: they name a city the reference has
// no benchmarking / performance ordinance for, which screens identically to a
// city the reference has never heard of. Keeping all ~46k of them would more
// than triple the bundled table for no change in any screening result.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import MASTER_ORDINANCES from '../src/data/masterOrdinances.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = process.argv[2];
if (!IN) { console.error('Usage: node scripts/buildCityLookup.mjs <CityLookup.xlsx>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'src', 'data', 'complianceCityLookup.js');

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Excel serial → ISO date. The deadline columns arrive as serials.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function isoDate(v) {
  const s = clean(v);
  if (!s) return '';
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 60000) return new Date(EXCEL_EPOCH + Math.round(n) * 86400000).toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    let [, mo, d, y] = m;
    y = Number(y); if (y < 100) y += 2000;
    return new Date(Date.UTC(y, Number(mo) - 1, Number(d))).toISOString().slice(0, 10);
  }
  return s;
}

// A jurisdiction label naming a whole state / province rather than a city:
// "California State", "Ontario Province", "New York State (Multifamily)",
// plain "Minnesota".
function isStatewideLabel(label, stateName) {
  const bare = clean(label).replace(/\([^)]*\)/g, '').replace(/\b(state|province)\b/gi, '');
  return normKey(bare) === normKey(stateName);
}

// --- Master Ordinances cross-reference -------------------------------------
const ordById = new Map(MASTER_ORDINANCES.map(g => [g.govId, g]));
// (government, state) → Government IDs, for repairing a row that points at a
// same-named jurisdiction in the wrong state.
const ordByName = new Map();
for (const g of MASTER_ORDINANCES) {
  const k = normKey(g.government) + '|' + normKey(g.state);
  if (!ordByName.has(k)) ordByName.set(k, g.govId);
}

function readRows(file) {
  // XLSX.readFile isn't bound to fs in the ESM build; read the bytes ourselves.
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// Reference columns that describe the jurisdiction, not the city. Constant per
// Government ID in the source tab, so they are stored once per jurisdiction.
const JURIS_COLS = [
  ['masterCity', 'Master City'],
  ['becsDeadline', 'BECS - Compliance Deadline', isoDate],
  ['becsThreshold', 'BECS - Threshold'],
  ['becsPolicyName', 'BECS - Policy Name'],
  ['becsSource', 'BECS - Compliance Source'],
  ['efficiencyDeadline', 'Efficiency - Deadline', isoDate],
  ['efficiencyThreshold', 'Efficiency - Threshold'],
  ['notes', 'Notes'],
  ['ashraeLevel2Audit', 'ASHRAE Level 2 audit'],
  ['ashraeThreshold', 'ASHRAE - Threshold'],
  ['dataRequired', 'Data Required'],
];

// The most common value of a column across each Government ID's rows, so a
// stray typo in one row out of thousands loses. (One Minnesota row carries a
// date in the threshold column, one calls the program "Minnesota" rather than
// "Minnesota State".)
// `rows` are resolved rows: { govId, src } where src is the source record.
function majorityByGovId(rows, column, xf = clean) {
  const tally = new Map();
  for (const { govId, src } of rows) {
    if (!tally.has(govId)) tally.set(govId, new Map());
    const c = tally.get(govId);
    const v = xf(clean(src[column]));
    c.set(v, (c.get(v) || 0) + 1);
  }
  return new Map([...tally].map(([gid, c]) =>
    [gid, [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
}

function main() {
  const raw = readRows(IN);
  const report = { rows: raw.length, noCity: 0, noGov: 0, backfilled: 0, remapped: 0, droppedUnknownGov: 0, conflicts: 0 };

  // Pass 1: resolve each row to a Government ID.
  const resolved = [];
  for (const r of raw) {
    const city = clean(r['City']);
    const state = clean(r['State']);
    const abbr = clean(r['State Abbreviation']);
    const country = clean(r['Country']);
    const masterCity = clean(r['Master City']);
    let govId = clean(r['Government ID']);

    if (!city || !state) { report.noCity++; continue; }

    // Some rows name the jurisdiction they roll up to but leave the Government
    // ID blank (every Toronto and Montreal spelling in the tab). Recover the ID
    // from the Master City when it names a Master Ordinances jurisdiction in
    // the same state — otherwise the reference would silently drop two
    // jurisdictions with live benchmarking mandates.
    if (!govId && masterCity) {
      const bare = masterCity.split(',')[0];
      const hit = ordByName.get(normKey(bare) + '|' + normKey(state));
      if (hit) { govId = hit; report.backfilled++; }
    }
    if (!govId) { report.noGov++; continue; }

    if (!ordById.has(govId)) { report.droppedUnknownGov++; continue; }

    // A row whose Government ID belongs to a different state is a mis-keyed
    // reference entry — the tab points Portland, Maine at Portland, Oregon's
    // ordinance. Repair it against the same-named jurisdiction in the row's own
    // state; drop it when there is none, rather than screen a site against
    // another state's mandate. (The runtime guard in lookupGovId only vetoes
    // city-only guesses; an explicit city+state hit is trusted.)
    const ordState = ordById.get(govId).state;
    if (normKey(ordState) !== normKey(state)) {
      const fix = ordByName.get(normKey(ordById.get(govId).government) + '|' + normKey(state));
      if (fix) {
        console.log(`  remap: ${city}, ${state} — ${govId} (${ordState}) -> ${fix}`);
        govId = fix; report.remapped++;
      } else {
        console.log(`  drop:  ${city}, ${state} — ${govId} is in ${ordState}, no ${state} equivalent`);
        report.droppedUnknownGov++; continue;
      }
    }

    resolved.push({ city, state, abbr, country, masterCity, govId, src: r });
  }

  // Which Government IDs are whole-state / province programs rather than city
  // ordinances. This settles the cities the tab lists under both (Silver Spring
  // is Montgomery County's, not Maryland's) and the state-less city-only
  // fallback, so it has to be right — and each source of truth alone gets a
  // case wrong. The tab labels Newton, MA "Massachusetts State"; Master
  // Ordinances calls New York City's jurisdiction plainly "New York" in the
  // state of New York. A program counts as statewide only when both agree.
  const masterCityById = majorityByGovId(resolved, 'Master City');
  const statewideIds = new Set(
    MASTER_ORDINANCES
      .filter(g => isStatewideLabel(masterCityById.get(g.govId) || '', g.state)
                && isStatewideLabel(g.government, g.state))
      .map(g => g.govId));

  // Pass 2: one entry per (city, state). Where the tab carries both a city
  // ordinance and the statewide program for the same city — St. Paul and
  // Minnesota State, Silver Spring and Maryland State — the city ordinance
  // wins: it is the specific jurisdiction the building sits in.
  const byPair = new Map();
  for (const row of resolved) {
    const k = normKey(row.city) + '|' + normKey(row.state);
    const prev = byPair.get(k);
    if (!prev) { byPair.set(k, row); continue; }
    if (prev.govId === row.govId) continue;
    report.conflicts++;
    const prevWide = statewideIds.has(prev.govId);
    const rowWide = statewideIds.has(row.govId);
    if (prevWide && !rowWide) {
      console.log(`  conflict: ${row.city}, ${row.state} — ${prev.govId} (${prev.masterCity}) vs ${row.govId} (${row.masterCity}) -> ${row.govId}`);
      byPair.set(k, row);
    } else {
      console.log(`  conflict: ${row.city}, ${row.state} — ${prev.govId} (${prev.masterCity}) vs ${row.govId} (${row.masterCity}) -> ${prev.govId}`);
    }
  }
  const rows = [...byPair.values()].sort((a, b) =>
    a.state.localeCompare(b.state) || a.city.localeCompare(b.city));

  // --- intern the repeated columns ------------------------------------------
  // [state name, abbreviation, country] and the Government IDs, so the row
  // table carries two small integers instead of three repeated strings.
  const stateIdx = new Map();
  const states = [];
  for (const r of rows) {
    const k = normKey(r.state);
    if (!stateIdx.has(k)) { stateIdx.set(k, states.length); states.push([r.state, r.abbr, r.country]); }
  }
  const govIdx = new Map();
  const govIds = [];
  for (const r of rows) {
    if (!govIdx.has(r.govId)) { govIdx.set(r.govId, govIds.length); govIds.push(r.govId); }
  }

  // Per-jurisdiction reference columns, held once each.
  const byCol = new Map(JURIS_COLS.map(([key, col, xf]) => [key, majorityByGovId(resolved, col, xf)]));
  const jurisdictions = govIds.map((gid) => {
    const out = { govId: gid, government: ordById.get(gid).government, state: ordById.get(gid).state };
    for (const [key] of JURIS_COLS) out[key] = byCol.get(key).get(gid) ?? '';
    out.statewide = statewideIds.has(gid);
    return out;
  });
  console.log(`  statewide programs: ${jurisdictions.filter(j => j.statewide).map(j => j.govId).join(' · ')}`);

  const cityRows = rows.map(r => [r.city, stateIdx.get(normKey(r.state)), govIdx.get(r.govId)]);

  const banner = `// AUTO-GENERATED by scripts/buildCityLookup.mjs — do not edit by hand.
// The Building Compliance Screening workbook's "City Lookup" tab: every city
// and spelling variant the reference covers -> Government ID, which
// src/data/masterOrdinances.js then resolves to the jurisdiction's BBS /
// Energy-Audit / BPS mandates.
//
// Stored column-compressed — states and Government IDs are interned, and the
// per-jurisdiction reference columns are held once each — with the normalized
// key map built at import. The table is the source for both the screening
// lookup and the in-app "City Lookup" download.
`;

  const src = `${banner}
// [state / province name, abbreviation, country]
export const STATES = ${JSON.stringify(states)};

// Government IDs, indexed by CITY_ROWS[2].
export const GOV_IDS = ${JSON.stringify(govIds)};

// Reference detail per Government ID, in GOV_IDS order.
export const JURISDICTIONS = ${JSON.stringify(jurisdictions)};

// [city, index into STATES, index into GOV_IDS], one row per city + state.
export const CITY_ROWS = ${JSON.stringify(cityRows)};

const normKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// city+state (full name and abbreviation) -> Government ID, plus a city-only
// key for the state-less lookups.
//
// A bare city name is a guess, so it is only offered when the table leaves one
// sensible answer. Statewide programs make most names collide — there is a
// Calgary in Ontario and a Cambridge in five states — so a name carried by
// exactly one city ordinance resolves to that city even when statewide
// programs cover the same name elsewhere ("Columbus" is Columbus, Ohio). Two
// city ordinances of the same name, or only statewide programs in more than
// one state, leave no answer: Portland could be Maine or Oregon, so a
// state-less Portland says "no match" instead of picking one. lookupGovId
// still vetoes a city-only hit whose state contradicts the site's.
function buildLookup() {
  const out = {};
  const cityOnly = new Map(); // normalized city -> Set of candidate Government IDs
  for (const [city, si, gi] of CITY_ROWS) {
    const [name, abbr] = STATES[si];
    const govId = GOV_IDS[gi];
    out[normKey(city + name)] = govId;
    out[normKey(city + abbr)] = govId;
    const k = normKey(city);
    if (!cityOnly.has(k)) cityOnly.set(k, new Set());
    cityOnly.get(k).add(govId);
  }
  const statewide = new Set(JURISDICTIONS.filter(j => j.statewide).map(j => j.govId));
  for (const [k, ids] of cityOnly) {
    if (out[k] != null) continue;
    const cities = [...ids].filter(id => !statewide.has(id));
    const pick = cities.length === 1 ? cities[0] : (ids.size === 1 ? [...ids][0] : null);
    if (pick) out[k] = pick;
  }
  return out;
}

export const CITY_LOOKUP = buildLookup();
export default CITY_LOOKUP;
`;
  fs.writeFileSync(OUT, src);

  console.log(`Wrote ${cityRows.length} city rows / ${govIds.length} jurisdictions -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`  source rows ${report.rows} · no city/state ${report.noCity} · no Government ID ${report.noGov}`);
  console.log(`  backfilled from Master City ${report.backfilled} · cross-state remapped ${report.remapped} · dropped ${report.droppedUnknownGov} · city+state conflicts ${report.conflicts}`);

  // Jurisdictions in Master Ordinances that no city points at — worth seeing,
  // since a site in one of them can no longer match.
  const covered = new Set(govIds);
  const orphans = MASTER_ORDINANCES.filter(g => !covered.has(g.govId));
  if (orphans.length) {
    console.log(`  ${orphans.length} Master Ordinances jurisdictions have no city rows:`);
    for (const g of orphans) {
      const live = ['bbs', 'audits', 'bps'].filter(c => g[c].active);
      console.log(`    ${g.govId} — ${g.government}, ${g.state}${live.length ? ` (active: ${live.join(', ')})` : ''}`);
    }
  }
}

main();
