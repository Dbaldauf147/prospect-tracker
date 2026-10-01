// Assertion tests for the Fee Builder's "Copy selected" payload. Plain
// Node, no test framework. Run:
//   node scripts/feeBuilderCopy.test.mjs
import { FEE_COPY_HEADERS, feeCopyCells, feeCopyTsv, feeCopyHtml } from '../src/utils/feeBuilderCopy.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('headers match the six columns asked for', FEE_COPY_HEADERS,
  ['Fee line item', 'Type', 'Fee', 'Unit', 'Units', 'Start Month']);

const full = { name: 'Utility Bill Management', type: 'Recurring (monthly)', feePerUnit: 1234.5, unit: 'Per Site', unitCount: 12, startMonth: 3, term: 999 };
check('a full row', feeCopyCells(full),
  ['Utility Bill Management', 'Recurring (monthly)', '$1,234.50', 'Per Site', '12', '3']);

check('blanks stay blank, zero count kept', feeCopyCells({ name: 'Setup', type: 'One Time', feePerUnit: null, unit: '', unitCount: 0, startMonth: null }),
  ['Setup', 'One Time', '', '', '0', '']);

check('tabs and line breaks inside a cell are flattened', feeCopyCells({ name: 'A\tB\nC', type: 'One Time' })[0], 'A B C');

check('tsv has a header row then one line per row',
  feeCopyTsv([full, { name: 'Setup', type: 'One Time', feePerUnit: 500 }]).split('\n'),
  [
    'Fee line item\tType\tFee\tUnit\tUnits\tStart Month',
    'Utility Bill Management\tRecurring (monthly)\t$1,234.50\tPer Site\t12\t3',
    'Setup\tOne Time\t$500.00\t\t\t',
  ]);

const html = feeCopyHtml([{ name: 'R&D <x>', type: 'One Time', feePerUnit: 1 }]);
check('html escapes cell text', html.includes('<td>R&amp;D &lt;x&gt;</td>'), true);
check('html has the header row', html.includes('<th>Fee line item</th><th>Type</th>'), true);

console.log(`${failed ? 'FAIL' : 'PASS'} feeBuilderCopy: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
