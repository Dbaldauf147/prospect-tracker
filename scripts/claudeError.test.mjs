// Plain Node, no framework. Run:
//   node scripts/claudeError.test.mjs
import { claudeErrorMessage } from '../api/_lib/claudeError.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const credits = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_1"}';
const out = 'The Anthropic API account is out of credits, so Claude features are paused. Add credits under Plans & Billing in the Anthropic Console, then try again.';
check('no credits: raw body', claudeErrorMessage(400, credits), out);
check('no credits: SDK message with the status in front', claudeErrorMessage(400, `400 ${credits}`), out);
check('bad key', claudeErrorMessage(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
  'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the Vercel project settings.');
check('rate limit', claudeErrorMessage(429, ''), 'Claude is rate-limited right now - try again in a minute.');
check('overloaded', claudeErrorMessage(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), 'Claude is overloaded right now - try again in a minute.');
check('anything else: the sentence, not the JSON', claudeErrorMessage(400, '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: too large"}}'), 'Claude API error 400: max_tokens: too large');
check('not JSON', claudeErrorMessage(500, 'Bad gateway'), 'Claude API error 500: Bad gateway');
check('nothing to go on', claudeErrorMessage(undefined, ''), 'Claude API error');

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
