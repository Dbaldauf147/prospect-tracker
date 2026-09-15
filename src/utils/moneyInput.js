// The two halves of a money box: what it shows, and what it stores.
//
// A number input holds digits only, so a six or seven figure field on a
// form reads back as "1696113" - which is the figure and is not a number
// anybody checks at a glance. The fix used to be printing it again
// underneath in grey, which put the same figure on the row twice and made
// the readable one the one nobody could type into.
//
// So the box formats ITSELF while nobody is in it and drops back to the
// bare digits the moment it is focused. That needs exactly these two
// functions, and they live here rather than inside the input because they
// are string arithmetic with edges - a pasted "$1,696,113", an emptied
// box, a typo - and string arithmetic with edges is the half worth testing.
// Same reasoning as bulletText.js next door.

/**
 * What the box shows when it is not being typed into: "$1,696,113".
 *
 * Whole dollars. These are six and seven figure numbers and the cents on a
 * savings headline are noise standing where a digit somebody reads would
 * be. Returns '' for anything that isn't a number, so an empty box stays an
 * empty box rather than growing a "$NaN".
 */
export function asMoney(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * What the box stores: the bare number, as a string.
 *
 * Everything that is not part of a number comes off, so a figure pasted in
 * with its dollar sign and its commas still lands as a number - and so does
 * one typed plainly, which is the ordinary case and has to stay ordinary.
 *
 * An empty box returns '', NOT '0'. The difference is the whole point of
 * the field: nobody has worked this figure out yet, versus somebody worked
 * it out and it came to nothing.
 */
export function fromMoney(text) {
  const bare = String(text ?? '').replace(/[^0-9.-]/g, '');
  if (!bare) return '';
  const n = Number(bare);
  return Number.isFinite(n) ? String(n) : '';
}
