// Tests you sent yourself, told apart from mail you sent a prospect.
//
// The composer keeps the user's own address in the To line on purpose —
// DraftEmailView's SELF_RECIPIENT exists so a freshly-cleared compose is ready
// to send a test to self — and those test sends carry tracking exactly like a
// real one. So every time the sender checks their own copy and follows their
// own link to see that it works, the dashboard records a click from an
// engaged recipient. It is their own click, on their own email.
//
// One address is the whole test. A tracking doc stores the address it was
// written for (`to`) and the address of the user it was written by
// (`ownerEmail`, set by api/track-prepare from the caller's token), so a send
// where those two match is by definition mail to yourself. No heuristics, no
// configuration, and it keeps working if a second user ever uses the tool.
//
// These rows are kept and labelled rather than hidden: a test send is the
// fastest way to check that tracking is working at all, and a dashboard that
// silently swallowed them would make a broken pixel look identical to a quiet
// week. They are excluded from the RATES, where they would otherwise be
// counting the sender's own behaviour as a prospect's.

/** Normalize an address for comparison — matches normalizeTrackedEmail. */
function normalize(value) {
  const raw = String(value || '').trim().toLowerCase();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim();
}

/**
 * Did this tracked send go to the person who sent it?
 *
 * @param row         an emailTracking doc ({ to, ownerEmail })
 * @param ownerEmail  the signed-in user's address, used when the doc predates
 *                    ownerEmail being stored. The doc's own value wins when it
 *                    has one, so a row always answers for the user who made it.
 */
export function isSelfSend(row, ownerEmail) {
  const to = normalize(row?.to);
  if (!to) return false;
  const owner = normalize(row?.ownerEmail || ownerEmail);
  return Boolean(owner) && to === owner;
}
