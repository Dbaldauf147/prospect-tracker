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
// Services are budgeted by the LINES they print, not by how many there
// are. A bucket heading costs a line whatever sits under it, so twelve
// services filed into two buckets and the same twelve filed into twelve
// are very different heights - and it was the second that pushed this page
// onto a second one. Twelve lines across two columns is six deep, which is
// what fits under everything above it.
//
// Unlike the other two this is a budget rather than a cap: a book that
// overruns it gets set in commas instead of bullets and fits, rather than
// getting cut. See cappedServices.
export const MAX_SERVICE_LINES = 12;

// How a contact ranks when nothing structural separates them: the
// day-to-day contact leads, then whoever signs, then anyone already met,
// then by name. Stable beyond that, so two runs of the same account
// produce the same sheet.
//
// Day-to-day ahead of decision maker on purpose: the sheet is opened to
// answer "who do I call", and the answer to that is almost never the
// person who signs.
function contactRank(c) {
  return [Number(!c.dayToDay), Number(!c.decisionMaker), Number(!c.metInPerson)];
}
function byRank(a, b) {
  const ra = contactRank(a);
  const rb = contactRank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return a.name.localeCompare(b.name);
}

const nameKey = (v) => clean(v).toLowerCase();

/**
 * A contact's LinkedIn profile as a URL worth putting behind their name.
 *
 * HubSpot stores either a full URL or a bare handle, and the popup's own
 * "View on LinkedIn" link reads both the same way - so this does too,
 * rather than inventing a second reading of the same field.
 *
 * Anything that is not http(s) comes back empty. It is the one value on
 * this page that a reader CLICKS, and a document that carries somebody
 * else's javascript: or file: URL into a meeting is a different kind of
 * object from a sheet of contact details.
 */
export function linkedinUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  // A scheme we did not allow - mailto:, javascript:, data: - is not a
  // handle either, so it is nothing.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  const handle = raw.replace(/^(www\.)?linkedin\.com\/(in\/)?/i, '').replace(/^\/+/, '');
  return handle ? `https://www.linkedin.com/in/${handle}` : '';
}

/**
 * The contacts as the sheet lists them: the reporting line, flattened.
 *
 * Who answers to whom is the thing a reader of this page is trying to
 * work out, and a flat list with "reports to Herb Tracy" under a name
 * makes them reconstruct it one row at a time. So a report is printed
 * directly under their manager and carries a `depth` for the renderer to
 * indent by - the structure is read off the shape of the column instead.
 *
 * Ordering is by BRANCH, not by row: a manager is ranked by the best rank
 * anyone under them holds, so the branch holding the day-to-day contact
 * leads the table even when the manager themselves is nobody special.
 * Within a branch the manager comes first and their reports follow in
 * their own order. That way the cap - which takes the first N rows - never
 * cuts between a manager and the team the indent says is theirs.
 *
 * Managers are matched by NAME, because that is what a contact's Reports
 * To resolves to by the time it reaches this page. A manager who is not
 * one of this company's contacts cannot be drawn above anybody, so their
 * report stays at the top level and keeps `reportsTo` for the renderer to
 * print - losing the line entirely would be worse than printing it as
 * text.
 */
export function orderContacts(contacts) {
  const rows = (contacts || []).map(c => ({
    name: clean(c?.name),
    title: clean(c?.title),
    email: clean(c?.email),
    // What they are actually called, from the Goes By field on their card.
    // Printed beside the name rather than instead of it: the sheet has to
    // match the name on an email and the name in the room, and on plenty
    // of accounts those are different words.
    nickname: clean(c?.nickname),
    // Their LinkedIn profile, for the link behind the name.
    linkedin: linkedinUrl(c?.linkedin),
    // The team the person is on, as set on their contact card. It replaced
    // the phone column: a phone number on a page like this is nearly
    // always blank or the switchboard, and which team somebody sits on is
    // what the reader is trying to place them by.
    team: clean(c?.team),
    decisionMaker: !!c?.decisionMaker,
    // The person actually worked with week to week, tagged Primary Point
    // of Contact. Not the same question as who signs, and on most accounts
    // not the same person.
    dayToDay: !!c?.dayToDay,
    metInPerson: !!c?.metInPerson,
    // Who they sit under, by name, from the Reports To set on the contact.
    // Names rather than ids: the sheet is read away from the app, where an
    // id answers nothing.
    reportsTo: (Array.isArray(c?.reportsTo) ? c.reportsTo : [c?.reportsTo])
      .map(clean).filter(Boolean),
  })).filter(c => c.name || c.email);

  const byName = new Map();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  }

  // The manager this person can actually be drawn under: one of their
  // Reports To names that is also on this list, is not themselves, and
  // does not sit under them already. The last guard is what stops a
  // mis-entered pair of mutual managers turning into an endless walk.
  const managerOf = (row) => {
    for (const name of row.reportsTo) {
      const boss = byName.get(nameKey(name));
      if (!boss || boss === row) continue;
      let up = boss;
      let guard = 0;
      while (up && guard < rows.length + 1) {
        if (up === row) break;
        up = up.__manager || null;
        guard += 1;
      }
      if (up === row) continue;
      return boss;
    }
    return null;
  };
  for (const row of rows) row.__manager = null;
  for (const row of rows) row.__manager = managerOf(row);

  const childrenOf = new Map();
  const roots = [];
  for (const row of rows) {
    if (row.__manager) {
      if (!childrenOf.has(row.__manager)) childrenOf.set(row.__manager, []);
      childrenOf.get(row.__manager).push(row);
    } else {
      roots.push(row);
    }
  }

  // A branch ranks as well as its best member: the manager of the person
  // we actually deal with belongs at the top of the page with them, not
  // below three people nobody has met.
  const bestRank = (row) => {
    let best = row;
    for (const child of (childrenOf.get(row) || [])) {
      const inner = bestRank(child);
      if (byRank(inner, best) < 0) best = inner;
    }
    return best;
  };
  const branchSort = (a, b) => byRank(bestRank(a), bestRank(b)) || byRank(a, b);

  const out = [];
  const walk = (row, depth) => {
    out.push({
      ...row,
      depth,
      // Whether the manager named on this row is the one printed directly
      // above it. When they are, the indent says it and the renderer drops
      // the text; when they are not - a manager off this list, or one the
      // cap cut - the line is all the reader gets.
      managerShown: !!row.__manager,
    });
    for (const child of (childrenOf.get(row) || []).sort(branchSort)) walk(child, depth + 1);
  };
  for (const root of roots.sort(branchSort)) walk(root, 0);
  return out.map(({ __manager, ...row }) => row); // eslint-disable-line no-unused-vars
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
 * What is being sold, what stage it is at and what it is worth. No close
 * date: it is the one column of the four that was usually empty, and an
 * expected close is a forecast rather than a fact about the account.
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

// Roughly how many characters of a service name fit across one column.
//
// The bullets and the comma list are set in the same 9pt face in a column
// half the 9360-twip content width, which is 3.25 inches - about 52
// characters of Segoe UI at that size. 46 is that with room to be wrong:
// over-estimating the width is what puts a line onto the page that was
// budgeted away, and the cost of under-estimating is a little white space.
export const CHARS_PER_LINE = 46;

/** How many lines a bucket's services take when run together with commas. */
const commaLines = (items) => Math.max(1, Math.ceil(items.join(', ').length / CHARS_PER_LINE));

/** How many of `items` fit in `lines` lines of comma-separated text. */
function itemsWithin(items, lines) {
  const room = Math.max(0, lines) * CHARS_PER_LINE;
  let used = 0;
  let n = 0;
  for (const item of items) {
    const cost = (n ? 2 : 0) + item.length; // the ", " counts
    if (used + cost > room) break;
    used += cost;
    n += 1;
  }
  return n;
}

/**
 * The sold services, grouped and then fitted to the space there is.
 *
 * Two shapes, and which one gets used is decided by whether the services
 * fit rather than by a setting. Bullets are the better read - one service
 * per line, scannable - so they are what a normal account gets. But a
 * bullet costs a whole line for two words, and on a book of fifteen or
 * twenty services that arithmetic ends with a third of them replaced by
 * "+ 7 more sold.", which is the one thing this section must not say: the
 * page exists to answer "what do we already do for these people", and an
 * answer that omits seven of them is not an answer.
 *
 * So when the bullets do not fit, the same services are run together under
 * their bucket headings with commas. A line then carries three or four
 * instead of one, and the whole book fits in the space the bullets could
 * not. It reads slightly worse and says everything, which is the right way
 * round for this section.
 *
 * Either way a bucket that only half fits keeps the services that fit -
 * dropping it whole would read as "we sell nothing in Compliance here",
 * which is a different and wrong claim - and anything past the budget is
 * counted rather than silently dropped.
 */
export function cappedServices(sold, bucketOf) {
  const all = groupServices(sold, bucketOf);
  // Each group carries the lines it costs, so the renderer splits the two
  // columns on the same measure this budgeted with. Two opinions about how
  // tall a bucket is would put six lines in one column and two in the other.
  const bulleted = all.map(g => ({ ...g, lines: g.items.length + 1 }));
  const spend = (groups) => groups.reduce((n, g) => n + g.lines, 0);
  const done = (groups, mode) => {
    const shown = groups.flatMap(g => g.items);
    return { mode, groups, shown, total: sold.length, hidden: Math.max(0, sold.length - shown.length) };
  };

  if (spend(bulleted) <= MAX_SERVICE_LINES) return done(bulleted, 'bullets');

  const groups = [];
  let lines = 0;
  for (const g of all) {
    // A heading with nothing under it is not worth a line.
    if (lines + 2 > MAX_SERVICE_LINES) break;
    lines += 1;
    const room = MAX_SERVICE_LINES - lines;
    const want = commaLines(g.items);
    if (want <= room) {
      groups.push({ ...g, lines: want + 1 });
      lines += want;
      continue;
    }
    const n = itemsWithin(g.items, room);
    if (!n) { lines -= 1; break; }
    groups.push({ bucket: g.bucket, items: g.items.slice(0, n), lines: room + 1 });
    lines += room;
    break;
  }
  return done(groups, 'commas');
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
