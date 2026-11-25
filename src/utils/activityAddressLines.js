// The "BFO Address" block the Agents page's Activity prompt carries — one
// line per BFO record, saying which kind of touch to log against it.
//
// One opportunity can pick up several touches in the same window: a
// meeting at 11:30 and a follow-up email at 4:32 both land on the same
// account. Only one gets logged, so the choice is which one — and it is
// always the strongest:
//
//   meeting > call > email
//
// A meeting is the touch worth having on the record. Logging the email
// instead loses that the meeting happened at all, which is exactly what
// used to occur: only meetings MARKED on the Opps tab were considered
// here, so a meeting that came from HubSpot or from a Granola note — the
// ones the Activity table actually shows — never reached the prompt, and
// the email to the same account won by default.
//
// Deduping is by BFO address, not by company: two opportunities at one
// account are two records and both get logged.
//
// Pure — no React — so the precedence can be tested directly. It is the
// kind of rule that is invisible when wrong: the prompt still looks
// complete, it just says the wrong thing about the day.

/** A touch's BFO address, or '' when it has none to log against. */
function addressOf(row) {
  return String(row?.bfoUrl || '').trim();
}

/**
 * Build the block.
 *
 *   meetings        the Activity table's meeting rows (HubSpot + Granola)
 *   markedMeetings  opps marked "Meeting" on the Opps tab
 *   calls           opps that count as called in the window
 *   emails          outbound emails, each with the nextStepsType to log
 *
 *   accountOf       row -> its BFO Company Name ('' when unknown). A touch
 *                   with no BFO opportunity address is logged on that BFO
 *                   Account instead, in a second list after the addresses
 *                   (see ACCOUNT_HEADER): one task per account, the
 *                   strongest touch, and none for an account already
 *                   getting a task through one of its opportunities.
 *                   A bounced email is not a touch and is left out there.
 *
 *   limit           the most entries (addresses, then accounts) to list,
 *                   or null for all of them. The cut keeps the block's own
 *                   order, so meetings stay ahead of calls and calls ahead
 *                   of emails, and opportunities ahead of accounts.
 *
 * Returns the lines including the "BFO Address" header, so a caller with
 * nothing to log gets a one-line block it can test with `length > 1`.
 */
export function buildActivityAddressLines({
  meetings = [],
  markedMeetings = [],
  calls = [],
  emails = [],
  accountOf = null,
  limit = null,
} = {}) {
  const lines = ['BFO Address'];
  const seen = new Set();
  // Touches with no opportunity address, for the BFO Account list.
  const accountTouches = [];
  const loggedAccounts = new Set();
  const accountName = (row) => {
    // A company can carry several BFO names ("A; B"): the first is its own.
    const name = accountOf ? String(accountOf(row) || '').split(';')[0].trim() : '';
    return name === '-' ? '' : name;
  };

  const push = (row, type) => {
    const url = addressOf(row);
    if (!url) {
      accountTouches.push([row, type]);
      return;
    }
    const name = accountName(row);
    if (name) loggedAccounts.add(name.toLowerCase());
    if (seen.has(url)) return;
    lines.push(`${url}: Type ${type}`);
    seen.add(url);
  };

  // Both meeting sources rank together, above everything else. A meeting
  // is a meeting whether it came from HubSpot, from a Granola note, or
  // from the Opps tab's own button.
  for (const m of meetings) push(m, 'meeting');
  for (const m of markedMeetings) push(m, 'meeting');
  for (const c of calls) push(c, 'called');
  for (const e of emails) push(e, e.nextStepsType);

  // The same email touch on any matched Marketing Lead's Salesforce
  // record. Lead links live on their own SF records, so they never
  // collide with the opp addresses above.
  for (const e of emails) {
    const url = String(e?.leadSfUrl || '').trim();
    if (!url || seen.has(url)) continue;
    lines.push(`${url}: Type ${e.nextStepsType}`);
    seen.add(url);
  }

  // Touches with no BFO opportunity: logged on the BFO Account by name.
  const accountLines = [];
  for (const [row, type] of accountTouches) {
    if (/bounce/i.test(String(row?.status || row?.outcome || ''))) continue;
    const name = accountName(row);
    const key = name.toLowerCase();
    if (!name || loggedAccounts.has(key)) continue;
    loggedAccounts.add(key);
    accountLines.push(`${name}: Type ${type}`);
  }

  let addresses = lines.slice(1);
  let accounts = accountLines;
  if (Number.isInteger(limit) && limit >= 0) {
    addresses = addresses.slice(0, limit);
    accounts = accounts.slice(0, Math.max(0, limit - addresses.length));
  }
  return [lines[0], ...addresses, ...(accounts.length ? ['', ACCOUNT_HEADER, ...accounts] : [])];
}

// Heads the second list: touches with no BFO opportunity, logged on the
// company's BFO Account. Worded as instructions so they hold whatever the
// user has edited the prompt to say.
export const ACCOUNT_HEADER = 'BFO Account (these have no BFO opportunity: search BFO for the account name, open the Account itself, not a contact or opportunity, and log the same completed task on the Account page the same way. If more than one Account has that exact name, use the first one and say so in your report.)';

/** How many tasks a block from buildActivityAddressLines asks for. */
export function activityEntryCount(lines) {
  return (lines || []).filter(l => /: Type /.test(l)).length;
}

// The cap the Agents page's "Limit prompt activity" option applies.
export const ACTIVITY_PROMPT_LIMIT = 25;
