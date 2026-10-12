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
