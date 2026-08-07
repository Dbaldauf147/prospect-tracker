// Assertion tests for the Agents page's BFO Address block. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/activityAddressLines.test.mjs
//
// This is the rule that decides what the day says happened. When it is
// wrong the prompt still looks complete — it just logs the wrong touch,
// and the meeting quietly disappears behind the follow-up email sent
// after it. That is the bug these pin.
import { buildActivityAddressLines } from '../src/utils/activityAddressLines.js';
import { resolveOppForRow, detectBfoUrl } from '../src/utils/closeNotSoldOpps.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const URL_A = 'https://bfo.example.com/opp/A';
const URL_B = 'https://bfo.example.com/opp/B';

// --- the reported case ---------------------------------------------------
{
  // Blackstone: a meeting at 11:30 and a follow-up email at 4:32, both on
  // the one opportunity. The meeting is what gets logged.
  const lines = buildActivityAddressLines({
    meetings: [{ bfoUrl: URL_A, company: 'Blackstone' }],
    emails: [{ bfoUrl: URL_A, company: 'Blackstone', nextStepsType: 'email' }],
  });
  eq(lines, ['BFO Address', `${URL_A}: Type meeting`],
    'a meeting and an email on one opp log the meeting, once');
}

{
  // The regression itself: before, only Opps-tab-marked meetings counted,
  // so a HubSpot / Granola meeting lost to the email.
  const lines = buildActivityAddressLines({
    meetings: [{ bfoUrl: URL_A }],
    markedMeetings: [],
    emails: [{ bfoUrl: URL_A, nextStepsType: 'email' }],
  });
  eq(lines[1], `${URL_A}: Type meeting`,
    'a meeting from the Activity table counts, not just one marked on the Opps tab');
}

// --- precedence ----------------------------------------------------------
{
  const all = {
    meetings: [{ bfoUrl: URL_A }],
    markedMeetings: [{ bfoUrl: URL_A }],
    calls: [{ bfoUrl: URL_A }],
    emails: [{ bfoUrl: URL_A, nextStepsType: 'email' }],
  };
  eq(buildActivityAddressLines(all), ['BFO Address', `${URL_A}: Type meeting`],
    'meeting beats call beats email, and the opp appears once');
}
eq(buildActivityAddressLines({
  calls: [{ bfoUrl: URL_A }],
  emails: [{ bfoUrl: URL_A, nextStepsType: 'email' }],
}), ['BFO Address', `${URL_A}: Type called`], 'a call beats an email');
eq(buildActivityAddressLines({
  markedMeetings: [{ bfoUrl: URL_A }],
  calls: [{ bfoUrl: URL_A }],
}), ['BFO Address', `${URL_A}: Type meeting`], 'a marked meeting still beats a call');
eq(buildActivityAddressLines({
  markedMeetings: [{ bfoUrl: URL_A }],
  meetings: [{ bfoUrl: URL_A }],
}).length, 2, 'the two meeting sources are one rank, not two lines');

// --- what must NOT be collapsed -----------------------------------------
{
  const lines = buildActivityAddressLines({
    meetings: [{ bfoUrl: URL_A, company: 'Blackstone' }],
    emails: [{ bfoUrl: URL_B, company: 'Blackstone', nextStepsType: 'email' }],
  });
  eq(lines, ['BFO Address', `${URL_A}: Type meeting`, `${URL_B}: Type email`],
    'two opportunities at one account are two records — both get logged');
}
{
  const lines = buildActivityAddressLines({
    emails: [
      { bfoUrl: URL_A, nextStepsType: 'email' },
      { bfoUrl: URL_B, nextStepsType: 'email' },
    ],
  });
  eq(lines.length, 3, 'distinct opps each get a line');
}

// --- rows with nothing to log against ------------------------------------
eq(buildActivityAddressLines({ meetings: [{ bfoUrl: '' }, { bfoUrl: '   ' }] }),
  ['BFO Address'], 'a touch with no BFO address is skipped');
eq(buildActivityAddressLines({}), ['BFO Address'], 'nothing to log is just the header');
eq(buildActivityAddressLines().length, 1, 'and no arguments is not a crash');
{
  // A meeting with no address must not block the email that has one —
  // they are different opportunities.
  const lines = buildActivityAddressLines({
    meetings: [{ bfoUrl: '' }],
    emails: [{ bfoUrl: URL_A, nextStepsType: 'email' }],
  });
  eq(lines, ['BFO Address', `${URL_A}: Type email`],
    'an unaddressed meeting does not suppress an addressed email');
}

// --- the email's own next-steps wording ---------------------------------
eq(buildActivityAddressLines({ emails: [{ bfoUrl: URL_A, nextStepsType: 'called' }] })[1],
  `${URL_A}: Type called`, "an email row carries its own nextStepsType");

// --- marketing lead records ---------------------------------------------
{
  const lines = buildActivityAddressLines({
    emails: [{ bfoUrl: URL_A, leadSfUrl: 'https://sf.example.com/lead/1', nextStepsType: 'email' }],
  });
  eq(lines, ['BFO Address', `${URL_A}: Type email`, 'https://sf.example.com/lead/1: Type email'],
    'a matched marketing lead is logged on its own SF record too');
}
{
  // A lead record is logged even when the meeting won the opp line: the
  // lead is a separate record, and the email did reach that person.
  const lines = buildActivityAddressLines({
    meetings: [{ bfoUrl: URL_A }],
    emails: [{ bfoUrl: URL_A, leadSfUrl: 'https://sf.example.com/lead/1', nextStepsType: 'email' }],
  });
  eq(lines.length, 3, 'the lead line survives a meeting winning the opp line');
}

// --- resolving which opp record a row links to ---------------------------
{
  const withUrl = { bfoOpp: 'Acme Upsell', raw: { 'BFO Address': URL_A } };
  const noUrl = { bfoOpp: 'Acme Upsell', raw: {} };
  const other = { bfoOpp: 'Other Opp', raw: { 'BFO Address': URL_B } };
  const index = { byBfoOpp: new Map([['acme upsell', noUrl], ['other opp', other]]), allOpps: [noUrl, withUrl, other] };

  eq(detectBfoUrl(resolveOppForRow(index, '', withUrl)?.raw), URL_A,
    'a matched opp that has an address is used as-is');
  eq(detectBfoUrl(resolveOppForRow(index, '', noUrl)?.raw), URL_A,
    'a duplicate with no address falls through to the one that has it');
  eq(detectBfoUrl(resolveOppForRow(index, 'Acme Upsell', null)?.raw), URL_A,
    'a hand-picked opp resolves by name, preferring the record with an address');
  eq(resolveOppForRow(index, 'Acme Upsell', other)?.bfoOpp, 'Acme Upsell',
    'the hand-picked opp beats the auto-match');
  eq(resolveOppForRow(index, '', null), null, 'nothing matched resolves to nothing');
  eq(resolveOppForRow(index, 'Nobody Knows This', null), null, 'an unknown name resolves to nothing');
  eq(resolveOppForRow(undefined, '', withUrl), withUrl, 'a missing index still returns the match');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
