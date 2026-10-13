// Assertion tests for src/utils/zoomCsv.js, the ZoomInfo CSV the PE
// Portfolio page's Zoom Export writes. Plain Node. Run:
//   node scripts/zoomCsv.test.mjs
import { buildZoomCsv } from '../src/utils/zoomCsv.js';

let failed = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
}

const rows = [
  { id: 1, company: 'Accel', zoomCompanyId: '123', zoomCompanyName: 'Accel Partners', website: 'accel.com' },
  { id: 2, company: 'Adams Street Partners, LLC', website: 'adamsstreetpartners.com' },
  { id: 3, company: 'Skip Me', zoomCompanyId: '999', excludeFromZoomExports: true },
];
const out = buildZoomCsv(rows);
eq(out.csv.split('\n'), [
  'Company,Zoom Company ID,Zoom Company Name,Company URL',
  'Accel,123,Accel Partners,accel.com',
  '"Adams Street Partners, LLC",,,adamsstreetpartners.com',
], 'four columns, commas quoted, blanks left blank');
eq([out.kept, out.excluded], [2, 1], 'excluded companies dropped and counted');
eq(buildZoomCsv([]).csv, 'Company,Zoom Company ID,Zoom Company Name,Company URL', 'no rows is a header');

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
