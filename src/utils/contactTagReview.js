// How thoroughly a contact's tags have been worked through.
//
// The contact popup answers each tag Yes / No / Not sure. Yes is the tag
// itself and lives in HubSpot; No and Not sure are local, because an absent
// HubSpot tag can't tell "doesn't apply" from "haven't looked" from "don't
// know". The score is simply how many of the tags have any of those three
// answers.
//
// Shared between the popup that collects the answers and the contacts table
// that reports the figure, so the two can't quietly disagree about what a
// contact's Tagged % is.

// The tag vocabulary. Lives here rather than in the popup so a page that
// only wants the score doesn't have to import the popup to get it.
//
// NAM Only sits next to EU: both say what a contact's remit covers, and
// they're the two the rest of the app's regions collapse to. It's a scored
// tag like EU, so answering it is part of working a contact out — which does
// mean every Tagged % is now out of one more question than before.
//
// A value HubSpot's dans_tags enumeration doesn't have yet isn't a problem:
// the first contact saved with it gets a 400, and api/hubspot.js registers
// the option on the property and retries (see ensureDansTagsOptions).
export const TAG_OPTIONS = [
  'ESG', 'Procurement', 'Private Equity', 'Real Estate', 'Capital Planning',
  'Efficiency / Renewables', 'Dan Key Target', 'Decision Maker',
  'Primary Point of Contact', 'Test', 'NAM Only', 'EU', 'Hide', 'Left',
];

// Tags left out of the score. Hide and Left decide whether a contact appears
// at all and Test is a scratch value — none of them says anything about who
// the person is, so counting them would cap the figure for reasons unrelated
// to how well the contact is understood. They stay answerable; they just
// don't count.
export const TAG_SCORE_EXCLUDED = new Set(['hide', 'left', 'test']);

// "Met In Person" is a local checkbox rather than a tag, and HubSpot rejects
// it as a dans_tags value, so it never appears in the table or the score.
export const MET_IN_PERSON_TAG = 'Met In Person';

// The answers that live locally, because HubSpot can only say "tagged" or
// "not tagged".
//
// Three of them are reasons the tag is OFF:
//
//   no       doesn't apply to this person
//   unsure   haven't worked it out yet
//   notsold  applies to them, but their company hasn't bought it yet
//
// and one is a fact recorded ON TOP of the tag:
//
//   sold     applies to them, and their company has bought it
//
// Sold and Not sold are one question — has this account bought what this
// person owns? — asked of anyone the tag is true of. Not sold is the
// hold-off: a No would be wrong, because the person really does own that
// area, but until the account buys it they shouldn't turn up in a general
// pull of everyone who owns it, and keeping the HubSpot tag off is what
// makes that hold. Sold is the other end, and keeps the tag on, because
// someone at a sold account is exactly who a general pull should return.
// Either way the answer recorded here remembers that the area is theirs.
export const TAG_OFF_VERDICTS = new Set(['no', 'unsure', 'notsold']);
export const TAG_ON_VERDICTS = new Set(['sold']);
export const LOCAL_TAG_VERDICTS = new Set([...TAG_OFF_VERDICTS, ...TAG_ON_VERDICTS]);

export function isLocalTagVerdict(v) {
  return LOCAL_TAG_VERDICTS.has(v);
}

// Does this answer leave the HubSpot tag on the contact? Only Sold does —
// every other recorded answer means the tag comes off.
export function verdictKeepsTag(v) {
  return TAG_ON_VERDICTS.has(v);
}

// The answer to show for a tag, given whether the contact carries it and
// what's recorded locally. Shared by the popup's table and the All Contacts
// status filter so the two can't disagree about what a contact "is" for a
// tag.
//
// The tag itself is the source of truth for whether it applies, so a
// recorded Sold is only honoured while the tag is actually on — a tag pulled
// off in HubSpot or by a bulk edit can't leave a stale Sold behind — and the
// tag-off answers are only honoured while it's actually off.
export function tagAnswerFrom(tagged, verdict) {
  if (tagged) return verdict === 'sold' ? 'sold' : 'yes';
  return TAG_OFF_VERDICTS.has(verdict) ? verdict : '';
}

export function contactTagList(contact) {
  return String(contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

// The tags a score is taken over: the vocabulary minus Met In Person and the
// housekeeping tags.
export function scoredTagOptions(tagOptions = TAG_OPTIONS) {
  const metLower = MET_IN_PERSON_TAG.toLowerCase();
  return tagOptions.filter(t => {
    const k = String(t).toLowerCase();
    return k !== metLower && !TAG_SCORE_EXCLUDED.has(k);
  });
}

/**
 * { answered, total, pct, done } for one contact.
 *
 * `review` is that contact's local answer map ({ tag: LOCAL_TAG_VERDICTS }).
 * A "yes" is never read from there — it's read off the contact's own tags,
 * so a tag changed in a bulk edit or in HubSpot itself can't leave a stale
 * yes behind. `total` of 0 yields 0%, not a division by zero.
 */
export function tagReviewScore(contact, review, tagOptions = TAG_OPTIONS) {
  const scored = scoredTagOptions(tagOptions);
  const tagged = new Set(contactTagList(contact).map(t => t.toLowerCase()));
  const marks = (review && typeof review === 'object') ? review : {};
  const markedLower = new Set(
    Object.entries(marks)
      .filter(([, v]) => isLocalTagVerdict(v))
      .map(([k]) => String(k).toLowerCase()),
  );
  let answered = 0;
  for (const tag of scored) {
    const k = tag.toLowerCase();
    if (tagged.has(k) || markedLower.has(k)) answered += 1;
  }
  const total = scored.length;
  return {
    answered,
    total,
    pct: total > 0 ? Math.round((answered / total) * 100) : 0,
    done: total > 0 && answered === total,
  };
}
