// Impact - what a service is worth to the account, beside what it bills us.
//
// The rate card next door answers one question completely: what we charge
// for a service, on what basis, and what that comes to in year one. The
// question it has never answered is the client's own - why would they buy
// it - and the answer is usually a figure this site already works out
// somewhere else. The Utility Lookup analysis works out what shopping an
// estate saves in a year; the compliance screening works out what the same
// estate could be fined. Both land on the company card, and neither was
// ever attached to the service that goes and gets it.
//
// So a service can name ONE of those figures as its impact. The tie is per
// service and lives on that service's rate card entry (see setPricingField),
// because it is a standing fact about the service rather than about one
// deal: Energy Procurement is measured by savings wherever it is quoted,
// the same way it is charged per meter wherever it is quoted.
//
// What the column shows is the NAME of the figure, not a dollar amount. The
// rate card is one card for every account, and a dollar amount would have
// to belong to some particular company - the one thing this card does not
// have. The amount is read where the company is: the box named here sits on
// that company's own card, and says a different number for each of them.
//
// Adding a source is this list and nothing else:
//   key    what gets stored on the rate card entry. Never reused or
//          renamed - a stored key is a tie somebody made.
//   label  what the column, the picker and the export say.
//   field  where the figure lives on the company record. The machine half
//          of the tie: it is what a reader resolves the amount through.
//   where  where a person would go and look at it, in words.
//   blurb  what the figure actually counts, for the tooltip.
export const IMPACT_SOURCES = [
  {
    key: 'indicativeAnnualSavings',
    label: 'Indicative Annual Savings',
    field: 'indicativeAnnualSavings',
    unit: 'money',
    where: 'the Scale page of the company card',
    blurb: 'Total indicative annual savings, electric and natural gas combined, off the Master Analysis saved against the company.',
  },
  {
    key: 'maxYearlyExposure',
    label: 'Est. Max Yearly Exposure',
    field: 'maxYearlyExposure',
    unit: 'money',
    where: 'the Scale page of the company card',
    blurb: 'What this company’s sites could be fined in a year if every building mandate they owe went unmet.',
  },
];

const BY_KEY = new Map(IMPACT_SOURCES.map(s => [s.key, s]));

/** One source by key, or null when nothing on the list answers to it. */
export function impactSourceFor(key) {
  return BY_KEY.get(String(key ?? '').trim()) || null;
}

/**
 * A stored tie, cleaned up: a key the list still carries, or '' for "not
 * tied to anything".
 *
 * Same rule as an unknown pricing basis, for the same reason: a key left
 * behind by a source since retired is dropped on the way out of storage
 * rather than shown as a tie to a figure nothing produces any more.
 */
export function impactKey(raw) {
  const source = impactSourceFor(raw);
  return source ? source.key : '';
}

/** What the column shows, or '' when the service names no figure. */
export function impactLabel(key) {
  return impactSourceFor(key)?.label || '';
}

/**
 * The tooltip on one Impact cell.
 *
 * Both halves matter and neither is obvious from a label in a dropdown:
 * what the figure counts, and that the figure itself is one company's
 * rather than the card's. A reader who takes this column for money is
 * reading the rate card as though it knew whose deal it was.
 */
export function impactTitle(key) {
  const source = impactSourceFor(key);
  if (!source) {
    return 'What this service is worth to the client, named rather than typed: pick a figure the site '
      + 'already works out and this service is measured by it wherever it is quoted. Leave it blank '
      + 'and the service simply has no impact figure against it yet.';
  }
  return `${source.label}. ${source.blurb} The amount is the company’s, not the card’s: `
    + `it is read off ${source.where}, so it says a different number for every account this service is quoted to.`;
}
