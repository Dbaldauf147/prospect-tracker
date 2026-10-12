// The status an account is reported under, as opposed to the one saved on
// it.
//
// A company with a Substatus set (company popup, beside Status) reads as
// On Hold: its saved Status stays what it is, usually Client, so anything
// that checks Status against the opps (the status-mismatch flag, the BFO
// match) still sees Client and has nothing to warn about, while My
// Accounts shows and counts it as On Hold and leaves it out of Clients.
// Clearing the substatus brings the saved status straight back.
export const ON_HOLD_STATUS = 'On Hold';

/** 'On Hold' when the account has a substatus, else its saved Status. */
export function reportingStatus(account) {
  if (String(account?.substatus ?? '').trim()) return ON_HOLD_STATUS;
  return account?.status ?? '';
}

/**
 * The On Hold companies as a { [lower-cased company]: true } map, the same
 * shape as the Clients tab's "Don't Track" map, so the Progress charts and
 * the Weekly Report can leave them out the way they leave those out
 * (utils/progressUntracked): every saved week re-answered without them,
 * nothing rewritten, and clearing the substatus puts them back.
 */
export function onHoldNameMap(prospects) {
  const out = {};
  for (const p of (Array.isArray(prospects) ? prospects : [])) {
    const name = String(p?.company || '').trim().toLowerCase();
    if (name && reportingStatus(p) === ON_HOLD_STATUS) out[name] = true;
  }
  return out;
}

/** The "Don't Track" map with the On Hold companies added to it. */
export function withOnHoldLeftOut(untrackedMap, prospects) {
  const onHold = onHoldNameMap(prospects);
  return Object.keys(onHold).length ? { ...(untrackedMap || {}), ...onHold } : (untrackedMap || {});
}
