// Assertion tests for the Draft Emails recipient chip's hover text. Plain
// Node, no test framework (the project has none). Run:
//   node scripts/recipientHoverTitle.test.mjs
import { recipientHoverTitle } from '../src/utils/recipientHoverTitle.js';

let failures = 0;
function same(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

same('name, then title, then company',
  recipientHoverTitle({ name: 'James Colon', title: 'Managing Director', company: 'Nuveen', email: 'j@x.com' }),
  'James Colon\nManaging Director\nNuveen');
same('title alone when there is no company',
  recipientHoverTitle({ name: 'Sara Rose', title: 'Chief Financial Officer' }), 'Sara Rose\nChief Financial Officer');
same('a missing title says so', recipientHoverTitle({ name: 'Jim Dietz', company: 'Lennar' }), 'Jim Dietz\nNo title on file\nLennar');
same('stray whitespace is tidied', recipientHoverTitle({ name: '  Kelly   Zant ', title: ' VP,\n Energy ' }), 'Kelly Zant\nVP, Energy');
same('no name falls back to the address', recipientHoverTitle({ email: 'a@b.com', title: 'Director' }), 'a@b.com\nDirector');
same('nobody at all is no tooltip', recipientHoverTitle({}), '');

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
