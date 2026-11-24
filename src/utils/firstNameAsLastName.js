// Does a contact's Last Name hold a typical first name? Pure, no React.
//
// A list of contacts picks up names the wrong way round all the time: a
// spreadsheet with its columns swapped, a "Chen, Sarah" directory export
// read as first then last, a form filled in backwards. Nothing breaks, the
// record just says "Chen Sarah" and every email to it opens "Hi Chen".
// The contact popup warns when the Last Name box holds a name people are
// given rather than born with, and offers to swap the two.
//
// The list is the hard part. Plenty of first names are also ordinary
// surnames (James, Thomas, Martin, George, Scott, Lee, Allen, Kelly,
// Jordan, Taylor, Morgan ...), and a warning that fires on every Chris
// Martin is one people learn to ignore. So this holds only names that are
// overwhelmingly given names, and leaves the two-way ones out. It errs
// toward silence: a real "Sarah" surname is rare, a real "Thomas" is not.
// It is a warning, never a block, because the rare ones exist (Elton John).

const TYPICAL_FIRST_NAMES = new Set(`
aaron abigail adam alex alexis alice alicia allison amanda amber amy andrea
andrew andy angela ann anna anne anthony ashlee barbara becky ben benjamin
beth betty bill billy bob bobby brad brandon brenda brian brittany bryan
carol caroline carolyn catherine cathy chad charlotte cheryl chloe chris
christina christine christopher cindy claire connor crystal cynthia dan
daniel danielle danny dave david deborah debra denise derek diana diane
don donald donna doris dorothy doug ed edward eileen elaine elizabeth ella
ellen emily emma eric erica erik erin ethan evelyn gary greg gregory hannah
heather heidi helen holly isaac isabella issac jacob jacqueline jake jane janet janice
jason jeff jeffrey jen jennifer jenny jeremy jessica jill jim jimmy joan
joanne joe joel john johnny jon jonathan josh joshua joyce judith judy julia
julie justin karen kate katherine kathleen kathryn kathy katie kayla ken
kenneth kevin kimberly kristen kristin larry laura lauren liam linda lisa
liz lori lucy luke margaret maria marie marilyn mark martha mary matt
matthew megan melanie melissa michael michele michelle mike molly monica
nancy natalie nathan nicholas nick nicole noah olivia pamela patricia paula
peggy peter phil philip phillip rachel rebecca rhonda rich richard rick rob robert
ron ronald ruth sam samantha samuel sandra sara sarah sean shawn sharon
sheila sophia sophie stephanie stephen steve steven sue susan suzanne tammy
tara teresa theresa tiffany tim timothy tina tom tommy tony valerie vanessa
veronica vicki victoria wendy will william zachary zoe
`.trim().split(/\s+/));

// A name as the list holds it: lower case, letters only, accents dropped.
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** True when `name` (the whole of it) is a typical first name. */
export function isTypicalFirstName(name) {
  const key = fold(name);
  return key.length > 0 && TYPICAL_FIRST_NAMES.has(key);
}

/**
 * The warning for a contact's two name boxes, or null when there is none.
 *
 *   { lastname, firstname, firstAlsoGiven, canSwap }
 *
 * `firstAlsoGiven` is true when the First Name is a typical first name too
 * ("Sarah Michael"): that reads as a name entered twice or a middle name in
 * the wrong box rather than a swap, so the popup words it differently.
 * `canSwap` is whether there is a first name to put in its place.
 */
export function firstNameAsLastNameWarning(firstname, lastname) {
  const last = String(lastname ?? '').trim();
  if (!isTypicalFirstName(last)) return null;
  const first = String(firstname ?? '').trim();
  return { lastname: last, firstname: first, firstAlsoGiven: isTypicalFirstName(first), canSwap: first.length > 0 };
}

/**
 * The same warning for a contact as a list holds it: the HubSpot record's
 * own First and Last Name when it has them, else the two ends of a whole
 * `name` ("Krisch Michael" reads first "Krisch", last "Michael").
 */
export function contactNameWarning(contact) {
  const c = contact || {};
  const first = String(c.firstname ?? '').trim();
  const last = String(c.lastname ?? '').trim();
  if (first || last) return firstNameAsLastNameWarning(first, last);
  const words = String(c.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return firstNameAsLastNameWarning(words[0], words[words.length - 1]);
}
