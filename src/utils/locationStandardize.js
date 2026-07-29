// Helpers for flagging non-standard City / State values on the contact
// tables and suggesting a clean, standardized replacement.
//
// Canonical formats (matching the rest of the app):
//   - State: full name, e.g. "New York" (not "NY", "ny", or "N.Y.").
//     Source of truth is the US_MARKETS / CA_MARKETS name field.
//   - City:  a clean city name with no embedded state and standard
//     capitalization, e.g. "Atlanta" (not "Atlanta, GA" or "ATLANTA").
//
// Each checker returns `null` when the value is already standard, or
// `{ issue, fix }` where `issue` describes the problem and `fix` is the
// suggested standardized value (or `null` when no automatic fix is
// safe — the user must clean it manually).

import { US_MARKETS, CA_MARKETS } from '../data/naMarkets';
import { CITY_OPTIONS } from '../data/cities';

const STATE_RECORDS = [...US_MARKETS, ...CA_MARKETS];
const STATE_BY_ABBR = new Map(); // 'ny' -> 'New York'
const STATE_BY_NAME = new Map(); // 'new york' -> 'New York'
for (const { code, name } of STATE_RECORDS) {
  STATE_BY_ABBR.set(code.toLowerCase(), name);
  STATE_BY_NAME.set(name.toLowerCase(), name);
}

const CITY_BY_ALIAS = new Map(); // 'nyc' -> 'New York City'
for (const opt of CITY_OPTIONS) {
  for (const a of (opt.aliases || [])) CITY_BY_ALIAS.set(a.toLowerCase(), opt.name);
}

function titleCase(s) {
  return String(s).replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Canonicalize a bare city name: prefer a curated alias's canonical
// name, otherwise title-case obvious all-caps / all-lower values.
function canonCity(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  const alias = CITY_BY_ALIAS.get(n.toLowerCase());
  if (alias) return alias;
  if (n === n.toUpperCase() || n === n.toLowerCase()) return titleCase(n);
  return n;
}

export function checkState(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  // Already a canonical full name with correct casing.
  if (STATE_BY_NAME.get(lower) === raw) return null;
  // Right name, wrong capitalization (e.g. "new york").
  if (STATE_BY_NAME.has(lower)) {
    const fix = STATE_BY_NAME.get(lower);
    return { issue: `Non-standard capitalization — use "${fix}"`, fix };
  }
  // Abbreviation, with or without dots (e.g. "NY", "N.Y.").
  const letters = raw.replace(/[^a-z]/gi, '').toLowerCase();
  if (letters.length <= 3 && STATE_BY_ABBR.has(letters)) {
    const fix = STATE_BY_ABBR.get(letters);
    return { issue: `Abbreviation — use full name "${fix}"`, fix };
  }
  // Extra text / comma (e.g. "New York, USA").
  if (raw.includes(',')) {
    const first = raw.split(',')[0].trim();
    const inner = checkState(first);
    const fix = inner ? inner.fix : (STATE_BY_NAME.get(first.toLowerCase()) || null);
    return { issue: 'Contains extra text — keep only the state', fix: fix || null };
  }
  return { issue: 'Unrecognized state — standardize manually', fix: null };
}

export function checkCity(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // "Atlanta, GA" — city field carries the state.
  if (raw.includes(',')) {
    return { issue: 'City field contains a state — keep only the city', fix: canonCity(raw.split(',')[0]) };
  }
  // "Atlanta GA" — trailing 2-letter state code.
  const m = raw.match(/^(.*\S)\s+([A-Za-z]{2})$/);
  if (m && STATE_BY_ABBR.has(m[2].toLowerCase())) {
    return { issue: 'City field contains a state abbreviation — keep only the city', fix: canonCity(m[1]) };
  }
  // Known alias (e.g. "NYC", "Vegas") → canonical name.
  const aliasFix = CITY_BY_ALIAS.get(raw.toLowerCase());
  if (aliasFix && aliasFix !== raw) {
    return { issue: `Use canonical city name "${aliasFix}"`, fix: aliasFix };
  }
  // ALL CAPS or all-lowercase → standard capitalization.
  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  if ((!hasLower && hasUpper && /[A-Z]{2,}/.test(raw)) || (hasLower && !hasUpper)) {
    const fix = titleCase(raw);
    if (fix !== raw) return { issue: 'Non-standard capitalization', fix };
  }
  return null;
}
