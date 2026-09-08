// Assertion tests for the rate card as a sentence — the "Pricing basis"
// column in the Deal Sizing popouts. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/rateSentence.test.mjs
//
// The sentence is the form a price is argued in ("$625 to $825 per site"),
// and it has to describe EVERY line a service is charged on: a fee built
// from three bases is misdescribed by any one of them alone.
import {
  rateSentence, pricingFor, PRICING_BASES,
} from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const bases = PRICING_BASES;
const say = (row) => rateSentence(pricingFor({ S: row }, 'S', bases), bases);

// --- one line, each shape a basis can take ------------------------------
{
  eq(say({ basis: 'per_site', rate: 625 }), '$625 per site', 'a per-unit rate names its unit, singular');
  eq(say({ basis: 'per_site', rate: 625, rateHigh: 825 }), '$625 to $825 per site', 'a range reads as a range');
  eq(say({ basis: 'per_site', rate: 625, rateHigh: 625 }), '$625 per site', 'a high end equal to the low is not a range');
  eq(say({ basis: 'per_mwh', rate: 3 }), '$3 per MWh', 'an acronym unit keeps its capitals');
  eq(say({ basis: 'flat', rate: 45000 }), '$45,000 flat fee', 'a flat fee says so');
  eq(say({ basis: 'recurring_annual', rate: 12000 }), '$12,000 recurring annual', 'and so does an annual');
}

// --- every line, not just the headline one ------------------------------
{
  eq(
    say({ basis: 'flat', rate: 45000, lines: [{ basis: 'recurring_annual', rate: 12000 }, { basis: 'per_mwh', rate: 3 }] }),
    '$45,000 flat fee, plus $12,000 recurring annual, plus $3 per MWh',
    'a service priced on three bases describes all three, primary first',
  );
}

// --- nothing to say -----------------------------------------------------
{
  eq(say({}), '', 'a service with no basis has no sentence');
  eq(say({ basis: 'per_site' }), '', 'a basis with no rate prices nothing, so it says nothing');
  eq(rateSentence(null, bases), '', 'and neither does no entry at all');
  // A typed Est. Year 1 Fee outranks the rates when the estimate runs, but
  // it is not itself a rate — the sentence describes the rate card, and the
  // popout says separately that the typed fee is what gets charged.
  eq(say({ basis: 'per_site', rate: 625, rateHigh: 825, avgFee: 550 }), '$625 to $825 per site',
    'a typed fee does not change what the rate card says');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
