// The company card's "Opps deck" download: which opps make the deck, and
// that the file it writes is a well-formed PowerPoint package.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/oppDeck.test.mjs
//
// The deck is for walking an account (or a PE firm's portfolio) through
// what is live, so the selection is the part that matters most: closed
// opps stay out, the firm's holdings come in whether the link is the
// holdings list, the opp's PE Owner column, or the holding's own record.
//
// Set OPP_DECK_OUT=path.pptx to keep the built deck for a visual check.
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { selectDeckOpps, oppSlideContent, buildOppDeck, oppDeckFilename, xmlEscape, deckStage, deckServiceName, groupScope, scopeSummary } from '../src/utils/oppDeck.js';
import { getServiceCategories } from '../src/utils/serviceCategoriesStore.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const records = [
  { _id: 1, Account: 'Harbor Peak Capital', Stage: 'Lead', Scope: 'Portfolio ESG Reporting', Contact: 'Jane Roe', 'Next Steps': 'Send overview deck' },
  { _id: 2, Account: 'Acme Foods', Stage: 'Quoted', Scope: 'Energy Procurement, Utility Bill Management', Contact: 'Sam Lee, Pat Kim', 'Quoted Amount': '$120,000', Type: 'Private equity', 'Sales Partner': 'Keith', 'Follow Up': '10/29/2026', 'Close Date': '12/15/2026', 'BFO Link': 'SB - SUSUP - New - Recurring', 'Next Steps': 'Follow up on proposal\nSchedule site walk', _nextStepsWaiting: ['Sam', ''] },
  { _id: 3, Account: 'Acme Foods', Stage: 'Sold', Scope: 'Old deal' },
  { _id: 4, Account: 'Blue Dock Logistics', 'PE Owner': 'Harbor Peak Capital', Stage: 'Agreement Sent', Scope: 'Carbon Accounting' },
  { _id: 5, Account: 'Cobalt Labs', Stage: 'Qualifying', Scope: 'Renewables' },
  { _id: 6, Account: 'Unrelated Co', Stage: 'Quoting', Scope: 'Something' },
  { _id: 7, Account: 'Acme Foods', Stage: 'Lead', Scope: 'Demand Response' },
  { _id: 8, Account: 'Acme Foods', Stage: '#N/A', Scope: 'Broken row' },
];
const prospects = [
  { company: 'Cobalt Labs', peOwner: 'Harbor Peak Capital, Other Fund LLC' },
  { company: 'Unrelated Co', peOwner: 'Someone Else' },
];

const picked = selectDeckOpps(records, { company: 'Harbor Peak Capital', owned: [{ name: 'Acme Foods' }], prospects });
check('PE deck: own opps first, then holdings by name, furthest stage first; closed and broken stay out',
  picked.map(p => [p.record._id, p.via, p.owner]),
  [[1, 'direct', ''], [2, 'owned', 'Harbor Peak Capital'], [7, 'owned', 'Harbor Peak Capital'], [4, 'pe', 'Harbor Peak Capital'], [5, 'pe', 'Harbor Peak Capital']]);

check('company with no holdings gets just its own open opps',
  selectDeckOpps(records, { company: 'Acme Foods' }).map(p => p.record._id), [2, 7]);
check('no company, no opps', selectDeckOpps(records, { company: '' }), []);
check('activeOnly: false keeps closed and broken opps, for the popup\'s opp list',
  selectDeckOpps(records, { company: 'Harbor Peak Capital', owned: [{ name: 'Acme Foods' }], prospects, activeOnly: false })
    .filter(p => p.via !== 'direct').map(p => p.record._id).sort((a, b) => a - b), [2, 3, 4, 5, 7, 8]);

const content = oppSlideContent(picked[1], { contactInfo: (name) => (name === 'Sam Lee' ? { title: 'VP Energy' } : null) });
check('slide content: titled by the company, not the BFO name', content.title, 'Acme Foods');
check('slide content: holdings credit their owner', [content.via, content.owner], ['owned', 'Harbor Peak Capital']);
check('slide content: contacts, primary first, titles looked up', content.contacts,
  [{ name: 'Sam Lee', title: 'VP Energy', primary: true }, { name: 'Pat Kim', title: '', primary: false }]);
check('slide content: steps carry their own Waiting On', content.nextSteps,
  [{ text: 'Follow up on proposal', waitingOn: 'Sam', onHold: false }, { text: 'Schedule site walk', waitingOn: '', onHold: false }]);
check('slide content: scope split into items', content.scopeItems, ['Energy Procurement', 'Utility Bill Management']);
check('slide content: target close and the internal fields stay off', content.facts, []);

// Not Started is shown as Lead; there is no Not Started step.
check('stage: Not Started reads as Lead', [deckStage('Not Started'), deckStage('Quoted')], ['Lead', 'Quoted']);
check('stage: Not Started opp content', oppSlideContent({ record: { Account: 'X', Stage: 'Not Started' } }).stage, 'Lead');

// SUCON is dropped from service names, with its separator.
check('SUCON stripped', ['ECLR - SUCON', 'Materiality assessment SUCON', 'UN PRI - SUCON', 'CSRD - DMA - SUCON', 'Strategic sourcing'].map(deckServiceName),
  ['ECLR', 'Materiality assessment', 'UN PRI', 'CSRD - DMA', 'Strategic sourcing']);

// Scope grouped by the Services board's buckets, board order, unknowns last.
const categories = [
  { name: 'Traditional Energy Management', items: ['Strategic sourcing', 'Rate optimization'] },
  { name: 'Sustainability', items: ['Materiality assessment SUCON', 'Ziego Power'] },
];
check('scope buckets', groupScope(['Mystery service', 'Materiality assessment SUCON', 'Rate optimization', 'Strategic sourcing', 'Ziego'], { categories, renames: { 'Ziego Power': 'Ziego' } }), [
  { bucket: 'Traditional Energy Management', items: ['Rate optimization', 'Strategic sourcing'] },
  { bucket: 'Sustainability', items: ['Materiality assessment', 'Ziego'] },
  { bucket: 'Other services', items: ['Mystery service'] },
]);
check('scope buckets: the real seed board files known services', groupScope(['Strategic sourcing'], { categories: getServiceCategories({}) })[0].bucket, 'Traditional Energy Management');

check('xml escape', xmlEscape('A & B <x> "q"\u0001'), 'A &amp; B &lt;x&gt; &quot;q&quot;');
check('filename', oppDeckFilename('Acme / Foods: "NA"', new Date(2026, 9, 22)), 'Acme Foods NA - Opps 2026-10-22.pptx');

// Build a real deck off the shipped template.
const template = await readFile(new URL('../src/assets/se-opps-template.pptx', import.meta.url));
const bytes = await buildOppDeck({
  JSZip, template, company: 'Harbor Peak Capital & Co', entries: picked,
  contactInfo: () => ({ title: 'Director' }), date: new Date(2026, 9, 22),
});
if (process.env.OPP_DECK_OUT) await writeFile(process.env.OPP_DECK_OUT, bytes);
const out = await JSZip.loadAsync(bytes);
const pres = await out.file('ppt/presentation.xml').async('string');
const rels = await out.file('ppt/_rels/presentation.xml.rels').async('string');
const types = await out.file('[Content_Types].xml').async('string');
const ids = [...pres.matchAll(/<p:sldId id="\d+" r:id="(rId\d+)"\/>/g)].map(m => m[1]);
const targets = ids.map(rid => rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]);
check('deck: cover, one overview, five opps, closing', targets,
  ['slides/slide1.xml', 'slides/slide4.xml', 'slides/slide5.xml', 'slides/slide6.xml', 'slides/slide7.xml', 'slides/slide8.xml', 'slides/slide9.xml', 'slides/slide3.xml']);
check('deck: prototype slide removed', [!!out.file('ppt/slides/slide2.xml'), rels.includes('slide2.xml'), types.includes('slide2.xml')], [false, false, false]);
check('deck: every slide has a content type', targets.every(t => types.includes(`/ppt/${t}"`)), true);
const cover = await out.file('ppt/slides/slide1.xml').async('string');
check('deck: cover names the company, escaped', cover.includes('Harbor Peak Capital &amp; Co'), true);
let leftovers = 0;
for (const t of targets) {
  const xml = await out.file(`ppt/${t}`).async('string');
  if (/\{\{|<!--/.test(xml)) leftovers += 1;
}
check('deck: no tokens left behind', leftovers, 0);
const overview = await out.file(`ppt/${targets[1]}`).async('string');
check('deck: overview table is Account, Stage, Scope only',
  [overview.includes('>Account<'), overview.includes('>Stage<'), overview.includes('>Scope<'), overview.includes('>Opportunity<'), overview.includes('>Deal size<')],
  [true, true, true, false, false]);

check('overview: scope written out per bucket, not cut to one line',
  [overview.includes('Energy Procurement'), overview.includes('Utility Bill Management'), overview.includes('...')], [true, true, false]);
check('scope summary: a line per bucket, listed with "and"',
  scopeSummary([{ bucket: 'Bill Pay', items: ['Bill payment', 'Invoice variance testing', 'Invoice recalculation'] }, { bucket: 'Reporting', items: ['CDP climate'] }]),
  [{ label: 'Bill Pay', text: 'Bill payment, Invoice variance testing and Invoice recalculation' }, { label: 'Reporting', text: 'CDP climate' }]);
check('scope summary: services no bucket claims read without a label',
  scopeSummary([{ bucket: 'Other services', items: ['Strategic sourcing', 'Peak Alerts'] }]), [{ label: '', text: 'Strategic sourcing and Peak Alerts' }]);
{
  // Long scopes make tall rows, and the overview pages by height so none
  // runs off the slide.
  const many = Array.from({ length: 12 }, (_, i) => ({ _id: 100 + i, Account: `Holding ${i}`, Stage: 'Lead', Scope: Array.from({ length: 14 }, (_, k) => `Service number ${k}`).join(', ') }));
  const deck = await buildOppDeck({ JSZip, template, company: 'Big Fund', entries: selectDeckOpps(many, { company: 'Big Fund', owned: many.map(r => ({ name: r.Account })) }) });
  const z = await JSZip.loadAsync(deck);
  const glance = [];
  for (const f of Object.keys(z.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const xml = await z.file(f).async('string');
    if (xml.includes('Opportunities table')) glance.push(xml);
  }
  const heights = glance.map(xml => Number(xml.match(/name="Opportunities table"[\s\S]*?<a:ext cx="\d+" cy="(\d+)"/)[1]) / 914400);
  check('overview: long scopes page onto another slide', glance.length >= 2, true);
  check('overview: every page fits above the footer', heights.every(h => h <= 3.95 + 1e-6), true);
  check('overview: every opp appears once', glance.reduce((n, xml) => n + (xml.match(/>Holding \d+</g) || []).length, 0), 12);
}

console.log(`${failed ? 'FAILED' : 'PASS'} oppDeck: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
