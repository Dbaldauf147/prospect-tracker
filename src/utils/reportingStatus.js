// The status an account is reported under, as opposed to the one saved on
// it.
//
// A company with a Substatus set (company popup, beside Status) reads as
// Hold Off: its saved Status stays what it is, usually Client, so anything
// that checks Status against the opps (the status-mismatch flag, the BFO
// match) still sees Client and has nothing to warn about, while My
// Accounts shows and counts it as Hold Off and leaves it out of Clients.
// Clearing the substatus brings the saved status straight back.
//
// "Has a substatus" is asked with hasSubstatus, never by comparing the
// reported status to Hold Off: a company whose own Status is Hold Off
// reads the same but is not parked by a substatus, and the rules below
// (leave it out of the charts) are about the substatus.
export const SUBSTATUS_HOLD_STATUS = 'Hold Off';

/** Whether the account has a substatus set. */
export function hasSubstatus(account) {
  return !!String(account?.substatus ?? '').trim();
}

/**
 * Whether the account's own Status is Hold Off with no substatus saying
 * why: the company popup and My Accounts warn about it.
 */
export function holdOffMissingSubstatus(account) {
  return String(account?.status ?? '').trim() === SUBSTATUS_HOLD_STATUS && !hasSubstatus(account);
}

/** 'Hold Off' when the account has a substatus, else its saved Status. */
export function reportingStatus(account) {
  if (hasSubstatus(account)) return SUBSTATUS_HOLD_STATUS;
  return account?.status ?? '';
}

/**
 * The companies with a substatus as a { [lower-cased company]: true } map,
 * the same shape as the Clients tab's "Don't Track" map, so the Progress
 * charts and the Weekly Report can leave them out the way they leave those
 * out (utils/progressUntracked): every saved week re-answered without
 * them, nothing rewritten, and clearing the substatus puts them back.
 */
export function substatusNameMap(prospects) {
  const out = {};
  for (const p of (Array.isArray(prospects) ? prospects : [])) {
    const name = String(p?.company || '').trim().toLowerCase();
    if (name && hasSubstatus(p)) out[name] = true;
  }
  return out;
}

/** The "Don't Track" map with the companies that have a substatus added. */
export function withSubstatusLeftOut(untrackedMap, prospects) {
  const held = substatusNameMap(prospects);
  return Object.keys(held).length ? { ...(untrackedMap || {}), ...held } : (untrackedMap || {});
}

// The statuses the two account-coverage charts (% with HubSpot Contacts,
// % with Decision Maker Identified) leave out: an account on hold or a
// client that has left is not one anybody is mapping, and counting it
// pulled the coverage down for accounts nobody meant to work. Read as
// reported, so a company with a substatus (Hold Off) is out as well.
// Only those two charts: % Inactive counts exactly these accounts.
export const COVERAGE_LEFT_OUT_STATUSES = new Set(['Hold Off', 'Old Client']);

/** The Hold Off / Old Client companies as a { [lower-cased company]: true } map. */
export function coverageLeftOutNameMap(prospects) {
  const out = {};
  for (const p of (Array.isArray(prospects) ? prospects : [])) {
    const name = String(p?.company || '').trim().toLowerCase();
    if (name && COVERAGE_LEFT_OUT_STATUSES.has(String(reportingStatus(p)).trim())) out[name] = true;
  }
  return out;
}

/** The "Don't Track" map with every Hold Off and Old Client company added, for the coverage charts. */
export function withCoverageLeftOut(untrackedMap, prospects) {
  const out = coverageLeftOutNameMap(prospects);
  return Object.keys(out).length ? { ...(untrackedMap || {}), ...out } : (untrackedMap || {});
}
