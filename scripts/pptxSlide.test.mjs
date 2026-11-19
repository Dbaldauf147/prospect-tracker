// Plain Node, no framework. Run:
//   node scripts/pptxSlide.test.mjs
import JSZip from 'jszip';
import { pptxParts, buildPicturePptx, fitToSlide, SLIDE_W, SLIDE_H } from '../src/utils/pptxSlide.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('16:9 covers the slide', fitToSlide(1600, 900), { x: 0, y: 0, cx: SLIDE_W, cy: SLIDE_H });
check('wider: full width, centred down the page', fitToSlide(2000, 900), { x: 0, y: 685800, cx: SLIDE_W, cy: 5486400 });
check('taller: full height, centred across', fitToSlide(900, 900), { x: 2667000, y: 0, cx: SLIDE_H, cy: SLIDE_H });

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const withSvg = pptxParts({ png, svg: '<svg/>', imgW: 1600, imgH: 900, title: 'A & B "plan" <1>' });
check('svg and its fallback are both there', ['ppt/media/image1.png', 'ppt/media/image2.svg'].map(p => p in withSvg), [true, true]);
check('svg is wired to the picture', [withSvg['ppt/slides/slide1.xml'].includes('asvg:svgBlip'), withSvg['ppt/slides/_rels/slide1.xml.rels'].includes('image2.svg'), withSvg['[Content_Types].xml'].includes('image/svg+xml')], [true, true, true]);
check('title is escaped', withSvg['ppt/slides/slide1.xml'].includes('name="A &amp; B &quot;plan&quot; &lt;1&gt;"'), true);
check('widescreen', withSvg['ppt/presentation.xml'].includes(`<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>`), true);
const noSvg = pptxParts({ png, imgW: 1600, imgH: 900 });
check('no svg: nothing points at one', ['ppt/media/image2.svg' in noSvg, /svg/i.test(noSvg['ppt/slides/slide1.xml'] + noSvg['ppt/slides/_rels/slide1.xml.rels'] + noSvg['[Content_Types].xml'])], [false, false]);
// Every relationship target exists in the package.
const missing = [];
for (const [path, body] of Object.entries(withSvg)) {
  if (!path.endsWith('.rels')) continue;
  const base = path.replace(/_rels\/[^/]+$/, '');
  for (const m of body.matchAll(/Target="([^"]+)"/g)) {
    const parts = (base + m[1]).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p) out.push(p); }
    if (!(out.join('/') in withSvg)) missing.push(`${path} -> ${m[1]}`);
  }
}
check('every relationship has its part', missing, []);
let threw = false;
try { pptxParts({ png: new Uint8Array(0), imgW: 1, imgH: 1 }); } catch { threw = true; }
check('no picture is an error', threw, true);

const bytes = await buildPicturePptx(JSZip, { png, svg: '<svg/>', imgW: 1600, imgH: 900, title: 'T' });
const back = await JSZip.loadAsync(bytes);
check('zips and reopens with every part', Object.keys(back.files).filter(f => !f.endsWith('/')).sort(), Object.keys(withSvg).sort());
check('png survives untouched', [...await back.file('ppt/media/image1.png').async('uint8array')], [...png]);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
