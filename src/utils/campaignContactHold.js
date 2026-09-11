// Who, on a campaign's roster, is not to be emailed right now.
//
// A campaign's contact list is a fixed roster the user built by hand, and
// "Add unsent to Draft" queues every one of them who hasn't had the email
// yet. That is the right default and the wrong one for two people on every
// list: the contact who asked to be left alone for a fortnight (they're on
// leave, the deal is with legal, their colleague is handling it) and the
// contact nobody should mail again at all (they asked not to be, they've
// left, the address belongs to a competitor). Before this, the only way to
// keep either out of the next draft was to delete them from the campaign —
// which loses their send history, their replies and the reason.
//
// So a roster member carries an outreach state:
//
//   ''       contact freely — the default, and what every existing row is
//   'hold'   hold off until `holdUntil`, then back to normal on its own
//   'avoid'  never contact — stays until the user clears it
//
// A hold is a date rather than a flag, the same way a campaign's pause is
// (campaignOutreach.js): it lifts on its own, so there is nothing to
// remember to undo. An "avoid" deliberately has no clock — it is a standing
// decision about a person, not a wait for one.
//
// Everything here is pure: contact in, verdict out, with the clock passed
// in (scripts/campaignContactHold.test.mjs).

// How long "Hold off" parks a contact for when no date is picked. Two weeks:
// long enough to cover the leave or the wait that prompted it, short enough
// that the contact comes back while the campaign is still running.
export const CONTACT_HOLD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a hold started now should lift, as the ISO date (YYYY-MM-DD) to store
 * on the contact's `holdUntil`.
 *
 * A plain date, not a timestamp: the cell that sets it is a date picker, and
 * "held until the 25th" is the promise being made — not "until 14:32 on the
 * 25th".
 */
export function contactHoldUntil(nowMs = Date.now(), days = CONTACT_HOLD_DAYS) {
  return new Date(nowMs + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * When a stored `holdUntil` expires, in ms.
 *
 * A bare date means the END of that day: a contact held until the 25th is
 * still held all through the 25th, which is what somebody reading "held
 * until Sep 25" expects. Anything unparseable returns NaN, and the callers
 * below read that as a hold with no end date.
 */
function holdEndMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  // YYYY-MM-DD parses as UTC midnight; add the day so the hold covers it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = new Date(`${raw}T00:00:00Z`).getTime();
    return Number.isFinite(t) ? t + DAY_MS : NaN;
  }
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Is this contact one never to email again? */
export function isContactAvoided(c) {
  return c?.outreach === 'avoid';
}

/**
 * Is this contact on hold at this moment?
 *
 * A hold whose date has passed is simply over — the contact is back on the
 * list with nothing to undo. A hold with no usable date is held until the
 * user clears it: "Hold off" was chosen deliberately, so the safe reading of
 * a missing date is that the answer is still no, not that the hold quietly
 * evaporated.
 */
export function isContactOnHold(c, nowMs = Date.now()) {
  if (c?.outreach !== 'hold') return false;
  const end = holdEndMs(c?.holdUntil);
  return Number.isNaN(end) ? true : end > nowMs;
}

/**
 * The contact's outreach state as one word: 'avoid', 'hold' or 'open'.
 *
 * The table, the draft queue and the CSV all read this rather than checking
 * the fields themselves, so a contact can't be held on screen and mailed by
 * the button beside it. 'avoid' outranks a live hold: both mean don't email,
 * and the stronger reason is the one worth showing.
 */
export function contactOutreach(c, nowMs = Date.now()) {
  if (isContactAvoided(c)) return 'avoid';
  if (isContactOnHold(c, nowMs)) return 'hold';
  return 'open';
}

/** May this contact be emailed right now? */
export function canEmailContact(c, nowMs = Date.now()) {
  return contactOutreach(c, nowMs) === 'open';
}

// The state in the words the column uses. An expired hold reads as nothing
// at all, because that is what it is.
const OUTREACH_LABEL = { avoid: 'Avoid', hold: 'On hold', open: '' };
export function contactOutreachLabel(c, nowMs = Date.now()) {
  return OUTREACH_LABEL[contactOutreach(c, nowMs)] ?? '';
}

/**
 * How many of a roster are held, avoided, and still mailable.
 *
 * `blocked` is the two that can't be mailed, counted once each — what the
 * "Add unsent to Draft" button leaves out, and the number the roster line
 * prints.
 */
export function outreachCounts(contacts, nowMs = Date.now()) {
  let onHold = 0, avoided = 0;
  for (const c of (contacts || [])) {
    const state = contactOutreach(c, nowMs);
    if (state === 'avoid') avoided += 1;
    else if (state === 'hold') onHold += 1;
  }
  return { onHold, avoided, blocked: onHold + avoided, open: (contacts || []).length - onHold - avoided };
}

/**
 * The fields to write when a row's outreach state is changed.
 *
 * Picking "Hold off" with no date already on the contact stamps the default
 * two weeks, so choosing it is one click rather than a click and a date;
 * picking it on a contact that already has a date keeps that date, so
 * flipping to Avoid and back doesn't quietly move it. Anything else clears
 * the date — an avoided or freely-contactable person has no hold to carry,
 * and a stale date left behind reappears the moment they go back on hold.
 */
export function outreachPatch(c, state, nowMs = Date.now()) {
  if (state !== 'hold') return { outreach: state === 'avoid' ? 'avoid' : '', holdUntil: '' };
  const existing = String(c?.holdUntil || '').trim();
  return {
    outreach: 'hold',
    holdUntil: existing && !Number.isNaN(holdEndMs(existing)) ? existing : contactHoldUntil(nowMs),
  };
}
