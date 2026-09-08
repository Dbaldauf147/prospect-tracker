// What a company's stored site list adds up to.
//
// The list is a table of whatever columns the source had, so the popup
// can show it but can't say anything ABOUT it without reading the
// columns back out. These are the facts a portfolio gets read by — how
// much building there is, which operating companies own it, what kind of
// buildings they are, and how much equipment is in them — summarised for
// the header line above the table.
//
// Headers are matched tolerantly because a list is built from several
// sources: the Utility Lookup save writes "Size (ft²)", the paste modal
// maps onto the same name, and an uploaded spreadsheet keeps whatever it
// came with ("SQFT", "Building Area", "GSF").
//
// Pure: one stored list in, plain numbers and counts out.

import { propertyTypeEquipment } from '../data/propertyTypeEstimates.js';

function findHeader(headers, patterns) {
  for (const pattern of patterns) {
    const hit = headers.find(h => pattern.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

// A size cell as a number of square feet. Source sheets write "125,000",
// "125000 sf", "1.2e5" — anything with no digits in it is not a size.
export function toSqft(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw || !/\d/.test(raw)) return null;
  const n = Number(raw.replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// An equipment cell as a count. Unlike a size, zero is a real answer here
// — Land and Debt carry no building and so no equipment — so only a cell
// with no digits in it is "no answer".
function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const raw = String(value ?? '').trim();
  if (!raw || !/\d/.test(raw)) return null;
  const n = Number(raw.replace(/[^0-9.\-eE]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Sq ft, divisions, property types and equipment across a stored site list.
 *
 *   { sites, sqft, sqftSites, equipment, equipmentSites, divisions, propertyTypes }
 *
 * `sqft` is null rather than 0 when no row carried a usable size —
 * "nobody has told us the sizes" and "these buildings have no floor
 * area" are different statements, and only one of them is possible.
 * `sqftSites` says how many rows the total is actually built from, so a
 * portfolio that sized 3 of its 158 buildings can't read as complete.
 * `equipment` follows the same rule, and is the per-site count the
 * analysis wrote where there is one, else the site's property-type
 * estimate — so a list that never went through the Utility Lookup page
 * still totals.
 */
export function siteListFacts(entry) {
  const headers = (entry?.headers || []).filter(h => typeof h === 'string');
  const rows = (entry?.rows || []).filter(r => r && typeof r === 'object');
  if (!rows.length) {
    return { sites: 0, sqft: null, sqftSites: 0, equipment: null, equipmentSites: 0, divisions: [], propertyTypes: [] };
  }

  const sizeCol = findHeader(headers, [
    /^size\s*\(ft/i, /^size\s*\(sq/i, /^size$/i, /sq\s*\.?\s*ft/i, /square\s*(feet|foot|footage)/i,
    /\bft\s*²\b/i, /\bft2\b/i, /\b[rg]sf\b/i, /\bsf\b/i, /building\s*(size|area)/i, /gross\s*area/i, /floor\s*area/i,
  ]);
  // "Property Type (analysis)" is the canonical value the Utility Lookup
  // page resolved; the uploaded column keeps the user's own wording. The
  // canonical one is what groups cleanly, so it is preferred.
  const typeCol = findHeader(headers, [
    /^property\s*type\s*\(analysis\)$/i, /^property\s*type$/i, /property\s*type/i, /building\s*type/i, /asset\s*type/i,
  ]);
  const divisionCol = findHeader(headers, [
    /^division$/i, /\bdivision\b/i, /^business\s*unit$/i, /business\s*unit/i, /^subsidiary$/i, /operating\s*(company|unit)/i,
  ]);
  // The per-site equipment count the Utility Lookup save writes. Matched on
  // a prefix because a colliding uploaded column pushes the analysis one to
  // "Est. Equipment (analysis)".
  const equipmentCol = findHeader(headers, [
    /^est\.?\s*equipment/i, /^equipment\s*count/i, /^equipment$/i,
  ]);

  let sqft = 0;
  let sqftSites = 0;
  let equipment = 0;
  let equipmentSites = 0;
  const divisions = new Map();
  const propertyTypes = new Map();
  const add = (map, value) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (!map.has(key)) map.set(key, v);
  };

  for (const row of rows) {
    if (sizeCol) {
      const n = toSqft(row[sizeCol]);
      if (n != null) { sqft += n; sqftSites += 1; }
    }
    if (divisionCol) add(divisions, row[divisionCol]);
    if (typeCol) add(propertyTypes, row[typeCol]);
    // A count the analysis already wrote for this site wins; otherwise the
    // site's property type is looked up here, so a list assembled from an
    // upload that never went through the Utility Lookup page still totals.
    const stated = equipmentCol ? toCount(row[equipmentCol]) : null;
    const n = stated != null ? stated : (typeCol ? propertyTypeEquipment(row[typeCol]) : null);
    if (n != null) { equipment += n; equipmentSites += 1; }
  }

  return {
    sites: rows.length,
    sqft: sqftSites > 0 ? Math.round(sqft) : null,
    sqftSites,
    // Null, not 0, when nothing could be counted — same reasoning as sqft.
    equipment: equipmentSites > 0 ? Math.round(equipment) : null,
    equipmentSites,
    divisions: [...divisions.values()].sort((a, b) => a.localeCompare(b)),
    propertyTypes: [...propertyTypes.values()].sort((a, b) => a.localeCompare(b)),
  };
}

/** "4.2M ft²" / "860K ft²" / "12,400 ft²" — a floor area at a glance. */
export function formatSqft(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M ft²`;
  if (value >= 100_000) return `${Math.round(value / 1000)}K ft²`;
  return `${Math.round(value).toLocaleString()} ft²`;
}
