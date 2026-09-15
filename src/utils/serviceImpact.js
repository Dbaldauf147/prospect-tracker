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
//   short  one word for it, beside the amount on a page that has a company
//          and so can show the amount. "$1,284,000" alone does not say
//          whether it is money saved or money at risk, and two services on
//          one account can name different figures.
//   field  where the figure lives on the company record. The machine half
//          of the tie: it is what a reader resolves the amount through.
//   where  where a person would go and look at it, in words.
//   blurb  what the figure actually counts, for the tooltip.
export const IMPACT_SOURCES = [
  {
    key: 'indicativeAnnualSavings',
    label: 'Indicative Annual Savings',
    short: 'saved',
    field: 'indicativeAnnualSavings',
    unit: 'money',
    where: 'the Scale page of the company card',
    blurb: 'Total indicative annual savings, electric and natural gas combined, off the Master Analysis saved against the company.',
  },
  {
    key: 'maxYearlyExposure',
    label: 'Est. Max Yearly Exposure',
    short: 'at risk',
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

// A figure off a company record, as a number. Local rather than
// servicePricing's parseMoney because servicePricing imports THIS file, and
// a page that could not price a service would be a strange way to lose the
// impact column. Same rule either way: a typed "$1,284,000" is a number,
// and anything that is not one is nothing rather than zero.
function readAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * What the named figure actually says for ONE company.
 *
 * This is the half the rate card cannot do. There, a service names a figure
 * and the column shows the figure's name, because the card is the same card
 * for every account. On a page that is about one account - the company
 * card's Potential tab - the name can be resolved, and the answer to "why
 * would they buy this" stops being "savings" and becomes a dollar amount.
 *
 * Three answers, and they are three different things:
 *
 *   null              the service names no figure at all. Nobody has said
 *                     what this service is worth to a client yet.
 *   amount === null   it names one, and this company's record does not
 *                     have it. The tie is fine; the figure is missing, and
 *                     the place to go and get it is the analysis.
 *   a number          the figure, as it stands on that company's record.
 *
 * Never summed across services. Two services measured by the same savings
 * figure are two ways of getting at the same money, not twice the money.
 */
export function impactAmount(key, client) {
  const source = impactSourceFor(key);
  if (!source) return null;
  return { source, amount: readAmount(client?.[source.field]) };
}

/**
 * The tooltip on an Impact cell that HAS a company behind it.
 *
 * Says which figure, what it counts, whose it is, and - when the record
 * does not carry it - where it comes from, because "-" in a money column
 * reads as zero and this one means "not filled in".
 */
export function impactAmountTitle(key, company = '') {
  const source = impactSourceFor(key);
  if (!source) return impactTitle(key);
  const whose = company ? `${company}’s` : 'this account’s';
  return `${source.label} for ${whose} estate. ${source.blurb} Tied to this service on the Services Pricing rate card; `
    + `the amount is read off ${source.where}, so it moves with the account rather than with the service.`;
}

/** The same tooltip, for a tie whose figure the company record is missing. */
export function impactMissingTitle(key, company = '') {
  const source = impactSourceFor(key);
  if (!source) return impactTitle(key);
  const whose = company ? `${company}` : 'this account';
  return `${source.label} is not on ${whose}’s record yet, so there is no amount to show. `
    + `It is filled from the saved Master Analysis - Refresh figures on the Analysis button - and lives on ${source.where}.`;
}
