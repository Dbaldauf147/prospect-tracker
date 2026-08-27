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

// Case- and spacing-insensitive identity for a tag. HubSpot validates a
// dans_tags value against the exact option string, but "Efficiency /
// Renewables" and "Efficiency/Renewables" — or "NAM Only" and "Nam only" —
// are one tag to anyone using the app, and this dataset carries both
// spellings of several of them.
//
// The server already reconciles writes this way (api/hubspot.js dansTagKey)
// and the bulk tag picker collapses its options this way, so every
// comparison on the client has to agree: a check that only lowercases reads
// a contact tagged under the other spelling as untagged, which then adds a
// duplicate or silently fails to remove anything.
export function tagKey(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, '');
}

// Does this tag list already carry `tag`, whatever spelling it's in?
export function tagListHas(list, tag) {
  const k = tagKey(tag);
  return (list || []).some(t => tagKey(t) === k);
}

// A contact's saved records are keyed by the tag as whoever wrote them
// spelled it: the popup writes the vocabulary's spelling, the bulk editor
// writes HubSpot's. Those differ — "Efficiency / Renewables" against
// "Efficiency/Renewables" — so a lookup that doesn't collapse the spelling
// reads an answered tag as unanswered, which is how a bulk Mark Yes lands
// and then shows up as a blank row in the popup.
//
// findTagRecord reads through either spelling; tagRecordKeyFor says which key
// a write should land on, so an edit updates the record that's already there
// instead of leaving a twin under the other spelling.
export function findTagRecord(map, tag) {
  if (!map || typeof map !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(map, tag)) return map[tag];
  const k = tagKey(tag);
  for (const key of Object.keys(map)) {
    if (tagKey(key) === k) return map[key];
  }
  return undefined;
}

export function tagRecordKeyFor(map, tag) {
  if (!map || typeof map !== 'object') return tag;
  if (Object.prototype.hasOwnProperty.call(map, tag)) return tag;
  const k = tagKey(tag);
  for (const key of Object.keys(map)) {
    if (tagKey(key) === k) return key;
  }
  return tag;
}

// One list of tags with the duplicates collapsed — two spellings of the same
// tag keep the first one given.
export function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of (list || [])) {
    const t = String(raw || '').trim();
    const k = tagKey(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// The tag list a picker offers: the vocabulary, plus whatever spellings the
// contacts themselves carry, with one tag showing once.
//
// The tags in this dataset are spelled several ways — "NAM only" beside
// "NAM Only", "Efficiency/Renewables" beside "Efficiency / Renewables" — so a
// list built by dropping raw values into a Set showed each spelling as its
// own entry. In the contact popup's tag table that meant two rows for the one
// tag: answering either left the other sitting blank, and both counted
// against the Tagged % — the same tag asked twice.
//
// Collapsed on tagKey, with the vocabulary's spelling winning, so the row is
// labelled (and written back to HubSpot) the way TAG_OPTIONS spells it while
// still offering tags only the contacts know about.
export function tagVocabulary(extra = [], tagOptions = TAG_OPTIONS) {
  const seen = new Map();
  for (const t of tagOptions) {
    const name = String(t || '').trim();
    if (name) seen.set(tagKey(name), name);
  }
  for (const raw of extra) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const k = tagKey(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// What one contact's dans_tags string becomes under a bulk tag edit.
//
// `current` is the tag string HubSpot holds for that contact right now, or
// undefined when there's no contact to read. That distinction is the point:
// dans_tags is a single string, so every write is a whole-list overwrite,
// and treating an unreadable contact as "has no tags" turns a bulk ADD into
// a bulk REPLACE that clears everything else they had. Replace is the one
// mode that doesn't need the current list, so it alone still runs.
//
// Returns one of:
//   { action: 'write', tags }  — the string to send to HubSpot
//   { action: 'unchanged' }    — HubSpot already holds exactly this
//   { action: 'skip' }         — nothing to build a list from
//
// Pure and exported so the modes can be tested without a HubSpot round trip.
export function planTagEdit(mode, chosenTags, current) {
  const chosen = dedupeTags(chosenTags);
  if (current === undefined && mode !== 'replace') return { action: 'skip' };
  const existing = String(current || '').split(';').map(t => t.trim()).filter(Boolean);
  let next;
  if (mode === 'replace') {
    next = chosen;
  } else if (mode === 'remove') {
    const drop = new Set(chosen.map(tagKey));
    next = existing.filter(t => !drop.has(tagKey(t)));
  } else {
    // A tag the contact already carries under a different spelling is a tag
    // they already carry — adding the picker's spelling on top would leave
    // them holding both.
    const have = new Set(existing.map(tagKey));
    next = [...existing, ...chosen.filter(t => !have.has(tagKey(t)))];
  }
  // ';' with no space is the separator the tag pickers write; some HubSpot
  // enum properties reject leading whitespace on a value.
  const tags = next.join(';');
  if (tags === existing.join(';')) return { action: 'unchanged' };
  return { action: 'write', tags };
}

// The tag writes a bulk "Mark …" implies, as few calls as they'll fit in.
//
// `wanted` says, per contact, which of the chosen tags they should end up
// carrying (`on`) and which they shouldn't (`off`) — read off the record the
// mark leaves behind, not off one direction chosen for the whole batch. Yes
// is why: it puts the tag on for everyone except a contact already held off
// by a Not sold, who records the Yes and keeps the tag off.
//
// Contacts asking for the same change go out together, so the ordinary case —
// every contact wanting the same thing — is still a single write. A group
// asking for no tags at all is dropped rather than sent as an empty one.
export function groupTagWrites(ids, wanted) {
  const runs = new Map();
  for (const id of (ids || [])) {
    const want = wanted?.get(String(id)) || { on: [], off: [] };
    for (const [mode, list] of [['add', want.on], ['remove', want.off]]) {
      if (!list || list.length === 0) continue;
      const key = `${mode}:${list.join(';')}`;
      if (!runs.has(key)) runs.set(key, { mode, tags: list, ids: [] });
      runs.get(key).ids.push(id);
    }
  }
  return [...runs.values()];
}

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

// Where one contact's tag records get saved.
//
// Path-based when the caller has updateSettingsPath. contactTagReview holds
// a record for every contact anyone has ever answered a tag for, and the
// popup saves on every single click — rewriting the whole map each time sent
// all of it to Firestore per click, which is what made a run down the tag
// table crawl and left later clicks queued behind earlier ones. A path write
// sends just this contact's records, and can't stomp another contact's
// records written on another device in the meantime.
//
// The whole-map write stays as the fallback for callers that don't have the
// path API threaded down to them. An empty map removes the contact's entry
// rather than storing `{}`.
export function saveTagReview({ cid, map, settings, updateSettings, updateSettingsPath }) {
  if (cid == null) return;
  const empty = !map || Object.keys(map).length === 0;
  if (updateSettingsPath) {
    updateSettingsPath({ [`contactTagReview.${cid}`]: empty ? null : map });
    return;
  }
  if (!updateSettings) return;
  const next = { ...(settings?.contactTagReview || {}) };
  if (empty) delete next[cid]; else next[cid] = map;
  updateSettings({ contactTagReview: next });
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
 * A tag counts as answered when its RESOLVED state — what the popup's row
 * for that tag actually shows — holds an answer or a status. Resolving
 * through tagStateFrom rather than reading the stored record directly is
 * what keeps this figure equal to the one in the popup header: the tag is
 * where a Yes lives, so a stored "yes" (or a Sold, which also only exists
 * while the tag is on) counts for nothing once the tag is off, whether it
 * came off in a bulk edit or in HubSpot itself. `total` of 0 yields 0%,
 * not a division by zero.
 *
 * Records are matched to tags case-insensitively, so one saved under a
 * different casing than the vocabulary spells it still finds its tag.
 */
export function tagReviewScore(contact, review, tagOptions = TAG_OPTIONS) {
  const scored = scoredTagOptions(tagOptions);
  const tagged = new Set(contactTagList(contact).map(tagKey));
  const marks = (review && typeof review === 'object') ? review : {};
  const recordByTag = new Map();
  for (const [k, v] of Object.entries(marks)) {
    const key = tagKey(k);
    if (!recordByTag.has(key)) recordByTag.set(key, v);
  }
  let answered = 0;
  for (const tag of scored) {
    const k = tagKey(tag);
    const { answer, status } = tagStateFrom(tagged.has(k), recordByTag.get(k));
    if (answer || status) answered += 1;
  }
  const total = scored.length;
  return {
    answered,
    total,
    pct: total > 0 ? Math.round((answered / total) * 100) : 0,
    done: total > 0 && answered === total,
  };
}
