// The company one-pager - who we know, what they already buy, who owns the
// account. Plain Node - no test framework (the project has none). Run:
//   node scripts/companyOnePager.test.mjs
//
// Two things decide whether this document is worth anything.
//
// The first is that it stays ONE page. A handover sheet that runs to three
// is a document nobody reads in the five minutes it exists for, so the
// lists are capped and the overflow is counted rather than printed. A cap
// that silently dropped the rest would be worse than no cap: the reader
// would have no way to know the account has fourteen more contacts.
//
// The second is that it goes into Word, which is not a browser. Word's
// HTML import honours tables, inline styles and bgcolor; it ignores flex,
// grid, and most of what makes a page look right in Chrome. A layout that
// drifts back to divs-and-flexbox renders as a stack of unstyled text in
// the file anybody actually opens, and it looks perfectly fine in every
// preview short of Word itself.
import {
  buildCompanyOnePagerHtml, onePagerFileName, orderContacts,
  MAX_CONTACTS, MAX_SERVICES,
} from '../src/utils/companyOnePager.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const AT = new Date('2026-09-14T12:00:00Z');
const contact = (name, over = {}) => ({ name, title: 'Director', email: `${name.split(' ')[0].toLowerCase()}@acme.com`, ...over });

const full = {
  company: 'BRE Hotels & Resorts',
  cdm: 'Dan Baldauf',
  clientManager: 'Alex Moreau',
  services: ['Bill Pay', 'GHG Reporting', 'Utility feeds'],
  contacts: [
    contact('Zoe Adams'),
    contact('Ben Carter', { decisionMaker: true }),
    contact('Mia Lopez', { metInPerson: true }),
  ],
  generatedAt: AT,
};

// ---- what the page has to say -------------------------------------------
{
  const html = buildCompanyOnePagerHtml(full);
  check('the company leads the page', html.includes('BRE Hotels &amp; Resorts'), true);
  check('the CDM is named', html.includes('Dan Baldauf'), true);
  check('so is the Client Manager', html.includes('Alex Moreau'), true);
  check('the sold services are listed', html.includes('GHG Reporting'), true);
  check('and counted in the heading', html.includes('3 services sold'), true);
  check('the contacts are listed', html.includes('Ben Carter'), true);
  check('with their titles and emails',
    html.includes('Director') && html.includes('ben@acme.com'), true);
  check('the date is stamped', html.includes('September 14, 2026'), true);
  check('and it says it is internal', html.includes('Internal use'), true);
  // One service reads as one, not "1 services".
  check('a single service is not pluralised',
    buildCompanyOnePagerHtml({ ...full, services: ['Bill Pay'] }).includes('1 service sold'), true);
}

// ---- the empty states ---------------------------------------------------
// A blank account is the common case for a brand-new prospect, and each
// blank has to say which blank it is rather than leaving a gap that reads
// as a broken export.
{
  const bare = buildCompanyOnePagerHtml({ company: 'Nobody Inc', generatedAt: AT });
  check('no contacts says so', bare.includes('No contacts on file'), true);
  check('nothing sold says so', bare.includes('Nothing sold on this account yet'), true);
  check('an unassigned CDM says so rather than showing a gap',
    (bare.match(/Not assigned/g) || []).length, 2);
  check('and the page still renders', bare.includes('Account summary'), true);
  check('an entirely empty call does not throw',
    buildCompanyOnePagerHtml().includes('Account summary'), true);
}

// ---- one page ------------------------------------------------------------
{
  const many = Array.from({ length: MAX_CONTACTS + 7 }, (_, i) => contact(`Person ${String(i).padStart(2, '0')}`));
  const html = buildCompanyOnePagerHtml({ ...full, contacts: many });
  const listed = (html.match(/Person \d\d/g) || []).length;
  check('the contact list is capped', listed, MAX_CONTACTS);
  check('and the rest are counted, not dropped silently', html.includes('+ 7 more'), true);

  const services = Array.from({ length: MAX_SERVICES + 3 }, (_, i) => `Service ${i}`);
  const svcHtml = buildCompanyOnePagerHtml({ ...full, services });
  check('the service list is capped too',
    (svcHtml.match(/Service \d+</g) || []).length, MAX_SERVICES);
  check('with its own count', svcHtml.includes('+ 3 more sold'), true);
  check('and the heading counts them all, not just the shown ones',
    svcHtml.includes(`${MAX_SERVICES + 3} services sold`), true);
}

// ---- who comes first -----------------------------------------------------
// The question a handover sheet is opened with is "who signs", so a tagged
// decision maker leads however the list arrived.
{
  const ordered = orderContacts(full.contacts);
  check('a decision maker is first', ordered[0].name, 'Ben Carter');
  check('then anyone already met in person', ordered[1].name, 'Mia Lopez');
  check('then the rest by name', ordered[2].name, 'Zoe Adams');
  check('and the marker is on the page',
    buildCompanyOnePagerHtml(full).includes('&#183; DM'), true);
  // A row with neither a name nor an email is a HubSpot husk, not a person.
  check('an empty contact is left out',
    orderContacts([{ title: 'Director' }, contact('Real Person')]).length, 1);
}

// ---- Word, not a browser -------------------------------------------------
{
  const html = buildCompanyOnePagerHtml(full);
  check('layout is tables', html.includes('<table'), true);
  check('no flexbox', /display\s*:\s*flex/.test(html), false);
  check('no grid', /display\s*:\s*grid/.test(html), false);
  // Word paints a broken-image placeholder for the `background:` shorthand
  // and ignores colour set on anything but a cell.
  check('fills are bgcolor on cells', html.includes('bgcolor="'), true);
  check('no background shorthand', /background\s*:\s*[^-]/.test(html), false);
  check('it is a whole document, not a fragment', html.startsWith('<!DOCTYPE html>'), true);
}

// ---- the file that lands in Downloads ------------------------------------
{
  check('named for the company', onePagerFileName('BRE Hotels'), 'BRE Hotels - Account summary.docx');
  check('characters Windows refuses are taken out',
    onePagerFileName('A/B: C*D?'), 'A_B_ C_D_ - Account summary.docx');
  check('a company with no name still gets a file',
    onePagerFileName(''), 'Company - Account summary.docx');
}

// ---- untrusted text ------------------------------------------------------
// Company names, titles and notes are typed by people and synced from
// HubSpot. They are written into markup here.
{
  const html = buildCompanyOnePagerHtml({
    company: '<script>bad()</script>',
    contacts: [contact('X', { title: '<b>VP</b>' })],
    notes: 'a & b <img src=x onerror=1>',
    generatedAt: AT,
  });
  check('a company name cannot open a tag', html.includes('<script>bad()'), false);
  check('and is shown as the text it is', html.includes('&lt;script&gt;bad()'), true);
  check('nor can a job title', html.includes('<b>VP</b>'), false);
  check('nor a note', html.includes('<img src=x'), false);
  check('ampersands survive as text', html.includes('a &amp; b'), true);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
