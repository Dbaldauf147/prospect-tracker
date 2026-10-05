// The electric utility EIA names as the main one serving a US zip, from the
// bundled table scripts/buildEiaZipUtilities.mjs generates.
//
// A fallback, not a source of truth: the Utility Lookup page asks the
// user's uploaded utility file first and a utility named in the site list
// second, and only reaches for this when both are silent. It is what lets
// an upload with no utility column still say which side of a competitive
// state's market each site sits on.
//
// Electric only: EIA publishes service territories for electric utilities,
// and there is no free equivalent for gas.

import { EIA_UTILITY_NAMES, EIA_ZIP_UTILITY } from '../data/eiaZipUtilities.js';

export function eiaElectricUtilityForZip(zip) {
  const z = String(zip ?? '').trim();
  if (!/^\d{5}$/.test(z)) return null;
  const idx = EIA_ZIP_UTILITY[z];
  return idx == null ? null : (EIA_UTILITY_NAMES[idx] || null);
}
