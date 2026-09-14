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
// The second is that it is a REAL Word file. It used to go out through
// html-docx-js, which does not build one - it wraps the HTML in an
// altChunk and leaves Word to convert it on open. Word does; Google Docs,
// Quick Look and most phone viewers do not. The assertions at the bottom
// unzip what the button produces and read the WordprocessingML, because
// the failure mode of getting that wrong is a file that opens blank in
// exactly the places a leave-behind gets opened.
import {
  onePagerModel, onePagerFileName, orderContacts, orderOpps, groupServices, clientSince,
  MAX_CONTACTS, MAX_OPPS, MAX_SERVICE_LINES,
} from '../src/utils/companyOnePager.js';
import { onePagerDocumentXml, buildOnePagerDocx, xmlEsc } from '../src/utils/onePagerDocx.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const AT = new Date('2026-09-14T12:00:00Z');
const contact = (name, over = {}) => ({ name, title: 'Director', email: `${name.split(' ')[0].toLowerCase()}@acme.com`, ...over });
const opp = (name, over = {}) => ({ name, stage: 'Quoting', amount: '$120,000', closeDate: '11/30/2026', active: true, ...over });

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
  opps: [opp('Chiller replacement'), opp('Closed one', { active: false })],
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
    `${m.opps.shown[0].stage}|${m.opps.shown[0].amount}|${m.opps.shown[0].closeDate}`,
    'Quoting|$120,000|11/30/2026');
}

// ---- who to call ---------------------------------------------------------
// The sheet is opened to answer "who do I ring", and that is almost never
// the person who signs - so the day-to-day contact leads, ahead of the
// decision maker.
{
  const ordered = orderContacts(full.contacts);
  check('the day-to-day contact leads', ordered[0].name, 'Mia Lopez');
  check('then whoever signs', ordered[1].name, 'Ben Carter');
  check('then the rest by name', ordered[2].name, 'Zoe Adams');
  check('the reporting line is carried by name, not by id',
    ordered[0].reportsTo.join(','), 'Ben Carter');
  check('someone reporting to nobody carries an empty list',
    ordered[1].reportsTo.length, 0);
  check('a lone manager is accepted unwrapped',
    orderContacts([contact('X', { reportsTo: 'Y' })])[0].reportsTo.join(','), 'Y');
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

  // Services are capped by the LINES they print, because a bucket heading
  // costs a line whatever sits under it. One cap, not two: a count cap on
  // top of it could never bind, since even a single bucket spends a line
  // before its first service.
  const services = Array.from({ length: 20 }, (_, i) => `Service ${i}`);
  const oneBucket = onePagerModel({ ...full, services, bucketOf: () => 'Bucket' });
  check('one bucket spends a line, and the rest is services',
    oneBucket.services.shown.length, MAX_SERVICE_LINES - 1);
  check('the groups carry exactly what is shown',
    oneBucket.services.groups.reduce((n, g) => n + g.items.length, 0), oneBucket.services.shown.length);
  check('and every one left out is counted',
    oneBucket.services.shown.length + oneBucket.services.hidden, services.length);

  // The same services filed one per bucket are twice as tall. This is the
  // shape that ran the page over onto a second one.
  const perBucket = onePagerModel({ ...full, services, bucketOf: (n) => `B ${n}` });
  const linesUsed = perBucket.services.groups.reduce((n, g) => n + g.items.length + 1, 0);
  check('one bucket each is stopped by the same budget', linesUsed <= MAX_SERVICE_LINES, true);
  check('which shows fewer services than a single bucket would',
    perBucket.services.shown.length < oneBucket.services.shown.length, true);
  check('and still counts every one it left out',
    perBucket.services.shown.length + perBucket.services.hidden, services.length);

  // A bucket that only half fits keeps what fits: dropping it whole would
  // read as "we sell nothing in Compliance here", which is a different and
  // wrong claim.
  const straddle = onePagerModel({
    ...full,
    services: Array.from({ length: 10 }, (_, i) => `a${i}`).concat('b1'),
    bucketOf: (n) => (n.startsWith('a') ? 'A' : 'B'),
  });
  check('a bucket that half fits keeps the half', straddle.services.groups[0].items.length > 0, true);
  check('and no bucket is printed with nothing under it',
    straddle.services.groups.every(g => g.items.length > 0), true);

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
  check('the brand band is a shaded cell', xml.includes('w:fill="009530"'), true);
  check('the contacts are a table', xml.includes('<w:tbl>'), true);
  check('the day-to-day contact is marked', xml.includes('DAY TO DAY'), true);
  check('and the decision maker too', xml.includes('DM'), true);
  check('the reporting line is printed under the name',
    xml.includes('reports to Ben Carter'), true);
  check('the bucket heads the bullets', xml.includes('DATA'), true);
  check('services are bulleted', xml.includes('•'), true);
  check('with a hanging indent so a long name lines up', xml.includes('<w:ind '), true);
  check('the open opp is on the page', xml.includes('Chiller replacement'), true);
  check('the closed one is not', xml.includes('Closed one'), false);
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
  const xml = onePagerDocumentXml(onePagerModel({ company: 'A & B <script>', generatedAt: AT }));
  check('a company name cannot break the document', xml.includes('A &amp; B &lt;script&gt;'), true);
}

// ---- the file that lands in Downloads ------------------------------------
{
  check('named for the company', onePagerFileName('BRE Hotels'), 'BRE Hotels - Account summary.docx');
  check('characters Windows refuses are taken out',
    onePagerFileName('A/B: C*D?'), 'A_B_ C_D_ - Account summary.docx');
  check('a company with no name still gets a file',
    onePagerFileName(''), 'Company - Account summary.docx');
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
  check('there is no altChunk left anywhere',
    names.some(n => n.includes('afchunk')), false);
  const doc = await zip.file('word/document.xml').async('string');
  check('the text is IN the document, not in an attachment',
    doc.includes('BRE Hotels &amp; Resorts'), true);
  check('including the opp', doc.includes('Chiller replacement'), true);
  check('and the day-to-day marker', doc.includes('DAY TO DAY'), true);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
