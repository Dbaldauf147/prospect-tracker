// Who is on a campaign's contact list, and where each of them came from.
//
// A campaign's roster used to be a fixed list: every row was one the user
// typed into "Add an email to this campaign…", and a recipient HubSpot
// reported under the campaign's subject line who wasn't already on it was
// deliberately left off. That meant the tracker could only ever show the
// people somebody had remembered to add, and a send that went out to
// twenty people showed up as the three of them that had been typed in.
//
// So the roster now ADOPTS them. Anybody HubSpot says was sent one of the
// campaign's subject lines is on the campaign, whether or not they were
// added by hand. The manual add stays for the other direction - putting
// somebody on the list BEFORE the mail goes out, which is what a campaign
// built ahead of the send is made of - and those rows still sit there as
// "Not Sent" until a send matches them.
//
// Two rules keep that from running away with the list:
//
//   Removals stick.  Taking a row off the campaign tombstones its
//                    addresses (removedEmails), and a tombstoned address is
//                    never adopted back. That is the only way to say "not
//                    this one" about somebody who really was sent it, so it
//                    has to outrank the adoption.
//   Edits stick.     A row already on the roster keeps its own fields - the
//                    event RSVP, the hold, the note, the company somebody
//                    recorded. The fetched activity only ever refreshes what
//                    HubSpot is the source of: the send, the reply, the
//                    bounce, the out-of-office.
//
// Everything here is pure: rosters and activity in, roster out
// (scripts/campaignRoster.test.mjs).

export const normEmail = (e) => String(e || '').toLowerCase().trim();

/**
 * Every address a row stands for.
 *
 * Usually one. A row can carry several ("a@x.com; b@y.com") when it came
 * from a single send that went to a group, which is how the campaign table
 * has always rendered a grouped send.
 */
export function rowAddresses(c) {
  return String(c?.email || '').split(';').map(normEmail).filter(Boolean);
}

// What HubSpot is the source of truth for, lifted off a matching send. The
// roster row owns everything else, so this is deliberately the whole list of
// fields a refresh is allowed to overwrite.
//
// Every value is coalesced to null rather than left undefined: these land
// in a saved campaign, and Firestore refuses an undefined field outright -
// one send missing a key would fail the whole write.
function activityFields(act) {
  return {
    sentDate: act.sentDate ?? null,
    // How many sends this address has had under the campaign's subject
    // lines, and the last few of them, so the Follow-up column survives a
    // refresh the same way the reply detail does.
    sendCount: act.sendCount ?? null,
    firstSentDate: act.firstSentDate || act.sentDate || null,
    sendHistory: Array.isArray(act.sendHistory) ? act.sendHistory : [],
    replied: !!act.replied,
    replyDate: act.replyDate ?? null,
    repliedBy: act.repliedBy ?? null,
    // Delivery outcome, classified out of the incoming mail the campaign was
    // already suppressing (api/_lib/autoReply.js). A bounce is an address to
    // fix; an out-of-office is a date to try again on.
    bounced: !!act.bounced,
    bounceDate: act.bounceDate || null,
    outOfOffice: !!act.outOfOffice,
    oooDate: act.oooDate || null,
    oooSubject: act.oooSubject || '',
    recipientCount: act.recipientCount || 1,
  };
}

/**
 * A roster row for somebody the search found who wasn't on the list.
 *
 * One row per ADDRESS rather than one per send, because every column beside
 * the address is about a person: the RSVP, the hold, the note. A send that
 * went to three people becomes three rows, each of which can be held or
 * marked Going on its own.
 *
 * The name is taken only from a send with a single recipient. HubSpot
 * reports one name per send - the To contact's - so on a group send it
 * belongs to one of the addresses and would be a lie on the rest. Nothing
 * reads a blank name that a lie wouldn't have broken: the table shows the
 * address, and the company is looked up from it.
 */
export function adoptedRow(address, act) {
  const single = (act.recipientCount || 1) === 1;
  return {
    email: address,
    name: single ? String(act.name || '').trim() : '',
    // Left blank on purpose, unlike a manual add: nobody typed a company for
    // this row, so the table's own lookup (HubSpot, then the email domain)
    // answers it and keeps answering it as the contact record improves.
    company: '',
    ...activityFields(act),
    // Nothing has been recorded against them yet - they have only just
    // arrived.
    eventStatus: '', outreach: '', holdUntil: '', notes: '',
    // Where the row came from, so the table can say so. A row nobody added
    // showing up under a campaign is worth a word of explanation.
    autoAdded: true,
  };
}

/**
 * Layer freshly-fetched activity onto a campaign's roster, and adopt the
 * recipients that aren't on it yet.
 *
 * `savedContacts` is the campaign's roster, `fetchedContacts` is what the
 * search for its subject lines returned, `removedEmails` are the addresses
 * taken off the campaign by hand.
 *
 * Roster order is kept and adoptions are appended in the order the search
 * returned them, so a refresh never reshuffles the list somebody is reading
 * - the new arrivals land at the bottom.
 */
export function mergeCampaignContacts(savedContacts, fetchedContacts, removedEmails) {
  const removed = new Set((removedEmails || []).map(normEmail).filter(Boolean));

  // Index fetched activity by each individual recipient address. First wins:
  // the search returns replies first, so an address in two sends keeps the
  // one that got an answer.
  const activityByEmail = new Map();
  for (const fc of (fetchedContacts || [])) {
    for (const e of rowAddresses(fc)) {
      if (!activityByEmail.has(e)) activityByEmail.set(e, fc);
    }
  }

  const merged = [];
  // Every address the roster already stands for, so a send to somebody who
  // is on the list twice over - their own row plus a group send that
  // included them - is not adopted a second time.
  const claimed = new Set();
  for (const rc of (savedContacts || [])) {
    const addresses = rowAddresses(rc);
    // Manually removed, and it stays that way.
    if (addresses.some(e => removed.has(e))) continue;
    for (const e of addresses) claimed.add(e);
    // A row can carry several addresses; the first one with a send behind it
    // is the row's activity.
    const act = addresses.map(e => activityByEmail.get(e)).find(Boolean);
    // No matching send → the row stays on the list as "Not Sent". That is
    // the case a manual add ahead of the send is for.
    merged.push(act ? { ...rc, ...activityFields(act) } : { ...rc });
  }

  for (const fc of (fetchedContacts || [])) {
    for (const e of rowAddresses(fc)) {
      if (removed.has(e) || claimed.has(e)) continue;
      claimed.add(e);
      merged.push(adoptedRow(e, fc));
    }
  }

  return merged;
}

/**
 * How many of a roster arrived on their own.
 *
 * The roster line says so once rather than the user counting chips: "3
 * pulled in" is the difference between a list somebody curated and a list
 * that is mostly the send log.
 */
export function adoptedCount(contacts) {
  return (contacts || []).filter(c => c?.autoAdded).length;
}
