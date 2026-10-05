// Shared utility-provider classification + zip-based utility lookup.
//
// Both the Utility Lookup page (SitesView) and the Master Site List
// pull the indicative electric utility for a site from the uploaded
// zip → utility-rates table, then label it Regulated vs Deregulated.
// Keeping this logic in one place means the two pages always agree.

import { normalizeZip } from './utilityRatesStore';

// Classify a utility provider as "Regulated" (monopoly market — usually
// municipally owned, public power, or a cooperative) or "Deregulated"
// (competitive retail market). Based on the provider name only, since
// that's all the lookup file gives us. Well-known municipal and coop
// utilities that don't follow the naming conventions get an explicit
// override so Austin Energy / LADWP / SMUD / TVA etc. classify correctly.
export const REGULATED_PATTERNS = [
  /^city of\b/i,
  /\bmunicipal\b/i,
  /\b(co-?op|cooperative)\b/i,
  /\bpublic power\b/i,
  /\bpublic utilit(y|ies)\b/i,
  /\b(power|electric|utility|utilities)\s+authority\b/i,
  /\b(p\.?u\.?d\.?)\b/i, // Public Utility District
  /\bmembership corp(oration)?\b/i, // Rural electric membership corps
  /\belectric (membership|cooperative)\b/i,
  // How EIA's Form 861 names municipals and coops, which the bundled zip
  // table (eiaZipUtilities.js) carries: "Town of Wallingford", "Blue Ridge
  // Elec Member Corp", "Dixie Electric Power Assn", "Groton Dept of
  // Utilities", "Block Island Utility District".
  /^(town|village|borough|township) of\b/i,
  /\belec(tric)? member corp\b/i,
  /\bE ?M ?C\b/,
  /\brural E ?C ?A\b/i,
  /\belectric (power )?ass(n|ociation)\b/i,
  /\bdep(t|artment) of utilities\b/i,
  /\b(light|electric light|light (&|and) power) dep(t|artment)\b/i,
  /\butility district\b/i,
  /\bboard of public util/i,
  /^city utilities\b/i,
  /\bel(ec|ectric)?\.? (power|pwr) assn\b/i,
  /\bR ?E ?M ?C\b/,
  /\brural (E ?C ?C|el(ec|ectric)?\b)/i,
  /\b(board|comm|commission)\b/i,
  /\bwater (&|and) (light|lighting|electric)\b/i,
  /\((city|town|village) of\)/i,
  /\bel(ec|ectric)?\.? members? corp/i,
  /\bel(ec|ectric)?\.? assn\b/i,
  // Spelled-out initials: E C (C) / E C A coop, E P A power association,
  // R E C (C) / R E A rural electric, P P D / P U D public power district.
  /\b(E C( [CA])?|E P A|R E (C( C)?|A)|P P D|P U D|RECC?|REA|EPA|PPD)\b/,
  /\bpower assn\b/i,
  /\bp(ub|ublic)\.? p(wr|ower) dist/i,
  /\bpower dist(rict)?\b/i,
  /\birr(igation)?\b/i,
  /\bpeople'?s ut/i,
  /\bmun\b/i,
  /\bpublic works\b/i,
  /\benergy authority\b/i,
  /\belectric system\b/i,
  /\bcounty$/i,
  /\bcity corp/i,
  /^city (&|and) county of\b/i,
];
export const REGULATED_OVERRIDES = [
  /^austin energy\b/i,
  /^ladwp\b/i,
  /\b(department|dept\.?) of water\s*(and|&)\s*power\b/i,
  /^smud\b/i,
  /^sacramento municipal/i,
  /^seattle city light\b/i,
  /^tacoma power\b/i,
  /^cps energy\b/i, // San Antonio
  /^jea\b/i,         // Jacksonville
  /^ouc\b/i,         // Orlando Utilities Commission
  /^orlando utilities/i,
  /^long island power\b/i,
  /^lipa\b/i,
  /^nyseg\b/i,
  /^nebraska public power\b/i,
  /^omaha public power\b/i,
  /^salt river project\b/i,
  /^srp\b/i,
  /^colorado springs utilities\b/i,
  /^nashville electric\b/i,
  /^memphis light,?\s*gas/i,
  /^knoxville utilities\b/i,
  /^epb\b/i,                       // Chattanooga
  /^bonneville power\b/i,
  /^tva\b/i,
  /^tennessee valley authority\b/i,
  /^gainesville regional utilities\b/i,
  /^lakeland electric\b/i,
];

export function classifyUtility(name) {
  if (!name) return null;
  const str = String(name).trim();
  if (!str) return null;
  if (REGULATED_OVERRIDES.some(r => r.test(str))) return 'Regulated';
  if (REGULATED_PATTERNS.some(r => r.test(str))) return 'Regulated';
  return 'Deregulated';
}

// Look up the indicative electric utility for a zip from the uploaded
// zip → utility-rates map (the same { zipMap } produced on the Utility
// Lookup page). Returns { utility, status, state, country } where status
// is the Regulated/Deregulated classification of the electric provider.
// Falls back to gas when no electric provider is on file.
export function lookupUtilityForZip(zipMap, zip) {
  const empty = { utility: '', status: '', state: '', country: '' };
  if (!zipMap) return empty;
  const z = normalizeZip(zip);
  if (!z) return empty;
  const entry = zipMap[z];
  if (!entry) return empty;
  const utility = entry.electric || entry.gas || '';
  return {
    utility,
    status: classifyUtility(utility) || '',
    state: entry.state || '',
    country: entry.country || '',
  };
}
