// "Trying again" — the purple state a service shows when the company card
// already carries a saved status for it AND an opp now names that same
// service. It means the service has been round the block before and is back
// in play, which neither half of the pair says on its own: the saved status
// alone reads as history, and the opp-derived status alone reads as a first
// attempt.
//
// Derived, never stored. The saved status stays exactly as it was — the
// status dropdowns keep their own options and keep showing the underlying
// value when opened, so nothing here changes what is written to
// servicesExplored. This module only decides how the row is painted.
//
// Two boards render service statuses (the company card's Services Explored
// grid and Opps 2's "Scope: select services" board), and they have to agree
// on when a service is being retried — hence one implementation rather than
// a copy in each.

import { isActiveOppStage } from './oppStages.js';

export const TRYING_AGAIN = 'Trying again';

// purple-100 / purple-800 — distinct from the green (won), amber (in-flight),
// blue (quoted) and red (lost) families already on these boards.
export const TRYING_AGAIN_COLORS = { bg: '#F3E8FF', color: '#6B21A8', border: '#E9D5FF' };

// A saved status counts as "previous" only if it is a real value: both boards
// use '-' as their "no override, fall back to auto" sentinel, and an empty
// string is a service that was never touched.
export function hasSavedStatus(manual) {
  const v = String(manual ?? '').trim();
  return !!v && v !== '-';
}

// manual: the status saved on the company card for this service.
// auto:   the STAGE of the opp whose Scope names this service — both boards
//         put a stage here ('Quoted', 'Sold', …), not a free-text status.
//
// Both present AND that opp still live → the service is being tried again.
//
// The live check is the whole point of the pair. "Trying again" claims a
// service is back IN PLAY, and a closed opp is the opposite of that: a deal
// marked Sold or Not Sold years ago is exactly the history the saved status
// already records. Without this, every service that had ever appeared on any
// closed opp went purple the moment the company card carried a status for it
// — which on an established account is most of the board, and reads as a
// pipeline that isn't there.
export function isTryingAgain(manual, auto) {
  return hasSavedStatus(manual) && isActiveOppStage(auto);
}

// Tooltip shared by both boards, so the purple chip explains itself the same
// way wherever it turns up.
export function tryingAgainTitle(manual, auto) {
  return `Trying again: this service was already marked “${manual}”, and a live opp now names it${auto ? ` (${auto})` : ''}. The saved status is unchanged.`;
}
