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

// The org chart on page two is drawn with the SAME two helpers the popup's
// Divisions section draws it with, rather than a second reading of the
// mapping that could disagree with what the user sees on screen. Both are
// pure and import nothing, so this file stays loadable under plain Node.
import { buildDivisionContactTree, groupDivisionContactsByTeam } from './divisions.js';

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

// ---- page two: the org chart -----------------------------------------------

// Page two is a page of its own, so it is measured on its own: 44 rows of
// 11pt with the section heading above them is what a Letter page holds
// between one-inch margins. Past that the chart says how many people it
// left out, the same bargain every list on page one makes.
export const MAX_ORG_ROWS = 44;

// How deep the indent goes before it stops biting. Twelve levels of
// division nesting times a reporting chain underneath would walk the names
// off the right edge of the page, so past this depth rows still print -
// they just stop moving right. Nobody is dropped for being deep.
export const MAX_ORG_INDENT = 6;

const contactId = (c) => String(c?.id ?? c?.vid ?? '');

/**
 * The org chart, flattened to printable rows.
 *
 * A tree of nested objects is the wrong shape for this page. What Word
 * draws is a column of lines, each indented by how deep it sits, and what
 * the cap has to count is exactly those lines - so the walk happens here
 * and hands back the rows, rather than leaving the renderer to recurse and
 * the cap to guess at a height.
 *
 * Three kinds of row, each carrying its own `depth`:
 *   division - a box on the chart: the company, or something under it
 *   team     - a Team Name heading inside a box, when anyone on it has one
 *   person   - somebody, indented under whoever they report to
 *
 * Nesting is the reporting line, as it is in the popup: a manager drawn
 * directly above their report gets no label, and only a manager the chart
 * could NOT draw that way (on another box, or in another team) is named on
 * the row with `managers`. Losing that would leave a mapped reporting line
 * off the page with nothing to say it existed.
 *
 * Everything the division mapping knows is handed in rather than looked up,
 * so this stays pure: `tree` is what buildDivisionTree returned, and
 * `contactsOf`, `teamOf` and `detailOf` are the modal's own resolvers.
 */
export function orgChartRows({
  company = '',
  // The companies this one rolls up into, by name. One line above the
  // chart: an account that is itself a division of something bigger reads
  // completely differently, and the chart would not otherwise say so.
  parents = [],
  // { id, company, missing, children } from buildDivisionTree, or null on
  // an account with nothing mapped.
  tree = null,
  // (divisionId) => the contacts assigned to that box.
  contactsOf = null,
  // This company's own contacts, for the root box. Anyone already assigned
  // to a division is left to that division rather than printed twice.
  companyContacts = [],
  // contactId -> [managerId], settings.contactReportsTo as it stands.
  reportsTo = {},
  // (contact) => their Team Name, or '' when they carry none.
  teamOf = null,
  // Manager ids resolved to names, for a manager the chart cannot nest.
  nameById = null,
  // (contact) => { title, decisionMaker, dayToDay, left }. The chart chips
  // in the popup carry a name and nothing else; on a page read away from
  // the app a name with no title answers half the question.
  detailOf = null,
  maxRows = MAX_ORG_ROWS,
} = {}) {
  const names = nameById || new Map();
  const boxContacts = (id) => (typeof contactsOf === 'function' ? (contactsOf(id) || []) : []);
  const detail = (c) => (typeof detailOf === 'function' ? (detailOf(c) || {}) : {});

  // Everyone the mapping has already placed on a box. The root prints the
  // company's own contacts too, and without this a person assigned to a
  // division would appear once under it and once under the company - which
  // reads as two people with the same name rather than one person filed.
  const assigned = new Set();
  (function collect(node) {
    if (!node) return;
    for (const c of boxContacts(node.id)) {
      const id = contactId(c);
      if (id) assigned.add(id);
    }
    for (const child of (node.children || [])) collect(child);
  })(tree);

  const rows = [];
  let people = 0;
  // Whether anybody is drawn UNDER anybody else. A page of names at one
  // level is a list, not a chart, and page two has to be able to tell the
  // difference to know whether it is worth printing at all.
  let nested = false;
  const placed = new Set();

  // A box's people: those assigned to it, then - on the root only - the
  // company's own contacts that no division claimed. Nobody is printed
  // twice, and nobody on the company record is silently dropped.
  const peopleOn = (node, isRoot) => {
    const out = [];
    const take = (c) => {
      const id = contactId(c);
      if (id && placed.has(id)) return;
      if (id) placed.add(id);
      out.push(c);
    };
    for (const c of boxContacts(node.id)) take(c);
    if (isRoot) {
      for (const c of (companyContacts || [])) {
        const id = contactId(c);
        if (id && assigned.has(id)) continue;
        take(c);
      }
    }
    return out;
  };

  const pushPeople = (list, depth) => {
    // Teams first, reporting lines within a team - the same order the
    // popup groups by, so the two read the same way round. A box where
    // nobody carries a Team Name draws the plain tree it always did.
    const groups = groupDivisionContactsByTeam(list, teamOf)
      .map(g => ({ ...g, nodes: buildDivisionContactTree(g.contacts, reportsTo, names) }))
      .filter(g => g.nodes.length > 0);
    const labelled = groups.some(g => g.team);
    for (const group of groups) {
      let at = depth;
      if (labelled) {
        rows.push({ kind: 'team', depth, name: group.team || 'No team' });
        at = depth + 1;
      }
      (function walk(nodes, d, under) {
        for (const node of nodes) {
          const c = node.contact || {};
          const info = detail(c);
          rows.push({
            kind: 'person',
            depth: d,
            // Whether somebody is drawn UNDER their manager, as opposed to
            // merely indented because their box or their team is. The page
            // marks the two differently, and marking every indented row as
            // a report is how the person at the top of a box ends up
            // looking like they answer to the heading above them.
            reportsUnder: !!under,
            name: clean(c.name),
            title: clean(info.title ?? c.jobtitle ?? c.title),
            decisionMaker: !!info.decisionMaker,
            dayToDay: !!info.dayToDay,
            // Somebody tagged Left is kept rather than filtered out: an org
            // chart that quietly drops the person whose seat is empty is
            // how a reader walks into a meeting asking for them by name.
            left: !!info.left,
            managers: (node.managerNames || []).filter(Boolean),
          });
          people += 1;
          if ((node.children || []).length) nested = true;
          walk(node.children || [], d + 1, true);
        }
      })(group.nodes, at, false);
    }
  };

  const walkBox = (node, depth, isRoot) => {
    rows.push({
      kind: 'division',
      depth,
      name: clean(node.company) || '(unnamed)',
      missing: !!node.missing,
      root: !!isRoot,
    });
    pushPeople(peopleOn(node, isRoot), depth + 1);
    for (const child of (node.children || [])) walkBox(child, depth + 1, false);
  };

  if (tree) walkBox(tree, 0, true);

  // Capped on the printed row, not on the person: a heading costs a line
  // whatever sits under it, and counting people alone is what would let a
  // chart of many small divisions run onto a third page.
  //
  // A cut that lands just after a heading leaves that heading with nothing
  // under it, which reads as a division nobody covers rather than as a
  // division the page ran out of room for. So trailing headings come off
  // too, and the people they would have carried are counted in `hidden`
  // with everyone else the cut dropped.
  const truncated = rows.length > maxRows;
  const kept = rows.slice(0, Math.max(0, maxRows));
  if (truncated) {
    while (kept.length && kept[kept.length - 1].kind !== 'person') kept.pop();
  }
  const shown = kept.filter(r => r.kind === 'person').length;

  return {
    company: clean(company),
    parents: (parents || []).map(clean).filter(Boolean),
    rows: kept,
    people,
    shown,
    hidden: Math.max(0, people - shown),
    // Counted off what actually prints, not off the whole walk: the note
    // under the heading describes the chart the reader is looking at, and
    // a division the cap dropped is owned up to by `hidden` instead.
    divisions: kept.filter(r => r.kind === 'division' && !r.root).length,
    // Page two earns its paper only by saying something page one cannot: a
    // division mapped under this account, a reporting line between two of
    // its people, or a parent it rolls up into. An account with five flat
    // contacts and no structure keeps the one-pager it has always had.
    hasStructure: nested
      || rows.some(r => r.kind === 'division' && !r.root)
      || rows.some(r => r.kind === 'person' && r.managers.length > 0)
      || (parents || []).some(p => clean(p)),
  };
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
  // What page two draws, as orgChartRows takes it. Omitted entirely on a
  // caller that has no division mapping to hand over, which is the same
  // one-page document this made before page two existed.
  orgChart = null,
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
    // Null rather than an empty chart when there is nothing structural to
    // draw, so the renderer has one thing to test and the document goes
    // back to being one page on the accounts that only ever needed one.
    orgChart: (() => {
      if (!orgChart) return null;
      const chart = orgChartRows({ company, ...orgChart });
      return chart.hasStructure && chart.rows.length ? chart : null;
    })(),
    notes: clean(notes),
  };
}

/** The download name, with the characters Windows refuses taken out. */
export function onePagerFileName(company) {
  const safe = clean(company).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'Company';
  return `${safe} - Account summary.docx`;
}
