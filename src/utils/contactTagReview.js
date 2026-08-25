// What a contact's tags say, and how thoroughly they've been worked through.
//
// Each tag carries two answers, not one:
//
//   answer   does this area belong to this person?   Yes / No / Not sure
//   status   has their company bought it?            Sold / Not sold
//
// They're independent, so a contact can be Yes AND Not sold — the area is
// theirs, their account just hasn't bought it yet — which a single answer
// couldn't say. Yes is the HubSpot tag itself; everything else is local,
// because an absent tag can't tell "doesn't apply" from "haven't looked"
// from "don't know" from "holding off".
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

// The two axes an answer is recorded on. `answer` says whether the area is
// this person's; `status` says whether their company has bought it. Either
// can stand alone: a Not sold with no answer is still a useful "hold off on
// this one", and a plain Yes is a tag with the sale question unasked.
export const TAG_ANSWERS = ['yes', 'no', 'unsure'];
export const TAG_SALE_STATUSES = ['sold', 'notsold'];

// One tag's stored record, normalized to { answer, status }.
//
// Records used to be a single string — 'no' | 'unsure' | 'sold' | 'notsold'
// — with Yes read off the tag itself. Those are still read: the two sale
// values become a status, the other two an answer. Anything unrecognised
// reads as unanswered rather than throwing a stored typo onto the screen.
export function tagRecordFrom(stored) {
  if (typeof stored === 'string') {
    if (TAG_SALE_STATUSES.includes(stored)) return { answer: '', status: stored };
    return { answer: TAG_ANSWERS.includes(stored) && stored !== 'yes' ? stored : '', status: '' };
  }
  if (stored && typeof stored === 'object') {
    return {
      answer: TAG_ANSWERS.includes(stored.answer) ? stored.answer : '',
      status: TAG_SALE_STATUSES.includes(stored.status) ? stored.status : '',
    };
  }
  return { answer: '', status: '' };
}

export function sameTagRecord(a, b) {
  const x = tagRecordFrom(a);
  const y = tagRecordFrom(b);
  return x.answer === y.answer && x.status === y.status;
}

// Does anything live in this record? A bare Yes doesn't count: the tag is
// where a Yes lives, so a stored one is only ever a copy — the callers that
// ask this are looking for the answers HubSpot can't hold.
export function isLocalTagVerdict(v) {
  const { answer, status } = tagRecordFrom(v);
  return !!status || (!!answer && answer !== 'yes');
}

// Does this record leave the HubSpot tag on the contact?
//
// Yes puts it on, and so does Sold — someone at an account that has bought
// the area is exactly who a general pull of the tag should return. Not sold
// overrides both: it's the hold-off, and keeping the tag off is the whole
// mechanism. Until the account buys, they shouldn't come back in a plain
// pull, however true the area is of them.
export function recordKeepsTag(record) {
  const { answer, status } = tagRecordFrom(record);
  if (status === 'notsold') return false;
  return answer === 'yes' || status === 'sold';
}

// What to show for a tag, given whether the contact carries it and what's
// recorded locally. The HubSpot tag stays the source of truth for whether
// the tag is ON, so a tag pulled off in HubSpot or by a bulk edit can't
// leave a stale Yes or Sold behind here.
//
// The one place a Yes outlives the tag being off is a Not sold, because
// that's exactly what a hold-off means: the area is theirs, the tag is off
// on purpose.
export function tagStateFrom(tagged, stored) {
  const { answer, status } = tagRecordFrom(stored);
  if (tagged) return { answer: 'yes', status: status === 'sold' ? 'sold' : '' };
  if (status === 'notsold') return { answer, status: 'notsold' };
  return { answer: answer === 'yes' ? '' : answer, status: '' };
}

// The single answer a tag reads as, for the places that show one pill rather
// than two controls (the All Contacts status filter, its counts). The sale
// status wins when there is one: "Sold" and "Not sold" already say the area
// is theirs, so they're the more specific reading of the same row.
export function tagAnswerFrom(tagged, stored) {
  const { answer, status } = tagStateFrom(tagged, stored);
  return status || answer || '';
}

// Setting one half of a record leaves the other half alone — that's the
// point of two axes — except where the two would contradict each other. No
// and Not sure say the area isn't theirs (or isn't known to be), which
// leaves nothing for a sale status to be about, so they clear it; a sale
// status likewise clears a No or Not sure, while a Yes stands beside it.
//
// Used by the popup's two setters and by the bulk "Mark …" actions, so a
// mark applied to 26 contacts lands exactly as it would one at a time.
export function withTagAnswer(stored, answer) {
  const cur = tagRecordFrom(stored);
  const next = TAG_ANSWERS.includes(answer) ? answer : '';
  return { answer: next, status: (next === 'no' || next === 'unsure') ? '' : cur.status };
}

export function withTagStatus(stored, status) {
  const cur = tagRecordFrom(stored);
  const next = TAG_SALE_STATUSES.includes(status) ? status : '';
  return { answer: (next && cur.answer !== 'yes') ? '' : cur.answer, status: next };
}

// The record a bulk "Mark …" writes on top of whatever is already there.
export function recordForVerdict(stored, verdict) {
  if (TAG_SALE_STATUSES.includes(verdict)) return withTagStatus(stored, verdict);
  return withTagAnswer(stored, verdict);
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
 * `review` is that contact's local record map ({ tag: { answer, status } }).
 * A tag counts as answered when the contact carries it (that's the Yes) or
 * the record holds anything HubSpot can't — an answer of No / Not sure, or
 * a Sold / Not sold status. A bare stored "yes" doesn't count on its own:
 * the tag is where a Yes lives, so a tag dropped in a bulk edit or in
 * HubSpot itself can't leave a stale one behind. `total` of 0 yields 0%,
 * not a division by zero.
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
