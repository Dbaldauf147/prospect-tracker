// The "Who is it?" column on the Events tab's LinkedIn lookup list.
//
// The rules worth pinning: the request searches the web, the answer is
// read out of the text even with prose around it, "not found" is an answer
// rather than a guess, and nothing the model writes can put an em dash or
// a non-LinkedIn "profile" link on the page.
//
// Run: node scripts/findPerson.test.mjs
import { buildRequest, buildUserPrompt, readAnswer } from '../api/_lib/findPerson.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

check('the prompt carries the title and company',
  buildUserPrompt(' VP, ESG & Sustainability ', 'AMLI Residential').startsWith('Title: VP, ESG & Sustainability\nCompany: AMLI Residential'), true);
const req = buildRequest('Utility Analyst', 'AMLI Residential');
check('the request searches the web', req.tools.map(t => t.type), ['web_search_20260209']);
check('and has no structured output to clash with citations', req.output_config.format, undefined);

check('an answer with prose around it is still read',
  readAnswer('Here is what I found:\n{"name":"Erin Meezan","title":"Chief Sustainability Officer","linkedinUrl":"https://www.linkedin.com/in/erin","confidence":"high","reason":"Company leadership page.","sources":[{"title":"Team","url":"https://example.com/team"}]}'),
  { name: 'Erin Meezan', title: 'Chief Sustainability Officer', linkedinUrl: 'https://www.linkedin.com/in/erin', confidence: 'high', reason: 'Company leadership page.', sources: [{ title: 'Team', url: 'https://example.com/team' }] });
check('not found stays not found',
  readAnswer('{"name":"","title":"","linkedinUrl":"","confidence":"low","reason":"No source names anyone in this role.","sources":[]}').name, '');
check('a non-LinkedIn profile link is dropped',
  readAnswer('{"name":"A B","linkedinUrl":"https://example.com/a","confidence":"medium","reason":"x"}').linkedinUrl, '');
check('em dashes are rewritten',
  readAnswer('{"name":"A B","confidence":"high","reason":"Named on the team page — 2026."}').reason, 'Named on the team page - 2026.');
check('an unknown confidence reads as low', readAnswer('{"name":"A","confidence":"certain"}').confidence, 'low');
check('a non-http source is dropped', readAnswer('{"name":"A","sources":[{"title":"x","url":"javascript:alert(1)"}]}').sources, []);
check('no JSON is no answer', readAnswer('I could not find anyone.'), null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
