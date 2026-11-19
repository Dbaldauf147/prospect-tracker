// Plain Node, no framework. Run:
//   node scripts/jpegPdf.test.mjs
import { buildJpegPdf } from '../src/utils/jpegPdf.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 250, 0xff, 0xd9]);
const pdf = buildJpegPdf({ jpeg, imgW: 1600, imgH: 900, pageW: 960, pageH: 540, title: 'Acme (plan) \\ é' });
const text = Buffer.from(pdf).toString('latin1');
check('header and end', [text.startsWith('%PDF-1.4\n'), text.endsWith('%%EOF\n')], [true, true]);
check('page size', /\/MediaBox \[0 0 960 540\]/.test(text), true);
check('image declared', /\/Width 1600 \/Height 900 .*\/Filter \/DCTDecode \/Length 8 /.test(text), true);
check('drawn full bleed', text.includes('q 960 0 0 540 0 0 cm /Im0 Do Q'), true);
check('title escaped, ASCII only', text.includes('/Title (Acme \\(plan\\) \\\\  )'), true);
// The JPEG is in there byte for byte.
const at = text.indexOf('stream\n') + 7;
check('jpeg bytes untouched', [...pdf.slice(at, at + jpeg.length)], [...jpeg]);
// Every xref entry points at the object it names.
const xrefAt = Number(/startxref\n(\d+)\n/.exec(text)[1]);
check('startxref points at xref', text.slice(xrefAt, xrefAt + 4), 'xref');
const entries = text.slice(xrefAt).split('\n').slice(3, 9).map(l => Number(l.slice(0, 10)));
check('xref offsets', entries.map((o, i) => text.slice(o, o + `${i + 1} 0 obj`.length)), [1, 2, 3, 4, 5, 6].map(i => `${i} 0 obj`));
let threw = false;
try { buildJpegPdf({ jpeg: new Uint8Array(0), imgW: 1, imgH: 1, pageW: 1, pageH: 1 }); } catch { threw = true; }
check('no image is an error', threw, true);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
