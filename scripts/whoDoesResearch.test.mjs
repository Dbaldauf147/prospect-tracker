// "Research with Claude" on the company popup's "Who does it here?" section.
//
// The rules worth pinning: only worded questions are asked, every asked
// question comes back (empty when nobody was found), a finding without a
// name or a source page is dropped rather than shown, and an answer that
// isn't JSON is an error rather than an empty result.
//
// Run: node scripts/whoDoesResearch.test.mjs
import { buildRequest, buildUserPrompt, cleanQuestions, readAnswers, MAX_PEOPLE } from '../api/_lib/whoDoesResearch.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const qs = cleanQuestions([
  { id: 'a', question: ' Who handles energy procurement at this company? ' },
  { id: 'b', question: '' },
  { id: '', question: 'No id' },
  { id: 'c', question: 'Who is in charge of ESG/sustainability at this company?' },
]);
check('only worded questions with an id are asked', qs.map(q => q.id), ['a', 'c']);

const prompt = buildUserPrompt({ company: 'EastGroup Properties', website: 'https://www.eastgroup.net', domains: ['eastgroup.net', ''] }, qs);
check('the prompt carries the company and what identifies it', prompt.startsWith('Company: EastGroup Properties\nWebsite: https://www.eastgroup.net\nEmail domains: eastgroup.net'), true);
check('and numbers the questions', prompt.endsWith('Questions:\n1. Who handles energy procurement at this company?\n2. Who is in charge of ESG/sustainability at this company?'), true);
check('and leaves out what the card does not know', buildUserPrompt({ company: 'X' }, qs).includes('Website'), false);

const req = buildRequest({ company: 'X' }, qs);
check('the request searches the web', req.tools.map(t => t.type), ['web_search_20260209']);
check('with server-side fallback on', [req.fallbacks, req.betas], ['default', ['server-side-fallback-2026-07-01']]);

const person = (over = {}) => ({ name: 'Brent Wood', title: 'CFO', confidence: 'high', note: 'Signs off energy contracts.', sourceUrl: 'https://www.eastgroup.net/team', sourceTitle: 'Leadership', ...over });
const answer = (answers) => `Here is what I found:\n${JSON.stringify({ answers })}`;

const read = readAnswers(answer([{ question: 1, people: [person()] }]), qs);
check('a sourced finding is kept under its question', read.a, [person()]);
check('a question with no answer comes back empty', read.c, []);

check('a finding with no source page is dropped',
  readAnswers(answer([{ question: 1, people: [person({ sourceUrl: '' }), person({ name: 'Ann Lee', sourceUrl: 'not a url' })] }]), qs).a, []);
check('a nameless finding is dropped',
  readAnswers(answer([{ question: 2, people: [person({ name: ' ' })] }]), qs).c, []);
check('a question number that was not asked is ignored',
  Object.keys(readAnswers(answer([{ question: 9, people: [person()] }]), qs)), ['a', 'c']);
check('an unknown confidence reads as low',
  readAnswers(answer([{ question: 1, people: [person({ confidence: 'certain' })] }]), qs).a[0].confidence, 'low');
check('the same person twice is listed once',
  readAnswers(answer([{ question: 1, people: [person(), person({ name: 'brent wood' })] }]), qs).a.length, 1);
check(`at most ${MAX_PEOPLE} people per question`,
  readAnswers(answer([{ question: 1, people: Array.from({ length: 9 }, (_, i) => person({ name: `P${i}` })) }]), qs).a.length, MAX_PEOPLE);
check('text with no JSON is an error, not an empty result', readAnswers('I could not find anything.', qs), null);
check('JSON without answers is an error too', readAnswers('{"people":[]}', qs), null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
