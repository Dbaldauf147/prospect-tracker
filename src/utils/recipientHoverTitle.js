// The hover text on a Draft Emails recipient chip: who the person is.
//
// The chip shows a name and an address, which is enough to send to somebody
// and not enough to remember why they are on the list. Hovering adds the
// title, and the company when there is one:
//
//   James Colon
//   Managing Director, Real Estate
//   Nuveen
//
// One line each, because a title often has a comma of its own.
//
// A recipient with no title on file says so rather than showing the name
// alone, so a blank reads as "we don't have it", not as a tooltip that
// failed. Pure (scripts/recipientHoverTitle.test.mjs).
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function recipientHoverTitle({ name, title, company, email } = {}) {
  const who = clean(name) || clean(email);
  if (!who) return '';
  return [who, clean(title) || 'No title on file', clean(company)].filter(Boolean).join('\n');
}
