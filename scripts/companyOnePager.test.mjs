// The company one-pager - who we know, who we call, what is open, and what
// they already buy. Plain Node - no test framework (the project has none).
// Run:
//   node scripts/companyOnePager.test.mjs
//
// Two things decide whether this document is worth anything.
//
// The first is that it stays ONE page. A handover sheet that runs to three
// is a document nobody reads in the five minutes it exists for, so every
// list is capped and the overflow is counted rather than printed. A cap
// that silently dropped the rest would be worse than no cap: the reader
// would have no way to know the account has nine more contacts.
//
// Page two, the org chart, is the one thing exempt from the first rule -
// and it earns that by only existing when it has something page one cannot
// say. An account with a flat contact list and no divisions still gets the
// one page it always got; the assertions below hold it to that.
//
// The second is that it is a REAL Word file. It used to go out through
// html-docx-js, which does not build one - it wraps the HTML in an
// altChunk and leaves Word to convert it on open. Word does; Google Docs,
// Quick Look and most phone viewers do not. The assertions at the bottom
// unzip what the button produces and read the WordprocessingML, because
// the failure mode of getting that wrong is a file that opens blank in
// exactly the places a leave-behind gets opened.
import {
  onePagerModel, onePagerFileName, orderContacts, orderOpps, groupServices, clientSince,
  orgChartRows,
  MAX_CONTACTS, MAX_OPPS, MAX_SERVICE_LINES, MAX_ORG_ROWS, CHARS_PER_LINE, BULLET_CHARS_PER_LINE,
  cappedServices, linkedinUrl,
} from '../src/utils/companyOnePager.js';
import {
  onePagerDocumentXml, onePagerHeaderXml, onePagerParts, buildOnePagerDocx, xmlEsc,
  CONTENT_TYPES_XML, DOCUMENT_RELS_XML,
} from '../src/utils/onePagerDocx.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const AT = new Date('2026-09-14T12:00:00Z');
const contact = (name, over = {}) => ({ name, title: 'Director', email: `${name.split(' ')[0].toLowerCase()}@acme.com`, ...over });
const opp = (name, over = {}) => ({ name, scope: 'Scope 3 estimates', stage: 'Quoting', amount: '$120,000', closeDate: '11/30/2026', active: true, ...over });

const BUCKETS = { 'Bill Pay': 'DATA', 'Invoice collection': 'DATA', 'GHG Reporting': 'GHG Reporting' };
const bucketOf = (n) => BUCKETS[n] || '';

const full = {
  company: 'BRE Hotels & Resorts',
  cdm: 'Dan Baldauf',
  clientManager: 'Alex Moreau',
  services: ['Bill Pay', 'GHG Reporting', 'Invoice collection', 'Loose Service'],
  bucketOf,
  contacts: [
    contact('Zoe Adams'),
    contact('Ben Carter', { decisionMaker: true }),
    contact('Mia Lopez', { dayToDay: true, reportsTo: ['Ben Carter'] }),
  ],
  opps: [
    opp('Chiller replacement'),
    // Its own scope: the page prints scopes rather than names now, so a
    // closed opp sharing the open one's scope would make the assertion
    // that it stays off the page pass for the wrong reason.
    opp('Closed one', { active: false, scope: 'Closed scope' }),
  ],
  generatedAt: AT,
};

// ---- what the page states ------------------------------------------------
{
  const m = onePagerModel(full);
  check('the company leads', m.company, 'BRE Hotels & Resorts');
  check('the CDM is carried', m.owners.cdm, 'Dan Baldauf');
  check('so is the Client Manager', m.owners.clientManager, 'Alex Moreau');
  check('the date is resolved once, not at render', m.dateLabel, 'September 14, 2026');
  check('only OPEN opps are listed', m.opps.shown.length, 1);
  check('and it is the open one', m.opps.shown[0].name, 'Chiller replacement');
  check('with the figures somebody asks for out loud',
    `${m.opps.shown[0].stage}|${m.opps.shown[0].amount}`, 'Quoting|$120,000');
  // No close date. It was the one column of the four usually empty, and an
  // expected close is a forecast rather than a fact about the account.
  check('and no close date', 'closeDate' in m.opps.shown[0], false);
  check('and the scope of services it covers', m.opps.shown[0].scope, 'Scope 3 estimates');
  // Some exports put the scope in the name field as well. Printing it
  // twice under itself is noise, not information.
  const echoed = onePagerDocumentXml(onePagerModel({
    ...full, opps: [opp('Bill payment', { scope: 'Bill payment' })],
  }));
  check('a scope that only repeats the name is not printed twice',
    (echoed.match(/Bill payment/g) || []).length, 1);
  // An opp with no Scope recorded keeps its one line rather than gaining a
  // blank one.
  check('and a missing scope leaves no empty line',
    onePagerDocumentXml(onePagerModel({ ...full, opps: [opp('Nameless', { scope: '' })] }))
      .includes('Scope 3 estimates'), false);
}

// ---- who to call ---------------------------------------------------------
// The sheet is opened to answer "who do I ring", and that is almost never
// the person who signs - so the day-to-day contact leads, ahead of the
// decision maker.
{
  const ordered = orderContacts(full.contacts);
  // The table is the reporting line flattened, so the branch holding the
  // day-to-day contact leads and she is drawn UNDER her manager rather
  // than above him. Both halves matter: the branch leads because she is on
  // it, and the shape inside it is the org chart's, not the ranking's.
  check('the manager of the day-to-day contact opens the table', ordered[0].name, 'Ben Carter');
  check('with her directly under him', ordered[1].name, 'Mia Lopez');
  check('indented by a level', ordered[1].depth, 1);
  check('and the manager at the top level', ordered[0].depth, 0);
  check('the branch leads the people it outranks', ordered[2].name, 'Zoe Adams');
  check('who is nobody\'s report', ordered[2].depth, 0);

  check('the reporting line is carried by name, not by id',
    ordered[1].reportsTo.join(','), 'Ben Carter');
  // Drawn under him, so the row says so with the indent and the renderer
  // drops the words.
  check('and the row knows the manager is on the page', ordered[1].managerShown, true);
  check('someone reporting to nobody carries an empty list',
    ordered[0].reportsTo.length, 0);

  // A manager this company's contact list does not carry cannot be drawn
  // above anybody, so the report stays at the top level and keeps the line
  // for the renderer to print as text. Losing it would drop a mapped
  // reporting line off the page with nothing to say it existed.
  const offList = orderContacts([contact('X', { reportsTo: 'Y' })]);
  check('a lone manager is accepted unwrapped', offList[0].reportsTo.join(','), 'Y');
  check('a manager who is not a contact leaves the report at the top', offList[0].depth, 0);
  check('and the row says the manager is not on the page', offList[0].managerShown, false);

  // Three deep, to prove the walk is a walk rather than one level of
  // nesting: the page in the screenshot is exactly this shape.
  const chain = orderContacts([
    contact('Morgan Dempsey', { dayToDay: true, reportsTo: ['John Dennehy'] }),
    contact('Herb Tracy'),
    contact('John Dennehy', { reportsTo: ['Herb Tracy'] }),
  ]);
  check('a chain nests all the way down',
    chain.map(c => `${c.depth}:${c.name}`).join(' | '),
    '0:Herb Tracy | 1:John Dennehy | 2:Morgan Dempsey');

  // Two people who each report to the other is a mis-entry, not a loop to
  // follow: the walk has to end.
  const cycle = orderContacts([
    contact('A', { reportsTo: ['B'] }),
    contact('B', { reportsTo: ['A'] }),
  ]);
  check('mutual managers do not hang the page', cycle.length, 2);

  // The team replaced the phone column.
  check('the team rides on the contact',
    orderContacts([contact('T', { team: '  Workplace  ' })])[0].team, 'Workplace');
  check('and a contact with no team carries an empty one',
    orderContacts([contact('T')])[0].team, '');

  // A row with neither a name nor an email is a HubSpot husk, not a person.
  check('an empty contact is left out',
    orderContacts([{ title: 'Director' }, contact('Real Person')]).length, 1);
}

// ---- what they buy, by bucket -------------------------------------------
{
  const m = onePagerModel(full);
  const groups = m.services.groups;
  check('services are grouped by bucket', groups.length, 3);
  check('the buckets are alphabetical', groups[0].bucket, 'DATA');
  check('with several services under one', groups[0].items.join(', '), 'Bill Pay, Invoice collection');
  // Leftovers do not lead a list.
  check('the catch-all sorts last', groups[groups.length - 1].bucket, 'Other services');
  check('and holds the unfiled one', groups[groups.length - 1].items.join(','), 'Loose Service');
  check('a book with no categories puts everything in the catch-all',
    groupServices(['A', 'B'], null)[0].bucket, 'Other services');
  check('items inside a bucket are alphabetical',
    groupServices(['Zed', 'Alpha'], () => 'X')[0].items.join(','), 'Alpha,Zed');
}

// ---- how long they have been a client ------------------------------------
// The EARLIEST original contract start, not the current term's: "client
// since" is when the relationship began, and a renewal that started last
// March answers a different question entirely.
{
  check('the earliest contract wins',
    clientSince(['2021-04-01', '2019-08-15', '2023-01-09']).getFullYear(), 2019);
  check('blanks are skipped, not read as the beginning of time',
    clientSince(['', '2021-04-01']).getFullYear(), 2021);
  check('so is anything unparseable', clientSince(['not a date', '2021-04-01']).getFullYear(), 2021);
  check('Date objects are accepted alongside strings',
    clientSince([new Date('2018-02-02'), '2021-04-01']).getFullYear(), 2018);
  check('no dates at all reads as null', clientSince([]), null);
  check('and so does a client whose deals are all blank', clientSince(['', null]), null);

  const m = onePagerModel({ ...full, contractDates: ['2021-04-01', '2019-08-15'] });
  check('the page carries it as a month and year', m.clientSince.label, 'Aug 2019');
  check('a client with no deals carries nothing', onePagerModel(full).clientSince, null);

  const xml = onePagerDocumentXml(m);
  check('it is on the page beside the owners', xml.includes('CLIENT SINCE'), true);
  check('with the date', xml.includes('Aug 2019'), true);
  // A missing date here means the Deals tab has nothing for this client,
  // which is a different gap from an unowned account and sends the reader
  // somewhere else.
  check('and says which gap it is when there is none',
    onePagerDocumentXml(onePagerModel(full)).includes('No contract on file'), true);
}

// ---- one page ------------------------------------------------------------
{
  const many = Array.from({ length: MAX_CONTACTS + 9 }, (_, i) => contact(`Person ${String(i).padStart(2, '0')}`));
  const m = onePagerModel({ ...full, contacts: many });
  check('the contact list is capped', m.contacts.shown.length, MAX_CONTACTS);
  check('and the rest are counted, not dropped silently', m.contacts.hidden, 9);
  check('the total is still the truth', m.contacts.total, MAX_CONTACTS + 9);

  // Services are budgeted by the LINES they print, because a bucket heading
  // costs a line whatever sits under it. Lines rather than a count: even a
  // single bucket spends one before its first service, so a count cap on
  // top of this could never bind.
  //
  // But the budget is not a cap. A book that overruns it is RESET, not cut:
  // the bullets become comma lists under the same headings, a line carries
  // three or four services instead of one, and the whole book fits. That
  // matters more here than anywhere else on the page - "In scope today"
  // exists to answer what we already do for these people, and an answer
  // that quietly omits seven of the fifteen is not an answer.
  // Long enough to overrun the budget this page actually has, which is
  // worked out from the contacts and opps above rather than fixed.
  const services = Array.from({ length: 200 }, (_, i) => `Service ${i}`);
  const oneBucket = onePagerModel({ ...full, services, bucketOf: () => 'Bucket' });
  check('a book too long to bullet is set in commas instead', oneBucket.services.mode, 'commas');
  check('and every service survives the change', oneBucket.services.hidden, 0);
  check('which is more than the bullets could have held',
    oneBucket.services.shown.length > MAX_SERVICE_LINES, true);

  // A book that fits keeps the bullets, which are the better read. The
  // fallback is for when it is that or losing services, not the default.
  const few = onePagerModel({ ...full, services: ['Bill Pay', 'GHG Reporting'], bucketOf });
  check('a short book stays bulleted', few.services.mode, 'bullets');
  check('with nothing hidden', few.services.hidden, 0);
  const bulletLines = few.services.groups.reduce((n, g) => n + g.lines, 0);
  check('inside the budget', bulletLines <= MAX_SERVICE_LINES, true);
  check('and the groups carry the lines they cost, for the column split',
    few.services.groups.every(g => g.lines === g.items.length + 1), true);

  // The real shape this was built for: fifteen services across four
  // buckets, which is a mid-sized account and was the case that printed
  // "+ 7 more sold."
  const real = onePagerModel({
    ...full,
    services: ['Client sends invoices', 'Invoice recalculation', 'Invoice variance testing',
      'Manual data upload', 'UPRs', 'Comp GHG', 'GHG', 'Scope 3 estimates', 'Bill payment',
      'Utility bill audit', 'Rate analysis', 'Tariff review', 'Budget forecasting',
      'Accrual reporting', 'Invoice recalculation - light'],
    bucketOf: (n) => (/invoice|upload|sends/i.test(n) ? 'DATA'
      : /GHG|Scope 3/i.test(n) ? 'GHG Reporting'
        : /UPR/i.test(n) ? 'Efficiency' : 'Bill Management'),
  });
  check('a mid-sized book lists every service it sold', real.services.hidden, 0);
  check('inside the budget this page had',
    real.services.groups.reduce((n, g) => n + g.lines, 0) <= real.services.budget, true);
  // Fifteen services now BULLET rather than run together: the budget grew
  // when the page's own furniture shrank, and bullets are the better read
  // whenever they fit. The comma set is the fallback below, not the default.
  check('a mid-sized book gets the bullets', real.services.mode, 'bullets');
  const realXml = onePagerDocumentXml(real);
  check('with no count of what was left out, because none was',
    realXml.includes('more sold.'), false);
  const commaXml = onePagerDocumentXml(oneBucket);
  // Several services to a line, in one paragraph Word wraps - that is the
  // whole point of the comma set. (The book is sorted, so the run reads
  // "Service 0, Service 1, Service 10".)
  check('and a book past the budget prints run together rather than one per line',
    /Service \d+, Service \d+, Service \d+/.test(commaXml), true);

  // Past even the comma budget - a book no arrangement fits - the section
  // still owns up to what it left out rather than trailing off.
  const huge = onePagerModel({
    ...full,
    services: Array.from({ length: 120 }, (_, i) => `Long service name number ${i}`),
    bucketOf: (n) => `Bucket ${n.slice(-2)}`,
  });
  check('a book nothing could fit is still counted, not trailed off',
    huge.services.shown.length + huge.services.hidden, 120);
  check('something is left on the page', huge.services.shown.length > 0, true);
  check('and it stays inside the budget',
    huge.services.groups.reduce((n, g) => n + g.lines, 0) <= huge.services.budget, true);

  // ---- the budget is the page's, not a constant ---------------------
  // This is what went wrong before: the number was measured once on a full
  // page, the page then lost its band, its second opp line, two heading
  // counts and its footer, and the number stayed put. A book of fifteen
  // printed twelve with five and a half inches of white underneath.
  //
  // So the budget moves with the page. A sheet with two contacts and one
  // opp has more room for services than one with five and four, and these
  // hold that relationship rather than any particular number.
  const roomy = onePagerModel({
    ...full, contacts: [contact('Solo')], opps: [opp('One')],
    services: ['A'], bucketOf: () => 'B',
  });
  const crowded = onePagerModel({
    ...full,
    contacts: ['A', 'B', 'C', 'D', 'E'].map(n => contact(n)),
    opps: ['a', 'b', 'c', 'd'].map(n => opp(n)),
    services: ['A'], bucketOf: () => 'B',
    notes: 'A note long enough to take a couple of lines of the page, which is room the services do not get. '.repeat(2),
  });
  check('a emptier page gives the services more room',
    roomy.services.budget > crowded.services.budget, true);
  check('and a crowded one never starves them below the old fixed budget',
    crowded.services.budget >= MAX_SERVICE_LINES, true);
  // The fifteen-service book in the report: every one of them, bulleted.
  check('the book that was being cut now fits whole', real.services.hidden, 0);

  // A bulleted service that is too wide for its column wraps, and the
  // budget has to know: charging every name one line is what let a budget
  // of a hundred print a section fifty rows deep and run the page over.
  const longName = 'Invoice variance testing and recalculation - light';
  const wrapped = cappedServices([longName], () => 'Bucket', 100);
  check('a name too wide for the column costs the line it wraps onto',
    wrapped.groups[0].lines, 1 + Math.ceil(longName.length / BULLET_CHARS_PER_LINE));
  check('and a short one costs a single line',
    cappedServices(['GHG'], () => 'Bucket', 100).groups[0].lines, 2);

  // A bucket that only half fits keeps what fits: dropping it whole would
  // read as "we sell nothing in Compliance here", which is a different and
  // wrong claim.
  const wide = 'x'.repeat(CHARS_PER_LINE);
  const straddle = cappedServices(
    Array.from({ length: 14 }, (_, i) => `${wide}${i}`).concat('b1'),
    (n) => (n === 'b1' ? 'B' : 'A'),
  );
  check('a bucket that half fits keeps the half', straddle.groups[0].items.length > 0, true);
  check('and no bucket is printed with nothing under it',
    straddle.groups.every(g => g.items.length > 0), true);
  check('the rest are counted', straddle.shown.length + straddle.hidden, 15);

  const opps = Array.from({ length: MAX_OPPS + 4 }, (_, i) => opp(`Opp ${i}`));
  const om = onePagerModel({ ...full, opps });
  check('open opps are capped too', om.opps.shown.length, MAX_OPPS);
  check('and counted', om.opps.hidden, 4);
}

// ---- the empty states ----------------------------------------------------
// A blank account is the common case for a new prospect, and each blank has
// to say WHICH blank it is rather than leaving a gap that reads as a broken
// export.
{
  const xml = onePagerDocumentXml(onePagerModel({ company: 'Nobody Inc', generatedAt: AT }));
  check('no contacts says so', xml.includes('No contacts on file'), true);
  check('nothing open says so', xml.includes('Nothing open on this account right now'), true);
  check('nothing sold says so', xml.includes('Nothing sold on this account yet'), true);
  check('an unassigned owner says so rather than showing a gap',
    (xml.match(/Not assigned/g) || []).length, 2);
  check('an entirely empty model still builds a document',
    onePagerDocumentXml(onePagerModel()).includes('<w:body>'), true);
}

// ---- the document ---------------------------------------------------------
{
  const xml = onePagerDocumentXml(onePagerModel(full));
  check('it is WordprocessingML, not HTML', xml.startsWith('<?xml'), true);
  check('with a body', xml.includes('<w:document'), true);
  // The band itself is asserted against the header part (see above); what
  // the body has to keep is the brand green on the boxes it still draws.
  check('the body still shades its own cells', xml.includes('<w:shd'), true);
  check('the contacts are a table', xml.includes('<w:tbl>'), true);
  check('the day-to-day contact is marked', xml.includes('DAY TO DAY'), true);
  // The decision-maker marker is gone from this table: who signs is not
  // what the page is asked, and the chip was competing with the one thing
  // it is - who to call.
  check('the decision maker is not marked', xml.includes('&gt;DM&lt;') || xml.includes('  DM'), false);
  check('nor promised in the legend', xml.includes('DM = decision maker'), false);
  // Drawn under his row, so the arrow and the indent say it instead.
  check('a manager on the page is not also named in words',
    xml.includes('reports to Ben Carter'), false);
  check('the report is indented under him', xml.includes('<w:ind w:left="200"'), true);
  check('with an arrow turning down to them', xml.includes('\u21B3'), true);
  // A manager the table could not draw is still named, or the line would
  // be lost entirely.
  check('a manager off the list is named in words',
    onePagerDocumentXml(onePagerModel({
      ...full,
      contacts: [contact('Solo', { reportsTo: ['Someone Elsewhere'] })],
    })).includes('reports to Someone Elsewhere'), true);
  // The phone column is gone; the team is what stands in its place. The
  // email went the same way: every one of them is the same pattern on the
  // same domain, and the name is a link to the person now.
  check('the team is a column', xml.includes('TEAM'), true);
  check('and the phone is not', xml.includes('PHONE'), false);
  check('nor the email', xml.includes('>EMAIL<') || xml.includes('EMAIL<'), false);
  // The legend under the heading is gone: what the shading and the indents
  // mean is legible from the table itself.
  check('the heading carries no legend', xml.includes('shaded = day to day'), false);
  check('nor the indent note', xml.includes('indented = reports to'), false);
  check('the bucket heads the bullets', xml.includes('DATA'), true);
  check('services are bulleted', xml.includes('•'), true);
  check('with a hanging indent so a long name lines up', xml.includes('<w:ind '), true);
  check('the open opp is on the page', xml.includes('Scope 3 estimates'), true);
  check('the closed one is not', xml.includes('Closed scope'), false);
  // The scope IS the opportunity column. A BFO opp name is a coded string
  // built for a CRM's uniqueness rules - the part a reader wants, what work
  // is being sold, is buried in the middle of it - and the Scope field says
  // that on its own, so the coded name is not printed at all.
  check('the scope of services names the opp',
    xml.includes('Scope 3 estimates'), true);
  check('and the coded BFO name is not on the page',
    xml.includes('Chiller replacement'), false);
  // ---- what the section headings say, and what they do not ----------
  // A heading that counts what is under it duplicates a list the reader is
  // already looking at. Both headings stand on their own now.
  const headingNote = (label) => {
    const i = xml.indexOf(label);
    return i < 0 ? '(missing)' : xml.slice(i, i + 400).replace(/<[^>]*>/g, '').slice(0, 40);
  };
  check('the opportunities heading carries no count',
    /opens?\b/.test(headingNote('OPEN OPPORTUNITIES')), false);
  check('the services heading is Current services',
    xml.includes('CURRENT SERVICES'), true);
  check('and the old wording is gone', xml.includes('IN SCOPE TODAY'), false);
  check('and it carries no count',
    /services? sold/.test(headingNote('CURRENT SERVICES')), false);

  // ---- the opportunity columns --------------------------------------
  const oppHead = ['OPPORTUNITY', 'STAGE', 'AMOUNT', 'CLOSE'].filter(h => xml.includes(h));
  check('the opps table has three columns, close gone', oppHead.join(), 'OPPORTUNITY,STAGE,AMOUNT');

  check('the page is Letter with one-inch margins',
    xml.includes('<w:pgSz w:w="12240" w:h="15840"/>'), true);
  // Every table cell needs a paragraph or Word calls the file corrupt.
  check('no cell is left without a paragraph', /<w:tc><w:tcPr>[\s\S]*?<\/w:tcPr><\/w:tc>/.test(xml), false);
}

// ---- the schema is a SEQUENCE, not a set ---------------------------------
// The children of w:pPr and w:tcPr have a required order. Word does not
// sort them: an out-of-order child is "unreadable content" and a refusal
// to open the file. There is no way to see that from here - no Word, no
// validator - so the order is asserted directly, and this is the test that
// stands between a clean-looking document and one that opens on somebody
// else's laptop as an error dialog.
{
  const xml = onePagerDocumentXml(onePagerModel({
    ...full,
    // A paragraph carrying every optional child at once, which is the only
    // way the full ordering is exercised.
    notes: 'x',
  }));
  const order = (block, names) => {
    const at = names.map(n => block.indexOf(`<w:${n}`));
    return at.filter(i => i >= 0).every((v, i, a) => i === 0 || a[i - 1] < v);
  };
  const pPrs = [...xml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)].map(m => m[1]);
  check('every paragraph has its children in schema order',
    pPrs.every(b => order(b, ['pBdr', 'shd', 'spacing', 'ind', 'jc'])), true);
  check('and there are paragraphs carrying several of them',
    pPrs.some(b => (b.match(/<w:/g) || []).length >= 3), true);

  const tcPrs = [...xml.matchAll(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/g)].map(m => m[1]);
  check('every cell has its children in schema order',
    tcPrs.every(b => order(b, ['tcW', 'tcBorders', 'shd', 'tcMar', 'vAlign'])), true);
  check('and the shaded ones are exercised',
    tcPrs.some(b => b.includes('<w:shd')), true);

  // w:tcBorders is a sequence too: top, left, bottom, right.
  const borders = [...xml.matchAll(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/g)].map(m => m[1]);
  check('cell borders are in order',
    borders.every(b => order(b, ['top', 'left', 'bottom', 'right'])), true);

  // A run's properties are a sequence as well: rFonts, b, i, color, sz.
  const rPrs = [...xml.matchAll(/<w:rPr>([\s\S]*?)<\/w:rPr>/g)].map(m => m[1]);
  check('run properties are in order',
    rPrs.every(b => order(b, ['rFonts', 'b', 'i', 'color', 'sz'])), true);

  // sectPr closes the body and must be the last thing in it.
  check('the section properties come last',
    /<w:sectPr>[\s\S]*<\/w:sectPr><\/w:body>/.test(xml), true);
}

// A table whose rows carry a different number of cells from its grid
// renders in Word as a mangled thing with columns sliding under each other.
// It is easy to do - the header row and the body rows are built separately
// here - and nothing else in this file would notice.
{
  const xml = onePagerDocumentXml(onePagerModel(full));
  const tables = [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(m => m[1]);
  check('the page is built from several tables', tables.length >= 4, true);
  const mismatched = tables.filter((t) => {
    const cols = (t.match(/<w:gridCol /g) || []).length;
    const rows = [...t.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map(m => m[1]);
    return rows.some(r => (r.match(/<w:tc>/g) || []).length !== cols);
  });
  check('every row carries exactly as many cells as its grid has columns',
    mismatched.length, 0);
  // The widths have to add up to the text column, or Word lays the table
  // out at some other width and the right edge stops lining up.
  const widths = tables.map(t => [...t.matchAll(/<w:gridCol w:w="(\d+)"/g)]
    .reduce((n, m) => n + Number(m[1]), 0));
  check('and every table is the width of the page body',
    widths.every(w => Math.abs(w - 9360) <= 2), true);
}

// ---- page two: the org chart ---------------------------------------------
// The mapping the chart is drawn from, in the shape the popup's Divisions
// section hands it over: a tree of boxes from buildDivisionTree, the people
// assigned to each, and settings.contactReportsTo.
const TREE = {
  id: 'p1', company: 'BRE Hotels & Resorts', missing: false,
  children: [
    {
      id: 'd1', company: 'Hilton Select', missing: false,
      children: [{ id: 'd3', company: 'Northeast', missing: true, children: [] }],
    },
    { id: 'd2', company: 'Resorts Group', missing: false, children: [] },
  ],
};
const BOXES = {
  p1: [{ id: '1', name: 'Ben Carter', jobtitle: 'CFO' }, { id: '2', name: 'Mia Lopez' }],
  d1: [{ id: '4', name: 'Ray Osei' }, { id: '5', name: 'Nina Patel' }],
  d2: [{ id: '6', name: 'Tom Reed' }],
  d3: [{ id: '7', name: 'Sam Vale' }],
};
// 2 under 1, 5 under 4, and 7 under someone on ANOTHER box.
const REPORTS = { 2: ['1'], 5: ['4'], 7: ['4'] };
const DETAIL = { 1: { decisionMaker: true }, 2: { dayToDay: true }, 6: { left: true } };
const orgInput = (over = {}) => ({
  tree: TREE,
  contactsOf: (id) => BOXES[id] || [],
  companyContacts: [{ id: '8', name: 'Priya Raman' }, { id: '1', name: 'Ben Carter' }],
  reportsTo: REPORTS,
  nameById: new Map(Object.values(BOXES).flat().map(c => [c.id, c.name])),
  detailOf: (c) => ({ title: c.jobtitle || '', ...(DETAIL[c.id] || {}) }),
  ...over,
});
const FLAT = { id: 'p1', company: 'Acme', missing: false, children: [] };
const at = (chart, name) => chart.rows.find(r => r.kind === 'person' && r.name === name);

{
  const chart = orgChartRows(orgInput({ company: 'BRE Hotels & Resorts', parents: ['Blackstone'] }));

  check('the company is the root box', chart.rows[0].kind, 'division');
  check('and it is marked as the root', chart.rows[0].root, true);
  check('divisions under it are counted', chart.divisions, 3);
  check('what it rolls up into is carried', chart.parents.join(), 'Blackstone');

  // Nesting IS the reporting line - that is the whole point of the page.
  check('a report sits one level under their manager',
    at(chart, 'Mia Lopez').depth - at(chart, 'Ben Carter').depth, 1);
  check('a division sits under the company', chart.rows.find(r => r.name === 'Hilton Select').depth, 1);
  check('and a sub-division under the division',
    chart.rows.find(r => r.name === 'Northeast').depth, 2);
  check('a company the tracker has lost is still drawn, flagged',
    chart.rows.find(r => r.name === 'Northeast').missing, true);

  // A manager the chart cannot draw above somebody is the one case where
  // nesting has nothing to say, so the row has to say it instead.
  check('a manager on another box is named on the row',
    at(chart, 'Sam Vale').managers.join(), 'Ray Osei');
  check('a manager drawn directly above is NOT repeated on the row',
    at(chart, 'Mia Lopez').managers.length, 0);
  // The elbow on the page means "reports to the line above". Somebody at
  // the top of a box is indented because the box is, and marking them as a
  // report would have them answering to the heading above them.
  check('somebody drawn under their manager is marked as a report',
    at(chart, 'Mia Lopez').reportsUnder, true);
  check('and the top of a box is not', at(chart, 'Ben Carter').reportsUnder, false);
  check('nor is the first person on a division',
    at(chart, 'Ray Osei').reportsUnder, false);

  // Everyone appears once. Ben Carter is both assigned to the root box and
  // on the company's contact list, which is the ordinary case.
  check('somebody on a box and on the contact list is drawn once',
    chart.rows.filter(r => r.kind === 'person' && r.name === 'Ben Carter').length, 1);
  check('a contact no division claimed still reaches the page',
    !!at(chart, 'Priya Raman'), true);
  check('everybody is accounted for', chart.people, 7);

  check('the standings page one marks are carried', at(chart, 'Ben Carter').decisionMaker, true);
  check('and so is the day-to-day', at(chart, 'Mia Lopez').dayToDay, true);
  // A leaver is part of the structure: the seat existed and the reader is
  // about to ask for them by name.
  check('somebody who has left is kept, marked', at(chart, 'Tom Reed').left, true);
}

// Teams are the coarser grouping, with reporting lines drawn inside one -
// the same order the popup buckets by.
{
  const chart = orgChartRows({
    company: 'T', tree: FLAT, contactsOf: () => [],
    companyContacts: [{ id: '1', name: 'Fin' }, { id: '2', name: 'Ops' }],
    teamOf: (c) => (c.id === '1' ? 'Finance' : 'Operations'),
  });
  check('a team gets a heading', chart.rows.filter(r => r.kind === 'team').map(r => r.name).join(), 'Finance,Operations');
  check('and the people sit under it', at(chart, 'Fin').depth > chart.rows.find(r => r.kind === 'team').depth, true);
}
{
  const chart = orgChartRows({
    company: 'T', tree: FLAT, contactsOf: () => [],
    companyContacts: [{ id: '1', name: 'Fin' }, { id: '2', name: 'Ops' }],
  });
  check('a box where nobody carries a team gets no headings',
    chart.rows.some(r => r.kind === 'team'), false);
}

// ---- page two only exists when it says something --------------------------
{
  const bare = { tree: FLAT, contactsOf: () => [], companyContacts: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] };
  check('a flat list with no lines and no divisions is not a chart',
    orgChartRows(bare).hasStructure, false);
  check('one reporting line makes it one',
    orgChartRows({ ...bare, reportsTo: { 2: ['1'] } }).hasStructure, true);
  check('so does a division', orgChartRows({ ...bare, tree: TREE }).hasStructure, true);
  check('so does a parent above it', orgChartRows({ ...bare, parents: ['Blackstone'] }).hasStructure, true);

  check('and the model drops a chart that says nothing',
    onePagerModel({ company: 'Acme', orgChart: bare }).orgChart, null);
  check('a caller that passes none is unchanged',
    onePagerModel({ company: 'Acme' }).orgChart, null);
}

// ---- the cap -------------------------------------------------------------
// Page two is one page too. Capped on printed ROWS rather than on people,
// because a heading costs a line whatever sits under it.
{
  const wide = {
    id: 'p1', company: 'Big', missing: false,
    children: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, company: `Division ${i}`, missing: false, children: [] })),
  };
  const boxes = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [
    `d${i}`, [{ id: `${i}a`, name: `P${i}a` }, { id: `${i}b`, name: `P${i}b` }],
  ]));
  const chart = orgChartRows({ company: 'Big', tree: wide, contactsOf: (id) => boxes[id] || [], companyContacts: [] });
  check('the chart stops at the cap', chart.rows.length <= MAX_ORG_ROWS, true);
  check('it printed fewer people than it found', chart.shown < chart.people, true);
  check('and owns up to every one it left out', chart.shown + chart.hidden, chart.people);
  // A cut landing just after a heading would leave a division with nobody
  // under it, which reads as a division nobody covers.
  check('no heading is left stranded at the bottom',
    chart.rows[chart.rows.length - 1].kind, 'person');
  check('the count under the heading describes what actually printed',
    chart.divisions, chart.rows.filter(r => r.kind === 'division' && !r.root).length);
}

// A reporting map that says two people manage each other must not drop
// them both - the same guard buildDivisionContactTree carries.
{
  const chart = orgChartRows({
    company: 'C', tree: FLAT, contactsOf: () => [],
    companyContacts: [{ id: '1', name: 'X' }, { id: '2', name: 'Y' }],
    reportsTo: { 1: ['2'], 2: ['1'] },
  });
  check('mutual managers keep both people', chart.people, 2);
}

// ---- page two in the document --------------------------------------------
{
  const one = onePagerDocumentXml(onePagerModel(full));
  check('an account with no chart gets no page break',
    (one.match(/w:br w:type="page"/g) || []).length, 0);
  // The generated-by line came off the page entirely: it said nothing about
  // the account, and on a sheet handed to somebody it was a footer about
  // the tool rather than about the client.
  check('and no generated-by footer anywhere',
    (one.match(/Internal use|Prospect Tracker/g) || []).length, 0);

  const two = onePagerDocumentXml(onePagerModel({ ...full, orgChart: orgInput() }));
  check('a chart starts a new page', (two.match(/w:br w:type="page"/g) || []).length, 1);
  check('and the chart page carries no footer either',
    (two.match(/Internal use|Prospect Tracker/g) || []).length, 0);
  check('the chart names the divisions', two.includes('Hilton Select'), true);
  check('and the people on them', two.includes('Nina Patel'), true);
  check('a manager on another box is named', two.includes('Ray Osei'), true);
  check('page one is untouched by page two',
    two.startsWith(one.slice(0, one.indexOf('<w:sectPr>'))), true);
  // Indentation is what draws the hierarchy, so it has to be in the file.
  check('the chart is indented', /<w:ind w:left="[1-9]/.test(two), true);
}
// The paragraph-ordering sweep below has to see page two's paragraphs too:
// they are the only ones in the document that carry w:ind.
{
  const xml = onePagerDocumentXml(onePagerModel({ ...full, notes: 'x', orgChart: orgInput() }));
  const order = (block, names) => {
    const idx = names.map(n => block.indexOf(`<w:${n}`));
    return idx.filter(i => i >= 0).every((v, i, a) => i === 0 || a[i - 1] < v);
  };
  const pPrs = [...xml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)].map(m => m[1]);
  check('page two keeps its paragraph children in schema order',
    pPrs.every(b => order(b, ['pBdr', 'shd', 'spacing', 'ind', 'jc'])), true);
  check('and the indented ones are exercised',
    pPrs.some(b => b.includes('<w:ind')), true);
}

// ---- text Word would refuse ----------------------------------------------
// Company names, titles and notes are typed by people and synced from
// HubSpot, and go straight into XML. An unescaped ampersand does not
// render as "&" here - it makes the file unopenable.
{
  check('an ampersand is escaped', xmlEsc('A & B'), 'A &amp; B');
  check('so are angle brackets', xmlEsc('<b>'), '&lt;b&gt;');
  check('and quotes', xmlEsc(`"x" 'y'`), '&quot;x&quot; &apos;y&apos;');
  check('control characters are dropped, not escaped',
    xmlEsc(`a${String.fromCharCode(7)}b`), 'ab');
  check('tabs and newlines survive',
    xmlEsc('a\tb\nc'), 'a\tb\nc');
  const model = onePagerModel({ company: 'A & B <script>', generatedAt: AT });
  // The company name is on the band, which is the header part now - and an
  // unescaped & there makes the file just as unopenable as one in the body.
  check('a company name cannot break the header',
    onePagerHeaderXml(model).includes('A &amp; B &lt;script&gt;'), true);
  check('nor the document', onePagerDocumentXml(model).includes('<w:body>'), true);
}

// ---- the file that lands in Downloads ------------------------------------
{
  check('named for the company', onePagerFileName('BRE Hotels'), 'BRE Hotels - Account summary.docx');
  check('characters Windows refuses are taken out',
    onePagerFileName('A/B: C*D?'), 'A_B_ C_D_ - Account summary.docx');
  check('a company with no name still gets a file',
    onePagerFileName(''), 'Company - Account summary.docx');
}

// ---- the name is a link to the person -------------------------------------
//
// A link in Word is a relationship id in the paragraph and the URL in the
// relationships part, so the two have to be written from the same walk.
// Every id the document points at has to be defined, or the file will not
// open at all - which is what the last check here is for.
{
  check('a full URL is taken as it is',
    linkedinUrl('https://www.linkedin.com/in/herb'), 'https://www.linkedin.com/in/herb');
  check('a bare handle becomes one', linkedinUrl('herb-tracy-123'), 'https://www.linkedin.com/in/herb-tracy-123');
  check('and so does a URL with no scheme', linkedinUrl('linkedin.com/in/herb'), 'https://www.linkedin.com/in/herb');
  check('www is not mistaken for a handle', linkedinUrl('www.linkedin.com/in/herb'), 'https://www.linkedin.com/in/herb');
  check('nothing is nothing', linkedinUrl('  '), '');
  // The one value on this page a reader CLICKS. A document that carries
  // somebody else's javascript: URL into a meeting is a different kind of
  // object from a sheet of contact details.
  check('a script URL is never a profile', linkedinUrl('javascript:alert(1)'), '');
  check('nor is a mailto', linkedinUrl('mailto:a@b.com'), '');

  const model = onePagerModel({
    ...full,
    contacts: [
      contact('Herb Tracy', { linkedin: 'herb-tracy' }),
      contact('John Dennehy', { reportsTo: ['Herb Tracy'], linkedin: 'herb-tracy' }),
      contact('Nobody Linked', { nickname: 'Nob' }),
    ],
  });
  const { documentXml, relsXml } = onePagerParts(model);

  check('the linked name is a hyperlink', /<w:hyperlink r:id="rId\d+">/.test(documentXml), true);
  check('pointing at the profile', relsXml.includes('Target="https://www.linkedin.com/in/herb-tracy"'), true);
  check('as an external target', relsXml.includes('TargetMode="External"'), true);
  // Two people linked to the same profile is one relationship, not two.
  check('the same profile is one relationship',
    (relsXml.match(/relationships\/hyperlink/g) || []).length, 1);
  check('a contact with no profile is not linked',
    (documentXml.match(/<w:hyperlink/g) || []).length, 2);
  check('what they go by is beside the name', documentXml.includes('(Nob)'), true);

  // The integrity check: every id the document points at is defined.
  const used = new Set([...documentXml.matchAll(/r:id="(rId\d+)"/g)].map(x => x[1]));
  const defined = new Set([...relsXml.matchAll(/Id="(rId\d+)"/g)].map(x => x[1]));
  check('every relationship the document uses exists',
    [...used].filter(id => !defined.has(id)).join(','), '');
  check('and the header is still one of them', used.has('rId1'), true);

  // Without a collector there is nowhere to record a URL, so a link would
  // be an id nothing defines - the document says the name plainly instead.
  check('a body built with no collector carries no dangling ids',
    onePagerDocumentXml(model).includes('<w:hyperlink'), false);
}

// ---- the green band is the page header -----------------------------------
//
// It used to be the first thing in the body, which put the page's top
// margin above it as a white strip and let it be pushed down the page.
// As a header part it is drawn in the margin itself, at the top of every
// page. The wiring is four things that all have to agree, and Word's
// answer to any one of them being wrong is to refuse the file.
{
  const model = onePagerModel({ ...full, company: 'BlackRock' });
  const doc = onePagerDocumentXml(model);
  const hdr = onePagerHeaderXml(model);

  check('the band is in the header part', hdr.includes('ACCOUNT SUMMARY'), true);
  check('with the company on it', hdr.includes('BlackRock'), true);
  check('and the lockup', hdr.includes('LIFE IS ON'), true);
  check('the header part is a header', hdr.includes('<w:hdr'), true);
  // A header ending in a table leaves Word joining the band to the body.
  check('it ends in a paragraph', /<\/w:p>\s*<\/w:hdr>/.test(hdr), true);

  check('the body no longer draws it', doc.includes('ACCOUNT SUMMARY'), false);
  check('the body starts with the owners', doc.indexOf('CDM') < doc.indexOf('KEY CONTACTS'), true);

  // 1. the section points at a header, 2. by an id the document's own
  // relationships define, 3. as a part the package declares, 4. in a
  // document that declares the namespace r:id is in.
  check('the section references a header', doc.includes('<w:headerReference w:type="default" r:id="rId1"/>'), true);
  check('the relationship is there to find', DOCUMENT_RELS_XML.includes('Id="rId1"') && DOCUMENT_RELS_XML.includes('Target="header1.xml"'), true);
  check('and it is a header relationship', DOCUMENT_RELS_XML.includes('/relationships/header'), true);
  check('the part is declared', CONTENT_TYPES_XML.includes('/word/header1.xml'), true);
  check('with the header content type', CONTENT_TYPES_XML.includes('wordprocessingml.header+xml'), true);
  check('the r namespace is declared', doc.includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'), true);

  // The children of w:sectPr are a schema SEQUENCE and the header
  // references open it. Out of order is "unreadable content".
  check('the header reference comes before the page size',
    doc.indexOf('<w:headerReference') < doc.indexOf('<w:pgSz'), true);

  // The band is drawn `w:header` from the top of the page and the body
  // starts at `w:top`: the first has to be the smaller, or the band lands
  // on top of the first row of the page.
  const header = Number(/w:header="(\d+)"/.exec(doc)?.[1]);
  const top = Number(/w:top="(\d+)"/.exec(doc)?.[1]);
  check('the band starts above the body', header < top, true);
  check('and not so high a printer cannot reach it', header >= 180, true);
}

// ---- what the zip actually contains --------------------------------------
// The three parts a .docx cannot open without. This is the assertion that
// would have caught the altChunk: a file with no word/document.xml is not a
// Word document, whatever the extension says.
{
  const bytes = await buildOnePagerDocx(onePagerModel(full));
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
  check('the content types are declared', names.includes('[Content_Types].xml'), true);
  check('the package points at the document', names.includes('_rels/.rels'), true);
  check('and the document is a real part', names.includes('word/document.xml'), true);
  check('the header is a part of its own', names.includes('word/header1.xml'), true);
  check('and the document knows how to find it',
    names.includes('word/_rels/document.xml.rels'), true);
  check('there is no altChunk left anywhere',
    names.some(n => n.includes('afchunk')), false);
  const doc = await zip.file('word/document.xml').async('string');
  check('the text is IN the document, not in an attachment',
    doc.includes('CLIENT MANAGER'), true);
  check('including the opp', doc.includes('Scope 3 estimates'), true);
  check('and the day-to-day marker', doc.includes('DAY TO DAY'), true);
  const hdrPart = await zip.file('word/header1.xml').async('string');
  check('the band travels in the header part', hdrPart.includes('ACCOUNT SUMMARY'), true);
  check('named for the company', hdrPart.includes('BRE Hotels &amp; Resorts'), true);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
