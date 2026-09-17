// The forward curve: what Henry Hub is quoted at for months that have not
// settled yet.
//
// The Savings subtab prices a term off the settle table first, this second,
// and a single flat number only where neither reaches. That order matters
// and the page shows which of the three every month came from, because a
// saving measured against a settle and a saving measured against a quote
// are different claims and should never be added up without saying so.
//
// A curve goes stale in a way a settle never does. The settle for March 2008
// is the settle for March 2008 forever; this is a snapshot of what the strip
// was quoted at on the as-of date below, and it is worth a fraction of that
// a few months later. Paste a fresh one over it on the subtab when it
// matters, which saves under the user's settings rather than into this file.
//
// [year, month (Jan is 1), price in $/Dth]

/** When this strip was quoted. Shown wherever the curve is, so nobody reads a stale snapshot as today's market. */
export const NYMEX_FORWARD_ASOF = 'Oct 2026';

export const NYMEX_FORWARD = [
  [2026, 11, 3.043],
  [2026, 12, 3.418],
  [2027,  1, 3.787],
  [2027,  2, 3.467],
  [2027,  3, 2.842],
  [2027,  4, 2.731],
  [2027,  5, 2.759],
  [2027,  6, 2.916],
  [2027,  7, 3.135],
  [2027,  8, 3.208],
  [2027,  9, 3.193],
  [2027, 10, 3.280],
  [2027, 11, 3.576],
  [2027, 12, 4.201],
  [2028,  1, 4.626],
  [2028,  2, 4.209],
  [2028,  3, 3.471],
  [2028,  4, 3.233],
  [2028,  5, 3.229],
  [2028,  6, 3.391],
  [2028,  7, 3.600],
  [2028,  8, 3.653],
  [2028,  9, 3.640],
  [2028, 10, 3.671],
];
