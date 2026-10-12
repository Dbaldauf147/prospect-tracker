// "Research with Claude" on the company popup's "Who does it here?" section.
//
// The rules worth pinning: only worded questions are asked, each question
// is its own request with its own search budget (one shared budget let the
// first question starve the rest), the card's title keywords go along as
// titles to search for, a finding without a name or a source page is
// dropped rather than shown, and an answer that isn't JSON is a failure
// rather than an empty result.
//
// Run: node scripts/whoDoesResearch.test.mjs
import { buildRequest, buildUserPrompt, cleanQuestions, readPeople, MAX_PEOPLE, SEARCHES_PER_QUESTION, SYSTEM_PROMPT } from '../api/_lib/whoDoesResearch.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const qs = cleanQuestions([
  { id: 'a', question: ' Who handles energy procurement at this company? ', keywords: 'energy, procurement' },
  { id: 'b', question: '' },
  { id: '', question: 'No id' },
  { id: 'c', question: 'Who is in charge of ESG/sustainability at this company?' },
]);
check('only worded questions with an id are asked', qs.map(q => q.id), ['a', 'c']);
check('with their title keywords', qs.map(q => q.keywords), ['energy, procurement', '']);

const company = { company: 'Simon Property Group', website: 'https://www.simon.com', domains: ['simon.com', ''] };
check('the prompt carries the company, what identifies it and the one question',
  buildUserPrompt(company, qs[1]),
  'Company: Simon Property Group\nWebsite: https://www.simon.com\nEmail domains: simon.com\n\nQuestion: Who is in charge of ESG/sustainability at this company?');
check('and the title keywords when the card has them',
  buildUserPrompt(company, qs[0]).endsWith('Title words our team associates with it: energy, procurement'), true);
check('and leaves out what the card does not know', buildUserPrompt({ company: 'X' }, qs[0]).includes('Website'), false);

const req = buildRequest(company, qs[1]);
check('each question gets its own search budget', req.tools.map(t => [t.type, t.max_uses]), [['web_search_20260209', SEARCHES_PER_QUESTION]]);
check('and is asked alone', req.messages.length === 1 && !req.messages[0].content.includes('energy procurement'), true);
check('with server-side fallback on', [req.fallbacks, req.betas], ['default', ['server-side-fallback-2026-07-01']]);
check('the prompt says to search titles and public profiles', SYSTEM_PROMPT.includes('site:linkedin.com/in') && SYSTEM_PROMPT.includes('Director of Sustainability'), true);

const person = (over = {}) => ({ name: 'Michele Le Goff', title: 'Director of Sustainability', confidence: 'high', note: 'Leads sustainability.', sourceUrl: 'https://www.linkedin.com/in/x', sourceTitle: 'LinkedIn', ...over });
const answer = (people) => `Here is what I found:\n${JSON.stringify({ people })}`;

check('a sourced finding is kept', readPeople(answer([person()])), [person()]);
check('nobody found is an empty list', readPeople(answer([])), []);
check('a finding with no source page is dropped',
  readPeople(answer([person({ sourceUrl: '' }), person({ name: 'Ann Lee', sourceUrl: 'not a url' })])), []);
check('a nameless finding is dropped', readPeople(answer([person({ name: ' ' })])), []);
check('an unknown confidence reads as low', readPeople(answer([person({ confidence: 'certain' })]))[0].confidence, 'low');
check('the same person twice is listed once', readPeople(answer([person(), person({ name: 'michele le goff' })])).length, 1);
check(`at most ${MAX_PEOPLE} people`,
  readPeople(answer(Array.from({ length: 9 }, (_, i) => person({ name: `P${i}` })))).length, MAX_PEOPLE);
check('text with no JSON is a failure, not an empty result', readPeople('I could not find anything.'), null);
check('JSON without people is a failure too', readPeople('{"answers":[]}'), null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
