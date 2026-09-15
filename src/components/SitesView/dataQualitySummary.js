// What the Utility Lookup page is actually working from, in one table.
//
// Every figure on this page is either something the upload said or
// something we worked out because it didn't. Four cards used to spell that
// out a commodity at a time - actual kWh here, estimated cost there,
// utilities from the supplier column, market structure per site - and
// between them they answered a question nobody asks: how many sites are in
// each bucket of each measure. The question people do ask, reading a
// Master Analysis someone else built, is simpler and never had an answer on
// the page: how much of this is real, and how much did we make up?
//
// So this is one row per input, and each row says where it came from. A
// percentage where a figure is either given or derived per site (cost,
// consumption, zips), and a sentence where it is a method rather than a
// split (accounts and equipment are always estimated off the property
// type, so saying "0% actual" about them would be a strange way to put it).
//
// Pure, so the wording and the arithmetic can be asserted without a
// browser: scripts/dataQualitySummary.test.mjs.

import { tenureCoverage } from './ownershipScope.js';

/**
 * Whole percentages that add up to 100.
 *
 * Rounding each share on its own is how a table ends up reading "80%
 * estimated, 21% actual": three sites out of seven is 42.857%, and every
 * share in the row rounds up. Largest remainder hands the leftover points
 * to the shares that lost the most in the rounding, so the row always sums
 * to 100 and the order of the parts never changes.
 *
 * A share that is real but tiny keeps a point rather than rounding to
 * nothing: "0% estimated" next to a figure that IS partly estimated is the
 * one reading this table exists to prevent. It is taken off the largest
 * share, which can afford it.
 */
export function sharePcts(counts) {
  const list = (counts || []).map(n => (Number.isFinite(n) && n > 0 ? n : 0));
  const total = list.reduce((a, b) => a + b, 0);
  if (total <= 0) return list.map(() => 0);
  const exact = list.map(n => (n / total) * 100);
  const floors = exact.map(v => Math.floor(v));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  const out = floors.slice();
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  // Nothing real is allowed to read as nothing at all.
  for (let i = 0; i < out.length; i += 1) {
    if (list[i] > 0 && out[i] === 0) {
      const biggest = out.indexOf(Math.max(...out));
      if (out[biggest] > 1) { out[biggest] -= 1; out[i] = 1; }
    }
  }
  return out;
}

// "80% estimated, 20% actual" - the parts that exist, in a fixed order, so
// the same row on two portfolios reads the same way round.
function shareLabel(parts) {
  const pcts = sharePcts(parts.map(p => p.count));
  const said = parts
    .map((p, i) => ({ ...p, pct: pcts[i] }))
    .filter(p => p.count > 0);
  if (said.length === 0) return '';
  return said.map(p => `${p.pct}% ${p.word}`).join(', ');
}

// Green where the page is working from what the file said, amber where it
// is working from an estimate, red where it has nothing at all. The tints
// are the one thing the four cards did that a table of sentences cannot:
// let the shape of an upload be read without reading it.
function splitTone({ given, derived, missing }) {
  if (given + derived === 0) return 'bad';
  if (missing > 0 || derived > 0) return 'warn';
  return 'good';
}

/**
 * One measure that is either given per site or worked out per site.
 *
 * `missing` is its own part rather than the remainder, because a site with
 * no figure at all and a site with an estimated one are different problems
 * and the row has to be able to say which it has.
 */
function splitRow({ key, label, title, actual, est, missing }) {
  const given = Math.max(0, actual || 0);
  const derived = Math.max(0, est || 0);
  const gap = Math.max(0, missing || 0);
  if (given + derived + gap === 0) return { key, label, title, value: 'No sites', tone: null };
  if (given + derived === 0) return { key, label, title, value: 'Missing', tone: 'bad' };
  return {
    key,
    label,
    title,
    value: shareLabel([
      { count: derived, word: 'estimated' },
      { count: given, word: 'actual' },
      { count: gap, word: 'missing' },
    ]),
    tone: splitTone({ given, derived, missing: gap }),
  };
}

/**
 * A per-building attribute: the property type, the tenure, the floor area.
 *
 * Three answers, and they are three different kinds of fact. "Per building"
 * means the upload carried it site by site. "All one type (assigned)" means
 * it did not, and somebody set one value across the whole list, which is a
 * decision rather than data and reads that way. "Missing" means neither,
 * and every figure derived from it downstream is running on a default.
 */
function perBuildingRow({ key, label, title, fromFile, resolved, only, total }) {
  if (total === 0) return { key, label, title, value: 'No sites', tone: null };
  if (resolved === 0) return { key, label, title, value: 'Missing', tone: 'bad' };
  if (fromFile === 0 && only) {
    return { key, label, title, value: `All one type (assigned): ${only}`, tone: 'warn' };
  }
  if (resolved === total) return { key, label, title, value: 'Per building', tone: 'good' };
  return {
    key,
    label,
    title,
    value: `Per building on ${resolved.toLocaleString()} of ${total.toLocaleString()}, missing on ${(total - resolved).toLocaleString()}`,
    tone: 'warn',
  };
}

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// What a set of values comes to when they are all the same one. Null when
// there is more than one, which is what "per building" looks like from
// here.
function onlyValue(list) {
  const set = new Set(list.filter(has).map(v => String(v).trim()));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * The whole table: the inputs down the left, the per-building facts down
 * the right, in the order they are read in.
 *
 * `analysis` is the page's own consumption / cost tally (it already walks
 * every row to build the figures this describes, so this one does not walk
 * them again for the same answer). `rows` are the derived site rows, and
 * everything else is counted off them here.
 */
export function buildDataQualitySummary({ analysis = null, rows = [] } = {}) {
  const total = rows.length || analysis?.total || 0;
  if (total === 0) return null;

  let zipMapped = 0, zipEstimated = 0, zipMissing = 0;
  let typeFromFile = 0, typeResolved = 0;
  let divisions = 0, sized = 0;
  const typeValues = [];
  const divisionNames = new Set();
  // Tenure is counted by the module that every other consumer of it reads -
  // the savings scope, the compliance screening - rather than recounted
  // here. One definition of "we know what this building is", so this table
  // and the figures it describes can never disagree about the gap.
  const tenure = tenureCoverage(rows);
  for (const r of rows) {
    if (!has(r.__zipNorm__)) zipMissing += 1;
    else if (r.__zipEstimated__) zipEstimated += 1;
    else zipMapped += 1;

    if (has(r.__propertyTypeRaw__)) typeFromFile += 1;
    if (has(r.__propertyType__)) { typeResolved += 1; typeValues.push(r.__propertyType__); }

    if (has(r.__division__)) { divisions += 1; divisionNames.add(String(r.__division__).trim()); }
    if (Number.isFinite(r.__propertySizeFt2__)) sized += 1;
  }

  const cost = analysis?.cost || null;
  const use = analysis?.consumption || null;
  const commodity = (bucket) => ({
    actual: bucket?.actualSites || 0,
    est: bucket?.estSites || 0,
    missing: bucket?.missingSites || 0,
  });

  const left = [
    splitRow({
      key: 'electricCost',
      label: 'Electric cost',
      title: 'Actual = a cost column on the upload. Estimated = the site’s consumption priced at the state or country rate for its segment. '
        + 'Every dollar in the Master Analysis is one of the two.',
      ...commodity(cost?.electric),
    }),
    splitRow({
      key: 'electricUse',
      label: 'Electric consumption',
      title: 'Actual = a kWh column on the upload. Estimated = worked out from the property type and, where the upload gives one, the floor area. '
        + 'An estimated site is priced like any other, so the cost above inherits whatever this row says.',
      ...commodity(use?.electric),
    }),
    splitRow({
      key: 'gasCost',
      label: 'Natural gas cost',
      title: 'Actual = a cost column on the upload. Estimated = the site’s therms priced at the state or country rate for its segment.',
      ...commodity(cost?.gas),
    }),
    splitRow({
      key: 'gasUse',
      label: 'Natural gas consumption',
      title: 'Actual = a therms column on the upload. Estimated = worked out from the property type, the same way the electric figure is.',
      ...commodity(use?.gas),
    }),
    {
      key: 'zip',
      label: 'Zip codes',
      title: 'The zip is what places a site: it finds the utility, the state rate and the market. Mapped = a zip on the upload. '
        + 'Estimated = derived from the city and state through the fallback zip list. Missing = the site cannot be placed, so it counts in Total Sites and in nothing else.',
      ...(zipMapped + zipEstimated === 0
        ? { value: 'Missing', tone: 'bad' }
        : {
          value: shareLabel([
            { count: zipMapped, word: 'mapped' },
            { count: zipEstimated, word: 'estimated' },
            { count: zipMissing, word: 'missing' },
          ]),
          tone: splitTone({ given: zipMapped, derived: zipEstimated, missing: zipMissing }),
        }),
    },
    (() => {
      const label = 'Division';
      const title = 'The business unit a site sits under, off the upload. It is what the page can group and report by; with none, the estate is one undivided list.';
      if (divisions === 0) return { key: 'division', label, title, value: 'Missing', tone: 'bad' };
      const named = `${divisionNames.size.toLocaleString()} division${divisionNames.size === 1 ? '' : 's'}`;
      if (divisions === total) return { key: 'division', label, title, value: named, tone: 'good' };
      return {
        key: 'division',
        label,
        title,
        value: `${named}, missing on ${(total - divisions).toLocaleString()} of ${total.toLocaleString()}`,
        tone: 'warn',
      };
    })(),
    perBuildingRow({
      key: 'sqft',
      label: 'Sqft',
      title: 'Floor area off the upload. It sharpens the consumption estimate and it is what a building ordinance’s size threshold is read against: '
        + 'a site with no size is screened as though it met the threshold, which is the safer reading of a gap and not a free one.',
      fromFile: sized,
      resolved: sized,
      only: null,
      total,
    }),
  ];

  const right = [
    perBuildingRow({
      key: 'propertyType',
      label: 'Property type',
      title: 'What the building is, mapped onto the types we hold references for. It drives the consumption estimate, the account and equipment counts, '
        + 'and the commercial / industrial rate a site is priced at. A site with none of it gets no estimate at all.',
      fromFile: typeFromFile,
      resolved: typeResolved,
      only: onlyValue(typeValues),
      total,
    }),
    perBuildingRow({
      key: 'ownership',
      label: 'Ownership',
      title: `Tenure: owned or leased${tenure.known > 0 ? ` (${tenure.owned.toLocaleString()} owned, ${tenure.leased.toLocaleString()} leased` : ''}`
        + `${tenure.known > 0 && tenure.unplaceable > 0 ? `, ${tenure.unplaceable.toLocaleString()} with a status we could not place` : ''}`
        + `${tenure.known > 0 ? ')' : ''}. `
        + 'A site with no tenure status is screened for compliance and keeps its projected savings, which is the safer reading of a gap, '
        + 'but a leased building hiding in there inflates both. Point a column at it on Update Column Mapping.',
      fromFile: tenure.withValue,
      resolved: tenure.known,
      only: tenure.owned === 0 || tenure.leased === 0
        ? (tenure.owned > 0 ? 'Owned' : (tenure.leased > 0 ? 'Leased' : null))
        : null,
      total,
    }),
    (() => {
      const label = 'Accounts';
      const title = 'Utility accounts per site. Never on an upload and always worked out from the property type and the tenure, so this row is a method rather than a split.';
      if (typeResolved === 0) {
        return { key: 'accounts', label, title, value: 'Estimated based on property type, which is missing', tone: 'bad' };
      }
      if (typeResolved === total) return { key: 'accounts', label, title, value: 'Estimated based on property type', tone: 'warn' };
      return {
        key: 'accounts',
        label,
        title,
        value: `Estimated based on property type, missing on ${(total - typeResolved).toLocaleString()} of ${total.toLocaleString()}`,
        tone: 'warn',
      };
    })(),
    (() => {
      const label = 'Equipment';
      const title = 'Chillers, boilers, rooftop units. Estimated from the property type and the tenure on the same reference the account count comes off.';
      if (typeResolved === 0) {
        return { key: 'equipment', label, title, value: 'Estimated based on property type, which is missing', tone: 'bad' };
      }
      if (typeResolved === total) return { key: 'equipment', label, title, value: 'Estimated based on property type', tone: 'warn' };
      return {
        key: 'equipment',
        label,
        title,
        value: `Estimated based on property type, missing on ${(total - typeResolved).toLocaleString()} of ${total.toLocaleString()}`,
        tone: 'warn',
      };
    })(),
  ];

  return { total, left, right };
}

export default buildDataQualitySummary;
