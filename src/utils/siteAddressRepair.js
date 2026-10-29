// Putting a site's location back together when the upload split it into
// the wrong columns.
//
// The case that prompted this is a Canadian / UK portfolio whose export
// ran the whole address into one cell and halved the postal code across
// City and Zip:
//
//   Address  "96 Glencoe Drive, , Mount Pearl, , NL"
//   City     "A1N"        <- first half of the postal code
//   State    ""
//   Zip      "4S9"        <- second half
//
// Nothing downstream could place those sites: no country, no state, and a
// "city" that is a postal fragment, so the PRW summary counted 47 of 452
// as unplaced. Both halves of a Canadian (A1N 4S9) or UK (NG22 8TX) code
// have shapes no real city or US zip has, so the split is recognised from
// the values themselves and the code is rejoined; the city and province
// are then read back out of the tail of the address, and the country
// follows from the postal code's shape.
//
// Conservative on purpose. A row whose City is a real city and whose zip
// is whole is returned untouched, a Country that was uploaded is never
// overwritten, and a field is only filled where it was blank or held the
// postal fragment. Pure, so scripts/siteAddressRepair.test.mjs pins it.

import { normalizeProvince } from '../data/naMarkets.js';
import { normalizeState } from './utilityRates.js';

const CA_FSA = /^[ABCEGHJ-NPRSTVXY]\d[A-Z]$/i;
const CA_LDU = /^\d[A-Z]\d$/i;
const CA_FULL = /^([ABCEGHJ-NPRSTVXY]\d[A-Z])\s*-?\s*(\d[A-Z]\d)$/i;
const UK_OUTWARD = /^(GIR|[A-Z]{1,2}\d[A-Z\d]?)$/i;
const UK_INWARD = /^\d[A-Z]{2}$/i;
const UK_FULL = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

const clean = (v) => String(v ?? '').trim();

// The postal code a row carries, and the country its shape belongs to.
// `splitAcrossCity` says the first half was sitting in the City column.
function readPostal(city, zip) {
  const c = clean(city), z = clean(zip);
  if (CA_FSA.test(c) && CA_LDU.test(z)) {
    return { postal: `${c} ${z}`.toUpperCase(), country: 'Canada', splitAcrossCity: true };
  }
  if (UK_OUTWARD.test(c) && UK_INWARD.test(z)) {
    return { postal: `${c} ${z}`.toUpperCase(), country: 'United Kingdom', splitAcrossCity: true };
  }
  let m = z.match(CA_FULL);
  if (m) return { postal: `${m[1]} ${m[2]}`.toUpperCase(), country: 'Canada', splitAcrossCity: false };
  m = z.match(UK_FULL);
  if (m) return { postal: `${m[1]} ${m[2]}`.toUpperCase(), country: 'United Kingdom', splitAcrossCity: false };
  return null;
}

// "96 Glencoe Drive, , Mount Pearl, , NL" -> street, city, province.
// "Garanor Way, , Portbury"               -> street, city.
// The blank pieces are the export's empty Address 2 / State slots.
export function splitAddressTail(address) {
  const parts = clean(address).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return { street: clean(address), city: '', state: '' };
  let state = '';
  const last = parts[parts.length - 1];
  if (normalizeProvince(last) || normalizeState(last)) {
    state = last.toUpperCase();
    parts.pop();
  }
  if (parts.length < 2) return { street: parts.join(', '), city: '', state };
  const city = parts.pop();
  return { street: parts.join(', '), city, state };
}

/**
 * The repaired location for one site:
 *
 *   { address, city, state, zip, country, changed: [field, ...] }
 *
 * Input and output carry the same five fields; `changed` lists the ones
 * that differ, empty when the row needed nothing.
 */
export function repairSiteLocation(site) {
  const input = {
    address: clean(site?.address),
    city: clean(site?.city),
    state: clean(site?.state),
    zip: clean(site?.zip),
    country: clean(site?.country),
  };
  const out = { ...input };
  const postal = readPostal(input.city, input.zip);
  // Nothing recognisably split and the city is filled: leave it alone.
  if (!postal && input.city) return { ...out, changed: [] };

  if (postal) {
    out.zip = postal.postal;
    if (!out.country) out.country = postal.country;
    if (postal.splitAcrossCity) out.city = '';
  }
  // Only take the address apart when it is carrying a city we lack.
  if (!out.city || !out.state) {
    const tail = splitAddressTail(input.address);
    if (tail.city && !out.city) {
      out.city = tail.city;
      out.address = tail.street;
    }
    if (tail.state && !out.state) {
      out.state = tail.state;
      if (out.address === input.address) out.address = tail.street;
    }
  }
  // A province code with no postal code still says Canada.
  if (!out.country && normalizeProvince(out.state) && !normalizeState(out.state)) out.country = 'Canada';

  const changed = Object.keys(input).filter(k => out[k] !== input[k]);
  return { ...out, changed };
}
