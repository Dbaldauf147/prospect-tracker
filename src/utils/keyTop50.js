// The Key Contacts tab as Dan's top 50 by revenue potential (KeyTop50View).
// Pure, so scripts/keyTop50.test.mjs checks it.

// A target, not a limit: going over warns, nothing blocks.
export const KEY_CONTACTS_TARGET = 50;

// The Category labels the Key tab gives each row.
export const DM_LABEL = 'Decision Maker';
export const NOT_DM_LABEL = 'Not a DM';

const tagsOf = (c) => String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').toLowerCase();

// The Key tab's own gate (KeyContactsView's default selector), so the
// counter counts exactly the rows the table lists.
export function isKeyTabContact(c) {
  const tags = tagsOf(c);
  if (tags.includes('hide') || tags.includes('left')) return false;
  return tags.includes('dan key target');
}

export function isDmTagged(c) {
  return tagsOf(c).includes('decision maker');
}

// { total, notDm, over }: how many contacts are on Key, how many of them
// aren't tagged Decision Maker, and how far past the target the list is
// (0 when at or under it).
export function keyTopCounts(contacts) {
  let total = 0;
  let notDm = 0;
  for (const c of contacts || []) {
    if (!isKeyTabContact(c)) continue;
    total += 1;
    if (!isDmTagged(c)) notDm += 1;
  }
  return { total, notDm, over: Math.max(0, total - KEY_CONTACTS_TARGET) };
}
