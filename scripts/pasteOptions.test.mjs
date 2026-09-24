// Assertion tests for pasting a block out of Excel into a Dropdowns list.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/pasteOptions.test.mjs
import { splitPastedCells, newOptionsFromPaste } from '../src/utils/pasteOptions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}

eq(splitPastedCells('Electric\r\nNatural Gas\r\nWater\r\n'), ['Electric', 'Natural Gas', 'Water'], 'a column copied from Excel is one option per line');
eq(splitPastedCells('A\tB\tC'), ['A', 'B', 'C'], 'a row is one option per cell');
eq(splitPastedCells('A\tB\n\nC\t\tD'), ['A', 'B', 'C', 'D'], 'a block reads across then down, blanks dropped');
eq(splitPastedCells('  Lead  \n   \n'), ['Lead'], 'cells are trimmed and blank lines skipped');
eq(splitPastedCells('"Two\nlines"\nNext'), ['Two lines', 'Next'], 'a quoted cell with a line break stays one option');
eq(splitPastedCells('"Say ""hi"""\nPlain'), ['Say "hi"', 'Plain'], 'doubled quotes inside a quoted cell are one quote');
eq(splitPastedCells('6" pipe\nOther'), ['6" pipe', 'Other'], 'a quote mid-cell is just a character');
eq(splitPastedCells(''), [], 'nothing pasted, nothing added');

eq(
  newOptionsFromPaste(['Electric', 'Water'], 'electric\nWaste\nSteam\nwaste\n'),
  { added: ['Waste', 'Steam'], skipped: 2 },
  'values already on the list, or repeated in the paste, are added once',
);
eq(newOptionsFromPaste(undefined, 'A'), { added: ['A'], skipped: 0 }, 'an empty list takes everything');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
