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
 * Returns the lines including the "BFO Address" header, so a caller with
 * nothing to log gets a one-line block it can test with `length > 1`.
 */
export function buildActivityAddressLines({
  meetings = [],
  markedMeetings = [],
  calls = [],
  emails = [],
} = {}) {
  const lines = ['BFO Address'];
  const seen = new Set();

  const push = (row, type) => {
    const url = addressOf(row);
    if (!url || seen.has(url)) return;
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

  return lines;
}
