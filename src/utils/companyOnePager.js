// The company one-pager: who we know, what they already buy, what is open,
// and who owns the account, on a single branded page.
//
// The thing this is for is the five minutes before a meeting - a handover,
// a manager asking "what is the story on this account", a leave-behind. So
// it is one page by construction rather than by luck: the lists are
// capped, the sections are fixed, and anything that would push it onto a
// second page is counted rather than printed.
//
// This file is the MODEL only: what goes on the page, in what order, with
// what left out. It knows nothing about Word - see onePagerDocx.js, which
// turns a model into the file. Splitting them that way is what lets the
// decisions worth arguing about (which contact leads, what counts as open,
// where a list stops) be read and tested on their own, without a page of
// WordprocessingML in the way.

const clean = (v) => String(v ?? '').trim();

// What fits on one page, measured rather than guessed.
//
// The tallest page these allow - every cap filled, every contact carrying
// a reporting line, every service in a bucket of its own, long names
// wrapping - lands 52pt clear of the bottom margin on Letter. One notch
// looser on any of the three and it runs over: 6 contacts costs 45pt, a
// 5th opp 25pt, and 14 service lines 45pt, each of which spends the slack
// on its own. They bind only on the very largest accounts; a typical one
// is nowhere near any of them.
//
// Past a cap the section says how many it left out rather than running on.
// A one-pager that is two pages is a document nobody reads in the five
// minutes it exists for, and a cap that silently dropped the rest would be
// worse than no cap - the reader would have no way to know.
export const MAX_CONTACTS = 5;
export const MAX_OPPS = 4;
// Services are capped by the LINES they print, not by how many there are.
// A bucket heading costs a line whatever sits under it, so twelve services
// filed into two buckets and the same twelve filed into twelve are very
// different heights - and it was the second that pushed this page onto a
// second one. Sixteen lines across two columns is eight deep, which is
// what fits under everything above it.
export const MAX_SERVICE_LINES = 12;

/**
 * A contact as the sheet lists them. `decisionMaker` floats them to the
 * top and earns the marker: on a page about who we know, the answer to
 * "who signs" is the first thing looked for.
 */
export function orderContacts(contacts) {
  const rows = (contacts || []).map(c => ({
    name: clean(c?.name),
    title: clean(c?.title),
    email: clean(c?.email),
    phone: clean(c?.phone),
    decisionMaker: !!c?.decisionMaker,
    // The person actually worked with week to week, tagged Primary Point
    // of Contact. Not the same question as who signs, and on most accounts
    // not the same person - which is exactly why both are marked.
    dayToDay: !!c?.dayToDay,
    metInPerson: !!c?.metInPerson,
    // Who they sit under, by name, from the Reports To set on the contact.
    // Names rather than ids: the sheet is read away from the app, where an
    // id answers nothing.
    reportsTo: (Array.isArray(c?.reportsTo) ? c.reportsTo : [c?.reportsTo])
      .map(clean).filter(Boolean),
  })).filter(c => c.name || c.email);
  // The day-to-day contact leads, then whoever signs, then anyone already
  // met, then by name. Stable beyond that, so two runs of the same account
  // produce the same sheet.
  //
  // Day-to-day ahead of decision maker on purpose: the sheet is opened to
  // answer "who do I call", and the answer to that is almost never the
  // person who signs.
  return rows.sort((a, b) => (Number(b.dayToDay) - Number(a.dayToDay))
    || (Number(b.decisionMaker) - Number(a.decisionMaker))
    || (Number(b.metInPerson) - Number(a.metInPerson))
    || a.name.localeCompare(b.name));
}

/**
 * The sold services grouped under the bucket each belongs to.
 *
 * Bucketed because a flat list of twelve reads as twelve unrelated things,
 * where three buckets of four says what the account actually buys from us.
 * `bucketOf` is handed in rather than looked up so this stays pure - the
 * modal passes serviceCategoriesStore's own resolver, which is the same one
 * the Services tab groups by.
 */
export function groupServices(services, bucketOf, { ungrouped = 'Other services' } = {}) {
  const groups = new Map();
  for (const raw of (services || [])) {
    const name = clean(raw);
    if (!name) continue;
    const bucket = clean(typeof bucketOf === 'function' ? bucketOf(name) : '') || ungrouped;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(name);
  }
  // Buckets alphabetical, with the catch-all last however it sorts: it is
  // the leftovers, and leftovers do not lead a list.
  return [...groups.entries()]
    .map(([bucket, items]) => ({ bucket, items: items.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => (Number(a.bucket === ungrouped) - Number(b.bucket === ungrouped))
      || a.bucket.localeCompare(b.bucket));
}

/**
 * The opportunities still open, in the order the Opps board ranks them.
 *
 * Takes the rows companyOppRows already built, which carry `active` - the
 * app's one answer to "is this still live", shared with the board and the
 * close-rate maths. Deciding it again here against a list of stage names
 * would be a second definition of open, and the two would drift.
 */
export function orderOpps(opps) {
  return (opps || [])
    .filter(o => o && o.active)
    .map(o => ({
      name: clean(o.name) || clean(o.scope) || '(unnamed)',
      scope: clean(o.scope),
      stage: clean(o.stage),
      amount: clean(o.amount),
      closeDate: clean(o.closeDate),
    }));
}

/**
 * When this account became a client: the earliest Original Contract Start
 * across their deals.
 *
 * The EARLIEST, not the current term's - "client since" is the date the
 * relationship began, and a renewal that started last March would answer a
 * different question. Deals whose date is blank or unparseable are skipped
 * rather than treated as the beginning of time, which is what sorting raw
 * strings would do to a row somebody left empty.
 *
 * Takes dates rather than deal rows so this stays free of the deals store's
 * column names; the modal reads 'Original Contract Start' and hands them in.
 */
export function clientSince(dates) {
  const times = (dates || [])
    .map(d => (d instanceof Date ? d.getTime() : Date.parse(String(d ?? ''))))
    .filter(t => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.min(...times));
}

/**
 * The sold services, grouped and then trimmed to what fits.
 *
 * Trimmed by printed lines rather than by count, and a bucket that only
 * half fits keeps the services that fit rather than being dropped whole -
 * losing a bucket entirely would read as "we sell nothing in Compliance
 * here", which is a different and wrong claim.
 */
export function cappedServices(sold, bucketOf) {
  const all = groupServices(sold, bucketOf);
  const groups = [];
  let lines = 0;
  let shown = 0;
  for (const g of all) {
    if (lines + 1 >= MAX_SERVICE_LINES) break;
    lines += 1; // the bucket heading
    const room = Math.min(g.items.length, MAX_SERVICE_LINES - lines);
    if (room <= 0) { lines -= 1; break; }
    groups.push({ bucket: g.bucket, items: g.items.slice(0, room) });
    lines += room;
    shown += room;
  }
  return { shown: groups.flatMap(g => g.items), total: sold.length, hidden: Math.max(0, sold.length - shown), groups };
}

/**
 * Everything the page states, resolved and capped.
 *
 * `shown` is what prints; `hidden` is what a section has to own up to
 * leaving out. Counting rather than silently dropping matters: a reader
 * has no other way to know the account carries nine more contacts.
 */
export function onePagerModel({
  company = '',
  cdm = '',
  clientManager = '',
  services = [],
  // (name) => the bucket it is filed under, or '' for none. Optional: with
  // no resolver every service lands under the catch-all, which is what a
  // book with no categories set up looks like anyway.
  bucketOf = null,
  contacts = [],
  opps = [],
  // Every Original Contract Start on this client's deals. The earliest is
  // what the page prints.
  contractDates = [],
  notes = '',
  generatedAt = new Date(),
} = {}) {
  const sold = (services || []).map(clean).filter(Boolean);
  const people = orderContacts(contacts);
  const open = orderOpps(opps);
  const stamped = generatedAt instanceof Date && !isNaN(generatedAt) ? generatedAt : null;
  const capped = (list, max) => ({
    shown: list.slice(0, max),
    total: list.length,
    hidden: Math.max(0, list.length - max),
  });
  return {
    company: clean(company),
    generatedAt: stamped,
    dateLabel: stamped
      ? stamped.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '',
    owners: { cdm: clean(cdm), clientManager: clean(clientManager) },
    clientSince: (() => {
      const d = clientSince(contractDates);
      return d
        ? { date: d, label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }
        : null;
    })(),
    contacts: capped(people, MAX_CONTACTS),
    services: cappedServices(sold, bucketOf),
    opps: capped(open, MAX_OPPS),
    notes: clean(notes),
  };
}

/** The download name, with the characters Windows refuses taken out. */
export function onePagerFileName(company) {
  const safe = clean(company).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'Company';
  return `${safe} - Account summary.docx`;
}
