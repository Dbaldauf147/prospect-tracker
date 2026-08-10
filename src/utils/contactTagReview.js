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
export const TAG_OPTIONS = [
  'ESG', 'Procurement', 'Private Equity', 'Real Estate', 'Capital Planning',
  'Efficiency / Renewables', 'Dan Key Target', 'Decision Maker',
  'Primary Point of Contact', 'Test', 'EU', 'Hide', 'Left',
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
 * `review` is that contact's local answer map ({ tag: 'no' | 'unsure' }).
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
      .filter(([, v]) => v === 'no' || v === 'unsure')
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
