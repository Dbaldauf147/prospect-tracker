// The indicative commodity-savings bands for North America: the low /
// high percentage each US state and Canadian province earns on
// deregulated electric and gas spend, alongside the deregulation status
// that decides whether a market earns a band at all.
//
// These two maps used to live inside SitesView. They moved here so the
// Lists > Market Savings editor and SitesView read one copy: the editor
// lists every market with the band it is on and lets the seller retype
// the figures, and SitesView applies those edits over these defaults
// (see utils/marketSavings.js). Two copies would have meant the editor
// showing one band and the export quoting another.
//
// Editing this file moves money: it sets the indicative savings band for
// every site in the state, for every seller, before any per-user
// override. naMarkets.js mirrors the status for display and has to be
// updated alongside it — see the source-of-truth note at the top of that
// file.

// Electric deregulation status per state / province, with the
// corresponding indicative savings range. Anything not listed here
// is treated as a regulated market with zero savings — the user
// explicitly asked that regulated markets show no savings.
export const STATE_ELECTRIC_BANDS = {
  AB: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
  CT: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  DC: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  DE: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  IL: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  MA: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  MD: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  ME: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  NH: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  NJ: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  NY: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
  OH: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  ON: { status: 'yes',     range: '0%',      lowPct: 0,    highPct: 0 },
  OR: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  PA: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  RI: { status: 'yes',     range: '2 - 4%',  lowPct: 0.02, highPct: 0.04 },
  TX: { status: 'yes',     range: '1 - 2%',  lowPct: 0.01, highPct: 0.02 },
  // Limited-deregulation markets — the underlying retail-choice
  // programs are narrow enough (Direct Access only in CA, opt-in
  // pilots in MI, prior-3rd-party gating in AZ) that the standard
  // 2-4 % commodity savings doesn't apply. Surfaced as 0 - 0 % so
  // the Indicative Savings tab still lists them (Status stays
  // "Limited" so they aren't filtered out as regulated) but every
  // savings column resolves to $0. WA is intentionally absent —
  // its retail-choice pilot was small enough that the seller no
  // longer wants WA sites surfaced as deregulated at all, so it
  // falls through to the regulated bucket. VA is held in
  // VA_ELECTRIC_BAND below — it's only folded in when at least one
  // site clears the 45,000 MWh/yr large-load threshold.
  AZ: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
  CA: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
  MI: { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 },
};

// Virginia's electric band, held apart because Virginia only earns one
// at all when the portfolio has a site big enough to use it: retail
// choice there is gated on a single site consuming more than
// 45,000 MWh/yr. SitesView folds this entry into the electric map only
// when an uploaded site clears that threshold, so a portfolio of small
// Virginia sites doesn't advertise a savings motion it can't run. The
// Market Savings editor shows the row either way, since the figure is a
// standing one and the gate is per-upload.
export const VA_ELECTRIC_BAND = { status: 'Limited', range: '0 - 0%', lowPct: 0, highPct: 0 };

// Per-state natural-gas deregulation status + savings range. States
// marked "Large load only" mean retail choice is restricted to
// industrial / large-volume customers, so the standard 2-4 %
// doesn't apply — they carry a 0 - 0 % savings range so the row
// still surfaces on the Indicative Savings tab (status keeps it
// out of the regulated-hide filter) but every savings column
// resolves to $0. Anything not in this map falls through to
// status 'no'.
//
// US coverage is a closed list, corrected against the seller's own
// read of the gas markets: AL, ID, MS, MT, ND and SD are the only
// large-load-only states, Vermont is the only regulated one (so it is
// the one US code deliberately absent below), and every other state
// plus DC is fully competitive at 2 - 4 %. Canada is unchanged and is
// NOT covered by that rule — AB, BC and MB stay large-load-only.
//
// Editing this map moves money: it sets the indicative gas savings
// band for every site in the state. naMarkets.js mirrors the status
// for display and has to be updated alongside it.
export const STATE_GAS_BANDS = {
  AK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  AR: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  AZ: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  CA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  CO: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  CT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  DC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  DE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  FL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  GA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  HI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  IA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  IL: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  IN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  KS: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  KY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  LA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  MA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  MD: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  ME: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  MI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  MN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  MO: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NB: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NE: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NJ: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NM: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NV: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  NY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  OH: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  OK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  ON: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  OR: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  PA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  QC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  RI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  SC: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  SK: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  TN: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  TX: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  UT: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  VA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  WA: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  WI: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  WV: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  WY: { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 },
  // Large-load-only markets — retail choice is restricted to
  // industrial / large-volume customers.
  AB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  AL: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  BC: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  ID: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  MB: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  MS: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  MT: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  ND: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
  SD: { status: 'Large load only', range: '0 - 0%', lowPct: 0, highPct: 0 },
};
