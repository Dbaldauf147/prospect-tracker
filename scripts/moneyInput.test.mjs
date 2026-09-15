// The money box's string arithmetic: what it shows, and what it stores.
//
// The whole reason this field formats itself is that the figure and the
// number are different strings, and the two directions have different
// failure modes.
//
// Showing is cosmetic and safe to get wrong loudly: a bad format is visible
// the moment anybody opens the card.
//
// STORING is not. A parse that turns "$1,696,113" into 1 (stopping at the
// first separator), or an emptied box into 0, writes a wrong figure into
// the record and looks exactly like a right one - and "nobody has worked
// this out" and "somebody worked it out and it came to nothing" are the two
// answers this field exists to tell apart.
//
// Run: node scripts/moneyInput.test.mjs
import { asMoney, fromMoney } from '../src/utils/moneyInput.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// ---- what the box shows ---------------------------------------------------
{
  check('the figure off the analysis, read the way it is said', asMoney(1696113), '$1,696,113');
  check('and the smaller one beside it', asMoney(111950), '$111,950');
  check('a number typed as a string is still a number', asMoney('1696113'), '$1,696,113');
  // Whole dollars: the cents on a savings headline stand where a digit
  // somebody actually reads would be.
  check('cents are rounded off rather than shown', asMoney(1696113.49), '$1,696,113');
  check('a real zero is a figure, and says so', asMoney(0), '$0');
}

// ---- an empty box stays an empty box --------------------------------------
{
  check('nothing typed shows nothing', asMoney(''), '');
  check('and neither does a null', asMoney(null), '');
  check('nor an undefined', asMoney(undefined), '');
  // The alternative is "$NaN" sitting on a company card.
  check('junk shows nothing rather than NaN', asMoney('abc'), '');
}

// ---- what the box stores --------------------------------------------------
{
  check('a plain number is stored plainly', fromMoney('1696113'), '1696113');
  // The case this whole function exists for: the box shows a formatted
  // figure, so a blur that never cleaned it would store the dollar sign.
  check('the formatted figure parses back to the number it came from',
    fromMoney('$1,696,113'), '1696113');
  check('a figure pasted from a spreadsheet lands as a number',
    fromMoney('$2,450,000'), '2450000');
  check('and one pasted with cents keeps them', fromMoney('$1,200.50'), '1200.5');
  check('a negative exposure survives the strip', fromMoney('-$4,000'), '-4000');
}

// ---- empty is not zero ----------------------------------------------------
{
  // The difference the field is for: nobody has worked this out, versus
  // somebody worked it out and it came to nothing. A '' commits as null on
  // the way into the record; a '0' commits as a figure of zero.
  check('an emptied box clears the field', fromMoney(''), '');
  check('rather than zeroing it', fromMoney('') === '0', false);
  check('a box holding only a dollar sign is still empty', fromMoney('$'), '');
  check('and so is one holding only commas', fromMoney(',,,'), '');
  check('but a typed zero is a typed zero', fromMoney('0'), '0');
  check('null is an empty box', fromMoney(null), '');
}

// ---- the round trip -------------------------------------------------------
{
  // What actually happens to a figure that is opened, looked at, and left
  // alone: format on idle, strip on blur. It has to come back unchanged, or
  // opening a card and closing it would rewrite the record.
  for (const n of [0, 1, 999, 111950, 1696113, 987654321]) {
    check(`${n} survives a look without being edited`, fromMoney(asMoney(n)), String(n));
  }
}

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
