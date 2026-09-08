// Assertion tests for the Draft Emails category banners. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/emailBanners.test.mjs
//
// A banner is the coloured bar the email opens with, above the greeting.
// Three things about it are easy to get wrong and hard to see until an
// email has already gone out:
//
//   * The text has to be readable on whatever colour the user picked. It's
//     chosen for them, so nobody can ship white-on-yellow by accident.
//   * The markup has to survive Outlook, which lays HTML out with Word's
//     engine — hence a table cell with a `bgcolor` attribute, not a styled
//     <div> whose background Word may drop, leaving no banner at all.
//   * The label is user text going into HTML, so it has to be escaped.

import {
  normalizeBanners, normalizeBannerColor, bannerTextColor, bannerHtml,
  bannerPlainText, bannerIdFor, findBanner, DEFAULT_EMAIL_BANNERS,
  DEFAULT_BANNER_COLOR,
} from '../src/utils/emailBanners.js';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS  ${name}`); return; }
  failures++;
  console.log(`FAIL  ${name}`);
}
function eq(name, actual, expected) {
  check(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

// --- colours --------------------------------------------------------------

eq('a short hex expands', normalizeBannerColor('#abc'), '#AABBCC');
eq('a bare hex gets its hash', normalizeBannerColor('1d4ed8'), '#1D4ED8');
eq('whitespace is tolerated', normalizeBannerColor('  #B91C1C  '), '#B91C1C');
eq('a colour name is not a hex', normalizeBannerColor('red'), null);
eq('a broken hex is rejected', normalizeBannerColor('#12345'), null);
eq('nothing is rejected', normalizeBannerColor(''), null);

// Readability: dark grounds take white text, light ones take near-black.
// Yellow is the case a plain average gets wrong — bright to the eye but
// mid-range by average, so it must NOT come back white.
eq('white text on navy', bannerTextColor('#1D4ED8'), '#FFFFFF');
eq('white text on dark green', bannerTextColor('#047857'), '#FFFFFF');
eq('dark text on yellow', bannerTextColor('#FACC15'), '#111827');
eq('dark text on white', bannerTextColor('#FFFFFF'), '#111827');
eq('white text on black', bannerTextColor('#000000'), '#FFFFFF');
eq('an unusable colour still answers', bannerTextColor('nonsense'), bannerTextColor(DEFAULT_BANNER_COLOR));

// --- the list on settings -------------------------------------------------

eq('no saved banners seeds the three defaults',
  normalizeBanners(undefined).map(b => b.label),
  DEFAULT_EMAIL_BANNERS.map(b => b.label));
eq('deleting them all is respected', normalizeBanners([]), []);
eq('junk is not a list', normalizeBanners('nope'), []);
eq('an unlabelled banner is dropped',
  normalizeBanners([{ id: 'a', label: '   ', color: '#111111' }]), []);
eq('a bad colour falls back rather than reaching the email',
  normalizeBanners([{ id: 'a', label: 'Compliance Update', color: 'chartreuse' }]),
  [{ id: 'a', label: 'Compliance Update', color: DEFAULT_BANNER_COLOR }]);
eq('a missing id is derived from the label',
  normalizeBanners([{ label: 'Energy Market Update', color: '#1D4ED8' }])[0].id,
  'energy-market-update');
eq('duplicate ids are separated so a draft names exactly one',
  normalizeBanners([
    { id: 'dup', label: 'One', color: '#111111' },
    { id: 'dup', label: 'Two', color: '#222222' },
  ]).map(b => b.id),
  ['dup', 'dup-2']);
eq('a label of pure punctuation still gets an id',
  bannerIdFor('!!!').startsWith('banner-'), true);

const banners = normalizeBanners(undefined);
eq('a draft finds its banner', findBanner(banners, 'market-intelligence').label, 'Market Intelligence');
eq('a deleted banner reads as none', findBanner(banners, 'gone'), null);
eq('no banner id is no banner', findBanner(banners, ''), null);

// --- the markup that reaches Outlook --------------------------------------

const html = bannerHtml({ id: 'x', label: 'Energy Market Update', color: '#1D4ED8' });
check('the colour is a bgcolor attribute Word honours', html.includes('bgcolor="#1D4ED8"'));
check('and a style, for every other client', html.includes('background-color:#1D4ED8'));
check('the label is in there', html.includes('Energy Market Update'));
check('the text colour is the readable one', html.includes('color:#FFFFFF'));
check('it is a full-width table, not a div', /^<table[^>]*width="100%"/.test(html));
check('it ends with the break before the greeting', html.endsWith('</table><br>'));
check('no banner, no markup', bannerHtml(null) === '');
check('an unlabelled banner renders nothing', bannerHtml({ id: 'x', label: '  ', color: '#111111' }) === '');

// User text goes into HTML, so it is escaped — a label with an angle bracket
// must not be able to open a tag.
const nasty = bannerHtml({ id: 'x', label: 'Q3 <b>Update</b> & More', color: '#111111' });
check('the label is escaped', nasty.includes('Q3 &lt;b&gt;Update&lt;/b&gt; &amp; More'));
check('and no raw tag survives it', !nasty.includes('<b>'));

// --- the plain-text fallback ---------------------------------------------

eq('plain text carries the label as a heading',
  bannerPlainText({ label: 'Compliance Update' }), 'COMPLIANCE UPDATE\n\n');
eq('no banner adds no plain text', bannerPlainText(null), '');

console.log(failures === 0 ? '\nAll email banner tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
