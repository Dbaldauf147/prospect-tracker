// ISO / RTO assignment by ZIP code, via EPA's eGRID subregion crosswalk.
//
//   ZIP  --(egridZipSubregions seed)-->  eGRID subregion(s)  --(table below)-->  ISO / RTO
//
// The seed (src/data/egridZipSubregions.js, generated from EPA's MIT-licensed
// Power Profiler crosswalk) maps every US/PR ZIP to its predominant eGRID
// subregion first, then any other subregions the ZIP touches. This module
// turns that into a market label plus a confidence signal, entirely offline.
//
// Zip-level accuracy only — a ZIP can straddle markets, so the confidence
// field ("exact" | "seam" | "verify" | "unknown") flags when the answer
// should be treated with care.

import EGRID_ZIP_SUBREGIONS from '../data/egridZipSubregions.js';

// eGRID subregion code -> ISO / RTO market. Non-ISO areas map to a
// descriptive "None (...)" string (a real, known answer — distinct from
// null, which means "we couldn't resolve this ZIP").
export const NONE_SOUTHEAST = 'None (Southeast: vertically integrated)';
export const NONE_WECC = 'None (WECC: no ISO; CAISO WEIM participation is not full ISO membership)';
export const NONE_NON_INTERCONNECTED = 'None (non-interconnected)';

export const SUBREGION_TO_ISO = {
  ERCT: 'ERCOT',
  CAMX: 'CAISO',
  NEWE: 'ISO-NE',
  NYCW: 'NYISO', NYLI: 'NYISO', NYUP: 'NYISO',
  RFCE: 'PJM', RFCM: 'PJM', RFCW: 'PJM',
  SPNO: 'SPP', SPSO: 'SPP',
  SRMW: 'MISO', SRMV: 'MISO', MROE: 'MISO',
  MROW: 'MISO', // whole subregion is MISO, but it is split MISO/SPP internally
  SRVC: 'PJM',  // Dominion (Virginia) is PJM; the Carolinas portion is non-ISO
  SRSO: NONE_SOUTHEAST, SRTV: NONE_SOUTHEAST, FRCC: NONE_SOUTHEAST,
  AZNM: NONE_WECC, NWPP: NONE_WECC, RMPA: NONE_WECC,
  AKGD: NONE_NON_INTERCONNECTED, AKMS: NONE_NON_INTERCONNECTED,
  HIMS: NONE_NON_INTERCONNECTED, HIOA: NONE_NON_INTERCONNECTED,
  PRMS: NONE_NON_INTERCONNECTED,
};

// Subregions whose ISO answer is inherently ambiguous, so a single-subregion
// ZIP here still gets confidence "verify" rather than "exact".
//   MROW — split MISO / SPP internally.
//   SRVC — Virginia (Dominion) is PJM, but the Carolinas are not in any ISO.
export const VERIFY_SUBREGIONS = new Set(['MROW', 'SRVC']);

// Confidence levels, exported for callers that badge/filter on them.
export const ISO_CONFIDENCE = {
  EXACT: 'exact',
  SEAM: 'seam',
  VERIFY: 'verify',
  UNKNOWN: 'unknown',
};

// Normalize a ZIP to its 5-digit form: strip to digits, drop the +4, keep the
// first five, and zero-pad short (Northeast) ZIPs that lost a leading zero in
// a spreadsheet. Mirrors normalizeZip in utilityRatesStore.js; kept inline so
// this module stays dependency-free (and Node-testable) — the seed keys are
// zero-padded the same way. Returns '' when there's nothing usable.
function normalizeZip5(value) {
  if (value == null) return '';
  const head = String(value).trim().split('-')[0];
  // Letters mean a non-US postcode, and one or two digits are too little to
  // reconstruct a ZIP from — padding either invents a 000xx (Puerto Rico /
  // military) ZIP. See normalizeZip in utilityRatesStore.js.
  if (/[A-Za-z]/.test(head)) return '';
  const digits = head.replace(/\D/g, '');
  if (digits.length >= 5) return digits.slice(0, 5);
  if (digits.length >= 3) return digits.padStart(5, '0');
  return '';
}

// Collapse an ISO value to a market key for seam detection: every "None (...)"
// variant counts as the same non-ISO bucket, so a ZIP straddling two non-ISO
// subregions isn't mislabelled a seam, while ISO-vs-None (or two different
// ISOs) genuinely is.
function marketKey(iso) {
  if (iso == null) return 'NULL';
  return iso.startsWith('None') ? 'NONE' : iso;
}

// Resolve a ZIP to its ISO / RTO market.
// Returns { iso, egrid_subregion, iso_confidence } and never throws:
//   • unknown / invalid ZIP        -> { null, null, 'unknown' }
//   • single market                -> { iso, subregion, 'exact' | 'verify' }
//   • ZIP straddles two markets     -> primary market, 'seam'
export function lookupIsoForZip(zip) {
  const z = normalizeZip5(zip);
  const packed = z && EGRID_ZIP_SUBREGIONS[z];
  if (!packed) {
    return { iso: null, egrid_subregion: null, iso_confidence: ISO_CONFIDENCE.UNKNOWN };
  }
  const subs = packed.split('|');
  const predominant = subs[0];
  const iso = SUBREGION_TO_ISO[predominant] ?? null;
  if (iso == null) {
    // Subregion present in the seed but missing from the table (shouldn't
    // happen with the current eGRID release) — surface it rather than crash.
    return { iso: null, egrid_subregion: predominant, iso_confidence: ISO_CONFIDENCE.UNKNOWN };
  }

  const markets = new Set(subs.map(s => marketKey(SUBREGION_TO_ISO[s] ?? null)));
  let confidence;
  if (markets.size > 1) confidence = ISO_CONFIDENCE.SEAM;
  else if (VERIFY_SUBREGIONS.has(predominant)) confidence = ISO_CONFIDENCE.VERIFY;
  else confidence = ISO_CONFIDENCE.EXACT;

  return { iso, egrid_subregion: predominant, iso_confidence: confidence };
}

// Bulk-stamp ISO fields onto a list of records (Master Site List rows).
// Pure and idempotent: a row is only rewritten when its computed values
// differ from what's already stored, so a second run reports 0 updated.
// Returns the (possibly new) rows array plus a summary safe to log.
//
// zipKey lets callers point at their zip field ('zip' by default).
export function backfillIso(rows, { zipKey = 'zip' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = {
    total: list.length,
    updated: 0,
    unchanged: 0,
    byIso: {},
    exact: 0, seam: 0, verify: 0, unknown: 0,
  };
  const nz = (v) => (v === undefined ? null : v);

  const out = list.map((row) => {
    const { iso, egrid_subregion, iso_confidence } = lookupIsoForZip(row?.[zipKey]);

    summary[iso_confidence] = (summary[iso_confidence] || 0) + 1;
    const isoLabel = iso == null ? 'None/Unknown' : iso;
    summary.byIso[isoLabel] = (summary.byIso[isoLabel] || 0) + 1;

    const changed =
      nz(row?.iso) !== iso ||
      nz(row?.egrid_subregion) !== egrid_subregion ||
      nz(row?.iso_confidence) !== iso_confidence;

    if (!changed) { summary.unchanged++; return row; }
    summary.updated++;
    return { ...row, iso, egrid_subregion, iso_confidence };
  });

  return { rows: out, summary };
}
