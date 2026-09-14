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

// A contact's note, on the page. About three lines of the Notes column at
// the size it is set in - enough for a real sentence about somebody, and a
// hard stop on the one field that could otherwise run to a paragraph.
export const NOTE_MAX_CHARS = 100;
// Measured off the rendered column rather than computed from its width:
// at this size a hundred characters sets as three lines, not the two the
// width alone suggests.
export const NOTE_CHARS_PER_LINE = 34;

/**
 * A note trimmed to what the column holds.
 *
 * Cut on a word rather than mid-syllable where there is one to cut on, and
 * marked with an ellipsis so the reader knows the note goes on - a note
 * that simply stops reads as the whole of what somebody wrote.
 */
export function noteExcerpt(note) {
  const text = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= NOTE_MAX_CHARS) return text;
  const cut = text.slice(0, NOTE_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > NOTE_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.]$/, '')}...`;
}

// The Title column, in the same terms. It gave width to Notes and so wraps
// sooner than it used to: "Global Director of Critical Site Operations" is
// three lines of it.
export const TITLE_CHARS_PER_LINE = 30;

/** How many lines of the contacts table a note takes. */
export const noteLines = (note) => Math.ceil(
  (noteExcerpt(note).length || 1) / NOTE_CHARS_PER_LINE,
);

/**
 * How tall one contact's row is, in lines.
 *
 * A table row is as tall as its tallest cell, so this is the MAX of what
 * the columns want rather than any one of them. Charging for the note
 * alone is what let a page of long job titles run over: the note was
 * capped and the title never was, so the column that actually set the
 * height was the one nothing was counting.
 */
export function contactRowLines(c) {
  return Math.max(
    noteLines(c?.note),
    Math.ceil((String(c?.title ?? '').length || 1) / TITLE_CHARS_PER_LINE),
    1,
  );
}

// ---- how much room the services actually get ------------------------------
//
// The budget above is a floor now, not the answer. It was measured as a
// fixed twelve on a page that was full, and that page has changed four
// times since: the green band moved into the page header, the opportunity
// rows lost their second line, two section headings lost their counts, and
// the footer came off. Each time the constant stayed put while the room
// under it grew - until a book of fifteen services printed twelve and
// counted three with five and a half inches of white page underneath.
//
// So the budget is no longer a number anybody has to re-measure by hand. It
// is whatever the rest of the page did not use: everything above the
// services is counted in lines and the services get the remainder. A page
// with two contacts and one opp gives them more room than a page with five
// and four, which is what "it fits on one page" has always actually meant.
//
// The unit is the same budget line the rest of this file counts in, and it
// has never been a literal printed line: a comma line carries four services
// and a bulleted one carries a name that may itself wrap onto two. So the
// number below is not arithmetic on the page height - it is calibrated, by
// building the real .docx at maximum load (a book of 160 services, seven
// contacts, six opps and a note) and rendering it to find where the page
// actually fills.
//
// That point moves when the furniture above the services changes weight,
// which is exactly what the Notes column did: a note and a job title both
// wrap, so a contact row that was one line became three, and the ceiling
// fell from about 132 to about 66. The number below is re-calibrated for
// that page and sits under it on purpose - the rendering used to calibrate
// is a faithful read of the WordprocessingML but is not Word, and Word's
// table cell margins are the larger of the two.
//
// 58 leaves about an inch and a third of slack on a page that extreme (160
// services, five contacts all carrying a full note and a wrapping title,
// four opps and a note of its own). A normal account is nowhere near it:
// the fifteen-service book that prompted all this still prints every one,
// in bullets, with five inches to spare.
export const BODY_LINE_BUDGET = 58;

// Notes run the full width of the page rather than one of two columns, so
// a line of them holds about twice what a service line does.
export const NOTES_CHARS_PER_LINE = 92;

/**
 * Lines of services this page has room for, given everything above them.
 *
 * Costs are in whole lines, rounded UP where a thing sits between two.
 * Over-charging leaves white space at the bottom of the page and
 * under-charging spills onto a second one, and those two mistakes are not
 * the same size.
 *
 * Doubled at the end because the services print in TWO columns: a line of
 * page buys two lines of budget.
 */
export function serviceLineBudget({ contacts = 0, reportingLines = 0, contactNoteLines = 0, opps = 0, notes = '' } = {}) {
  const text = clean(notes);
  const spent = 3                        // the CDM / Client Manager / Client since band
    + 2 + 2 + contacts + reportingLines  // Key contacts: heading, column heads, a row each,
                                         // and the spelled-out manager where one is needed
    + contactNoteLines                   // a note that wraps makes its row taller
    + 2 + 2 + opps                       // Open opportunities: heading, column heads, rows
    + 2                                  // the Current services heading itself
    + (text ? 2 + Math.ceil(text.length / NOTES_CHARS_PER_LINE) : 0)
    + 1;                                 // the "+ N more" line, if it comes to that
  // Never below the old fixed budget. A page with a long note and a full
  // contact list should print fewer services, not stop printing them.
  return Math.max(MAX_SERVICE_LINES, (BODY_LINE_BUDGET - spent) * 2);
}

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
    // What is actually known about this person, from the note on their
    // contact card. It replaced the team column, which replaced the phone
    // one: a team name places somebody in an org, but the note is the only
    // field on the row that says anything the reader could not work out
    // from the name and the title.
    //
    // Capped, because it is the one free-text field on the page and an
    // uncapped one would set the height of the contacts table - and, now
    // that the services are budgeted against what the rest of the page
    // spends, would quietly take the room they print in.
    note: noteExcerpt(c?.note ?? c?.notes),
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

// A bulleted service sits further in than a comma run does - the bullet
// glyph and a deeper hanging indent - so its line holds a little less.
export const BULLET_CHARS_PER_LINE = 44;

/** How many lines a bucket's services take when run together with commas. */
const commaLines = (items) => Math.max(1, Math.ceil(items.join(', ').length / CHARS_PER_LINE));

/**
 * How many lines a bucket's services take as bullets, one per service.
 *
 * One per service is the FLOOR, not the answer: "Invoice recalculation -
 * light" is wider than half a page column at this size and Word wraps it
 * onto a second line. Charging every service one line regardless is what
 * let a budget of a hundred lines print a section fifty rows tall and run
 * the page over - the names on a real book are long, and about a third of
 * them wrap.
 */
const bulletLines = (items) => items.reduce(
  (n, item) => n + Math.max(1, Math.ceil(String(item).length / BULLET_CHARS_PER_LINE)), 0,
);

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
export function cappedServices(sold, bucketOf, budget = MAX_SERVICE_LINES) {
  const max = Math.max(MAX_SERVICE_LINES, Math.floor(budget) || 0);
  const all = groupServices(sold, bucketOf);
  // Each group carries the lines it costs, so the renderer splits the two
  // columns on the same measure this budgeted with. Two opinions about how
  // tall a bucket is would put six lines in one column and two in the other.
  const bulleted = all.map(g => ({ ...g, lines: bulletLines(g.items) + 1 }));
  const spend = (groups) => groups.reduce((n, g) => n + g.lines, 0);
  const done = (groups, mode) => {
    const shown = groups.flatMap(g => g.items);
    // The budget travels with the result. It is worked out from the rest of
    // the page now rather than fixed, so anything checking that the section
    // fits has to be able to see the number it was fitted to.
    return { mode, groups, shown, budget: max, total: sold.length, hidden: Math.max(0, sold.length - shown.length) };
  };

  if (spend(bulleted) <= max) return done(bulleted, 'bullets');

  const groups = [];
  let lines = 0;
  for (const g of all) {
    // A heading with nothing under it is not worth a line.
    if (lines + 2 > max) break;
    lines += 1;
    const room = max - lines;
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
  // Resolved before the services, because how many contacts and opps print
  // is what decides how much room is left for them.
  const shownContacts = capped(people, MAX_CONTACTS);
  const shownOpps = capped(open, MAX_OPPS);
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
    contacts: shownContacts,
    // Budgeted against what the contacts and opps above them actually cost,
    // so the services fill the page rather than a number measured on a page
    // that no longer exists.
    services: cappedServices(sold, bucketOf, serviceLineBudget({
      contacts: shownContacts.shown.length,
      // A row that spells its manager out in words costs a second line; one
      // drawn under them by the indent does not.
      reportingLines: shownContacts.shown.filter(c => c.reportsTo.length && !c.managerShown).length,
      // Every line a contact row spends beyond its first - a wrapped note
      // or a wrapped title - comes out of the services' room rather than
      // out of the bottom of the page.
      contactNoteLines: shownContacts.shown.reduce((n, c) => n + (contactRowLines(c) - 1), 0),
      opps: shownOpps.shown.length,
      notes,
    })),
    opps: shownOpps,
    notes: clean(notes),
  };
}

/** The download name, with the characters Windows refuses taken out. */
export function onePagerFileName(company) {
  const safe = clean(company).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'Company';
  return `${safe} - Account summary.docx`;
}
