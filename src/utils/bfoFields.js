// Whether a BFO field is actually filled in.
//
// The Opps rows come out of a Google sheet fed from BFO, and a cell with
// nothing behind it arrives in four different disguises: empty, a dash
// somebody typed to mean "none", and either casing of the "#N/A" a lookup
// formula leaves when it finds nothing. Every one of them means the same
// thing — nobody has put a value here — and reading a dash as a value is
// how an opp with no BFO Opportunity Name ends up counted as having one.
//
// Its own module because the test is shared: the New Opps list requires a
// BFO Opportunity Name, so does the closed-this-week table under it, and
// half a dozen flag rules ask the same question of other BFO fields. It had
// been written out longhand in each place, which is one drifting definition
// per reader.

/** True when a BFO field holds no real value — blank, "-", or an "#N/A". */
export function bfoFieldMissing(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

/** The other way round, for a filter that reads better as a positive. */
export function hasBfoField(value) {
  return !bfoFieldMissing(value);
}
