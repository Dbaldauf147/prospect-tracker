// Assertion tests for the inline-image → multipart/related conversion that
// makes a pasted picture actually render in Outlook. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/inlineImages.test.mjs
import { htmlSectionLines, splitInlineImages, base64Body } from '../src/utils/inlineImages.js';
import { buildEmlDraft } from '../src/utils/buildEmlDraft.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('\n== splitInlineImages ==');
const html = `<div>hi<img src="data:image/png;base64,${PNG}" width="100">`
  + `<img src="data:image/jpeg;base64,${JPG}">`
  + `<img src="data:image/png;base64,${PNG}">`                       // duplicate of #1
  + `<img src="https://example.com/api/track-open?id=abc" width="1" height="1"></div>`;
const split = splitInlineImages(html);
check('two distinct images extracted (duplicate deduped)', split.images.length === 2, `got ${split.images.length}`);
check('no data: URIs left in html', !/data:image/i.test(split.html));
check('duplicate reuses the same cid', (split.html.match(new RegExp(split.images[0].cid, 'g')) || []).length === 2);
check('tracking pixel http src untouched', split.html.includes('https://example.com/api/track-open?id=abc'));
check('content types preserved', split.images.map(i => i.contentType).join() === 'image/png,image/jpeg', split.images.map(i => i.contentType).join());
check('filenames get real extensions', split.images.map(i => i.name).join() === 'image1.png,image2.jpg', split.images.map(i => i.name).join());

console.log('\n== base64 line folding ==');
const folded = base64Body('A'.repeat(200));
check('no line exceeds 76 chars', folded.split('\r\n').every(l => l.length <= 76));
check('nothing lost', folded.replace(/\r\n/g, '').length === 200);

console.log('\n== htmlSectionLines: no images ==');
const plain = htmlSectionLines('<p>just text</p>');
check('stays a plain text/html part', plain.lines[0] === 'Content-Type: text/html; charset=UTF-8', plain.lines[0]);
check('reports zero images', plain.imageCount === 0);

console.log('\n== htmlSectionLines: with images ==');
const sec = htmlSectionLines(html);
const secText = sec.lines.join('\r\n');
check('section is multipart/related', /^Content-Type: multipart\/related; boundary="(.+)"; type="text\/html"$/.test(sec.lines[0]), sec.lines[0]);
const bnd = sec.lines[0].match(/boundary="([^"]+)"/)[1];
check('html sub-part present', secText.includes('Content-Type: text/html; charset=UTF-8'));
check('one Content-ID per image', (secText.match(/^Content-ID: </gm) || []).length === 2);
check('images marked inline', (secText.match(/^Content-Disposition: inline;/gm) || []).length === 2);
check('images base64-encoded', (secText.match(/^Content-Transfer-Encoding: base64$/gm) || []).length === 2);
check('boundary closes', secText.trimEnd().endsWith(`--${bnd}--`));
check('every cid: reference has a matching Content-ID', (() => {
  const refs = [...secText.matchAll(/src="cid:([^"]+)"/g)].map(m => m[1]);
  return refs.length > 0 && refs.every(r => secText.includes(`Content-ID: <${r}>`));
})());
check('no data: URI anywhere in the section', !/data:image/i.test(secText));
check('all body lines within RFC length', secText.split('\r\n').every(l => l.length <= 998));

console.log('\n== buildEmlDraft: images, no attachments ==');
const eml1 = buildEmlDraft({ subject: 'Test', bodyHtml: `<p>x</p><img src="data:image/png;base64,${PNG}">`, to: 'a@b.com' });
check('top-level is multipart/related', /^Content-Type: multipart\/related;/m.test(eml1));
check('X-Unsent kept', eml1.includes('X-Unsent: 1'));
check('cid reference present', /src="cid:[^"]+"/.test(eml1));
check('no data: URI', !/data:image/i.test(eml1));

console.log('\n== buildEmlDraft: images AND attachments ==');
const eml2 = buildEmlDraft({
  subject: 'Test', bodyHtml: `<p>x</p><img src="data:image/png;base64,${PNG}">`, to: 'a@b.com',
  attachments: [{ name: 'report.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }],
});
check('top-level is multipart/mixed', /^Content-Type: multipart\/mixed; boundary="([^"]+)"/m.test(eml2));
const mixB = eml2.match(/multipart\/mixed; boundary="([^"]+)"/)[1];
check('related nested inside mixed', eml2.indexOf(`--${mixB}`) < eml2.indexOf('multipart/related'));
check('attachment still present', eml2.includes('Content-Disposition: attachment; filename="report.pdf"'));
check('mixed boundary closes last', eml2.trimEnd().endsWith(`--${mixB}--`));
check('inline image and attachment both there',
  eml2.includes('Content-Disposition: inline;') && eml2.includes('Content-Disposition: attachment;'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
