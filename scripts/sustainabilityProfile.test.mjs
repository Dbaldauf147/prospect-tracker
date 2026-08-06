// Assertion tests for the sustainability picture. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/sustainabilityProfile.test.mjs
//
// Three surfaces read this: the company modal, the Corporate Compliance
// card, and the Master Analysis export's Summary tab. The rule they have
// to agree on is which source wins — somebody's curated answer, or the
// Claude research it was derived from — because presenting a machine's
// reading as a person's decision is the one failure that matters here.
import {
  sustainabilityProfile, describeSustainability, companyResearchSlug,
  frameworksNamedInProse,
} from '../src/utils/sustainabilityProfile.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const RESEARCH = {
  massmutual: {
    summary: 'First U.S. mutual life insurer to commit to a net zero investment portfolio by 2050.',
    programs: ['Impact Investment program', 'MassMutual Ventures Climate Technology Fund'],
    targets: ['Net zero operations by 2030', 'Net zero investment portfolio by 2050'],
    frameworks: ['UN PRI', 'TCFD'],
    reports: [
      { title: '2024 Sustainability Report', url: 'https://example.com/2024.pdf', year: 2024 },
      { title: '2022 Sustainability Report', url: 'https://example.com/2022.pdf', year: 2022 },
    ],
    savedAt: 1700000000000,
  },
};

// ---- the slug ---------------------------------------------------------------

eq(companyResearchSlug('MassMutual'), 'massmutual', 'the slug is what the company page files research under');
eq(companyResearchSlug('Brookfield (Self Storage)'), 'brookfield--self-storage-', 'punctuation becomes separators, consistently');
eq(companyResearchSlug(''), '', 'no name, no slug');

// ---- research only, no company record ---------------------------------------
//
// The case the Corporate Compliance card used to give up on: a company
// researched from its company page but never added to the table.

const researched = sustainabilityProfile({ company: 'MassMutual', companyResearch: RESEARCH });
eq(researched.targets.length, 2, 'researched targets show with no company record at all');
eq(researched.targetsSource, 'research', 'and are labelled as research');
eq(researched.frameworks, ['UN PRI', 'TCFD'], 'so do the frameworks it found');
eq(researched.reports.length, 2, 'and the published reports');
eq(researched.reports[0].year, 2024, 'a report keeps its year');
eq(researched.programs.length, 2, 'and the programmes');
eq(researched.hasAny, true, 'so the row has something to say');

// ---- curated wins -----------------------------------------------------------
//
// Somebody read the research and decided. That decision is the answer,
// and the research must not overwrite or duplicate it.

const curated = sustainabilityProfile({
  company: 'MassMutual',
  prospect: {
    sustainabilityTargets: 'Net zero operations by 2030\n  \n50% Scope 1+2 cut by 2030',
    frameworks: ['CSRD'],
  },
  companyResearch: RESEARCH,
});
eq(curated.targets, ['Net zero operations by 2030', '50% Scope 1+2 cut by 2030'], 'curated targets win, blank lines dropped');
eq(curated.targetsSource, 'curated', 'and are labelled as somebody’s decision');
eq(curated.frameworks, ['CSRD'], 'curated frameworks win too');
eq(curated.frameworksSource, 'curated', 'and say so');
// The research still contributes what the curated fields have no room for.
eq(curated.reports.length, 2, 'the published reports still come from the research');
eq(curated.summary.startsWith('First U.S.'), true, 'as does the programme summary');

// A record with an empty targets field falls back rather than showing nothing.
const emptyField = sustainabilityProfile({
  company: 'MassMutual',
  prospect: { sustainabilityTargets: '   \n  ', frameworks: [] },
  companyResearch: RESEARCH,
});
eq(emptyField.targetsSource, 'research', 'an empty curated field is not a decision to show nothing');
eq(emptyField.frameworks, ['UN PRI', 'TCFD'], 'and neither is an empty frameworks list');

// ---- nothing at all ---------------------------------------------------------

const nothing = sustainabilityProfile({ company: 'Barings', companyResearch: RESEARCH });
eq(nothing.hasAny, false, 'a company with neither is empty');
eq(nothing.targets, [], 'with no targets');
eq(nothing.reports, [], 'and no reports');
eq(sustainabilityProfile({}).hasAny, false, 'no company at all is not a crash');
eq(sustainabilityProfile({ company: 'X', companyResearch: null }).hasAny, false, 'nor is a missing research map');

// A company named only by its record still resolves.
eq(
  sustainabilityProfile({ prospect: { company: 'MassMutual' }, companyResearch: RESEARCH }).targets.length,
  2,
  'the company name can come from the record',
);

// ---- reports are cleaned ----------------------------------------------------

const messy = sustainabilityProfile({
  company: 'X',
  companyResearch: {
    x: {
      reports: [
        { title: 'Good', url: 'https://a.example', year: 2024 },
        { title: 'No url', url: '' },
        { title: 'Dup', url: 'https://a.example', year: 2023 },
        { title: '', url: 'https://b.example', year: 'not a year' },
      ],
    },
  },
});
eq(messy.reports.length, 2, 'a report with no url is not a link, and the same url is not two');
eq(messy.reports[1].title, 'https://b.example', 'an untitled report reads as its url rather than blank');
eq(messy.reports[1].year, null, 'an unparseable year is no year');

// ---- the empty states point somewhere ---------------------------------------

eq(
  describeSustainability(researched),
  '',
  'a profile with something in it needs no explaining',
);
eq(
  describeSustainability(nothing, { hasProspect: true }),
  'No sustainability targets recorded, and no research saved. Use “Research with Claude” on the company page.',
  'a company with a record is pointed at the research button',
);
eq(
  describeSustainability(nothing, { hasProspect: false }),
  'Nothing recorded yet. Add the company on the Table view to curate targets, or run “Research with Claude” on its company page.',
  'a company without one is told both ways in',
);
eq(
  describeSustainability(sustainabilityProfile({})),
  'Add a company name to pull its sustainability targets across.',
  'an unnamed company is asked for a name',
);

// ---- frameworks named in the narrative --------------------------------------
//
// The research is told to list a framework only with direct evidence of a
// published report, while its prose repeats what a company says about
// itself. The two halves disagree often, and the disagreement is the
// finding — so it has to be detected without inventing new ones.

eq(
  frameworksNamedInProse('The company joined UN PRI in 2021 and reports using SASB and TCFD frameworks.'),
  ['TCFD', 'UN PRI'],
  'the narrative’s framework names are picked out',
);
eq(frameworksNamedInProse('CDP respondent, GRESB rated, SBTi validated'), ['CDP', 'GRESB', 'SBT'], 'acronyms and the SBTi spelling');
eq(frameworksNamedInProse('Aligned to the ISSB standards'), ['IFRS'], 'ISSB is how IFRS S1/S2 usually gets written');
eq(frameworksNamedInProse('Reporting under California SB 253'), ['CA SB'], 'the California bills map to their label');
eq(frameworksNamedInProse(['', null]), [], 'nothing in the prose, nothing found');
eq(frameworksNamedInProse(''), [], 'and an empty string is not a match for everything');

// Whole words only — the same trap the scope matcher fell into.
eq(frameworksNamedInProse('Our subtotal is rising'), [], '"sbt" inside a longer word is not SBTi');
eq(frameworksNamedInProse('recap of the year'), [], 'and "reca" inside another word is not RECA');
eq(frameworksNamedInProse('Principles guide our pricing'), [], 'a bare "pri" is deliberately not a UN PRI match');

// ---- confirmed vs claimed ---------------------------------------------------
//
// MassMutual, verbatim: the structured list found UN PRI only, while the
// summary asserts TCFD. Neither a tick nor a blank is the truth here.

const massmutual = sustainabilityProfile({
  company: 'MassMutual',
  companyResearch: {
    massmutual: {
      summary: 'The company joined UN PRI in 2021, published its inaugural sustainability report in 2022, and reports using SASB and TCFD frameworks.',
      programs: ['Impact Investment program'],
      frameworks: ['UN PRI'],
      reports: [],
    },
  },
});
eq(massmutual.frameworks, ['UN PRI'], 'the confirmed list is what the research actually evidenced');
eq(massmutual.otherFrameworks, ['UN PRI'], 'UN PRI shows even though it is not one of the three chips');
eq(massmutual.claimedFrameworks, ['TCFD'], 'TCFD is reported as claimed, because only the prose says it');

// A framework the list DID confirm never doubles up as a claim.
const both = sustainabilityProfile({
  company: 'X',
  companyResearch: { x: { summary: 'Reports under TCFD.', frameworks: ['TCFD'], reports: [] } },
});
eq(both.claimedFrameworks, [], 'a confirmed framework is not also listed as claimed');
eq(both.otherFrameworks, [], 'and a chip framework is not repeated as an extra');

// A curated framework list settles it too: somebody decided.
const curatedWins = sustainabilityProfile({
  company: 'X',
  prospect: { frameworks: ['TCFD'] },
  companyResearch: { x: { summary: 'Reports under TCFD.', frameworks: [], reports: [] } },
});
eq(curatedWins.claimedFrameworks, [], 'a framework the user ticked is confirmed, not claimed');

// A claim on its own is enough to make the row worth rendering.
eq(
  sustainabilityProfile({
    company: 'X',
    companyResearch: { x: { summary: 'Said to follow TCFD.', frameworks: [], reports: [], targets: [], programs: [] } },
  }).hasAny,
  true,
  'a claim with nothing else still has something to say',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
