// What each piece of a delivered gas price is, for the hover text on the
// Sourcing subtabs. One place so the Basis box, the Retail adder box and
// every "index" label say the same thing in the same words.
//
// Each is two sentences: what the component represents, then what moves it.

export const HENRY_HUB_TIP =
  'Henry Hub (NYMEX): the national benchmark commodity price for natural gas, settled at the Erath, Louisiana hub.\n'
  + 'Key drivers: national supply and demand, weather forecasts, gas-in-storage levels, and LNG exports.';

export const BASIS_TIP =
  'Basis ($/Dth): the price difference between the Henry Hub benchmark and your specific local delivered point (citygate).\n'
  + 'Key drivers: regional pipeline capacity, local congestion, distance from production basins, and local extreme weather events.';

export const RETAIL_ADDER_TIP =
  'Retail adder ($/Dth): the fee added by a Retail Energy Provider (REP) to cover delivery execution and risk management.\n'
  + 'Key drivers: supplier margin, local utility volumetric shaping, imbalance fees, credit risk, and line loss costs.';
