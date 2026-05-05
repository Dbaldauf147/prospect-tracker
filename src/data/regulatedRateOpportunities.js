// Utilities where Schneider has a regulated-rate-tariff savings play
// (rate optimization, time-of-use shifting, tariff reclassification,
// etc.) even though the market itself is regulated. Sites whose
// electric utility matches one of these get flagged on both the Site
// Detail and by-state Indicative Savings export tabs.
//
// Keyed by state code so the lookup stays cheap. Names are stored
// alongside their state because the same utility name can appear in
// more than one state (e.g. "Xcel Energy of MN" vs "Xcel Energy of
// CO" — different rate schedules, separate opportunities).

export const REGULATED_RATE_OPPORTUNITY_UTILITIES = [
  { state: 'IA', name: 'MidAmerican Energy Company of IA' },
  { state: 'IN', name: 'AES of Indiana (formerly Indianapolis Power & Light)' },
  { state: 'WI', name: 'Alliant Energy of WI (WP&L)' },
  { state: 'MA', name: 'EverSource (NSTAR Greater Boston)' },
  { state: 'NC', name: 'Duke Progress of NC (DEP NC)' },
  { state: 'SC', name: 'Berkeley Electric Cooperative' },
  { state: 'SC', name: 'Dominion South Carolina (FKA SCE&G)' },
  { state: 'CA', name: 'Southern California Edison (SCE)' },
  { state: 'NM', name: 'Public Service of NM' },
  { state: 'UT', name: 'PacifiCorp of UT (Rocky Mountain Power)' },
  { state: 'ND', name: 'Xcel Energy of ND (formerly Northern States Power Company)' },
  { state: 'TX', name: 'El Paso Electric Company of TX' },
  { state: 'IN', name: 'Duke Energy Indiana (DEI)' },
  { state: 'MI', name: 'Consumers Energy' },
  { state: 'FL', name: 'Duke Energy Florida' },
  { state: 'FL', name: 'TECO (Tampa Electric)' },
  { state: 'GA', name: 'Georgia Power' },
  { state: 'KY', name: 'Kentucky Utilities' },
  { state: 'KY', name: 'Louisville Gas & Electric' },
  { state: 'SC', name: 'Duke Energy of SC (DEC SC)' },
  { state: 'CO', name: 'Xcel Energy of CO (PSC of Colorado)' },
  { state: 'HI', name: 'Hawaiian Electric Co. (HECO)' },
  { state: 'MO', name: 'Everly (fka Kansas City Power & Light of MO (KCPL))' },
  { state: 'SD', name: 'Xcel Energy of SD (formerly Northern States Power Company)' },
  { state: 'TX', name: 'CPS Energy (fka City Public Service of San Antonio)' },
  { state: 'IN', name: 'Northern Indiana Public Service (NIPSCO)' },
  { state: 'MI', name: 'Lansing Board of Water and Light' },
  { state: 'FL', name: 'Florida Power & Light' },
  { state: 'CA', name: 'Glendale Water and Power' },
  { state: 'CA', name: 'Pacific Gas & Electric' },
  { state: 'KS', name: 'Evergy (fka Westar Energy)' },
  { state: 'LA', name: 'Entergy Gulf States Louisiana Inc.' },
  { state: 'LA', name: 'Entergy Louisiana LLC' },
  { state: 'MN', name: 'Xcel Energy of MN (formerly Northern States Power)' },
  { state: 'CT', name: 'United Illuminating Company' },
  { state: 'NJ', name: 'Atlantic City Electric' },
  { state: 'NY', name: 'Consolidated Edison' },
  { state: 'CA', name: 'Los Angeles Dept. of Water and Power' },
  { state: 'CA', name: 'San Diego Gas & Electric' },
];

// Returns true when the given (state, utility) pair is on the
// regulated-rate-opportunity list. Fuzzy-matches the utility name so
// branch suffixes ("Pepco of MD") or trivial differences ("FPL" vs
// "Florida Power & Light") still hit. Exported for reuse anywhere
// else this opportunity flag is needed.
import { findFuzzyMatch } from '../utils/utilityNameMatch';

export function isRegulatedRateOpportunity(state, utility) {
  if (!state || !utility) return false;
  const stateUpper = String(state).toUpperCase();
  const candidates = REGULATED_RATE_OPPORTUNITY_UTILITIES
    .filter(u => u.state === stateUpper)
    .map(u => u.name);
  if (candidates.length === 0) return false;
  return !!findFuzzyMatch(utility, candidates);
}
