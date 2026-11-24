// Where a service's status on the company card comes from, for the popup
// behind the status on the Services board.
//
// A status is one of: typed by hand (servicesExplored), the stage of an opp
// whose Scope names the service, or an automatic N/A. The board only ever
// showed the result; this says which it was and, for an opp-fed status,
// which opps name the service and which of them set it.
//
// The stage priority is the board's own (ProspectModal scopeMatchedServices
// and utils/serviceCoverage buildOppStagesByClient): when several opps name
// the service the strongest stage wins, so "feeds" marks every opp at that
// stage. Import-light so it runs under plain Node (scripts/*.test.mjs).

import { scopeTokens, scopeTokenMatchesService } from './scopeMatch.js';

export const OPP_STAGE_PRIORITY = { 'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2, 'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0 };

export function oppStagePriority(stage) {
  return OPP_STAGE_PRIORITY[String(stage || '').trim()] ?? 1;
}

/** Does this opp's Scope name the service? */
export function oppNamesService(opp, service) {
  return scopeTokens(opp?.scope).some(part => scopeTokenMatchesService(part, service));
}

/**
 * The opps that name `service`, each marked `feeds` when its stage is the one
 * the board settles on. Feeding opps come first, then the rest in the order
 * given (the caller's list order).
 */
export function oppsForService(opps, service) {
  const named = (opps || []).filter(o => o && oppNamesService(o, service));
  if (!named.length) return [];
  const top = Math.max(...named.map(o => oppStagePriority(o.stage)));
  const topStage = named.find(o => oppStagePriority(o.stage) === top).stage;
  const marked = named.map(o => ({ ...o, feeds: String(o.stage || '').trim() === String(topStage || '').trim() }));
  return [...marked.filter(o => o.feeds), ...marked.filter(o => !o.feeds)];
}

/**
 * Which source the board's status for one service came from.
 * `manual` is the servicesExplored value ('-' or blank for none).
 * Returns 'manual' | 'opp' | 'auto-na' | 'category-na' | 'none'.
 */
export function serviceStatusSourceKind({ manual, oppStage, autoNa, categoryNa }) {
  if (manual && manual !== '-') return 'manual';
  if (oppStage) return 'opp';
  if (autoNa) return 'auto-na';
  if (categoryNa) return 'category-na';
  return 'none';
}
