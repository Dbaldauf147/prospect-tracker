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
  DEFAULT_BANNER_COLOR, BANNER_SWATCHES, LEGACY_BANNER_COLORS,
  bannerAccentColor, brandedBanners, needsBrandColors,
} from '../src/utils/emailBanners.js';
import { SE_GREEN, SE_GREEN_DARK, SE_GRAPHITE } from '../src/utils/schneiderBrand.js';

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

// --- Schneider format -----------------------------------------------------
// The band is the category's colour; the rule under it is the Life Is On
// green on every banner, which is what makes three differently-coloured bars
// read as one brand.
eq('the rule under a green band', bannerAccentColor(SE_GREEN_DARK), SE_GREEN);
eq('and under a graphite one', bannerAccentColor(SE_GRAPHITE), SE_GREEN);
// A band already in that green would otherwise have an invisible rule.
eq('a Life Is On band steps its rule down', bannerAccentColor(SE_GREEN), SE_GREEN_DARK);
eq('an unusable band colour still gets a rule', bannerAccentColor('nope'), SE_GREEN);

eq('the seeded categories are brand colours',
  DEFAULT_EMAIL_BANNERS.map(b => b.color), [SE_GREEN_DARK, SE_GRAPHITE, SE_GREEN]);
check('every swatch is a brand colour',
  BANNER_SWATCHES.every(c => normalizeBannerColor(c) === c) && BANNER_SWATCHES.includes(SE_GREEN));

// --- the markup that reaches Outlook --------------------------------------

const html = bannerHtml({ id: 'x', label: 'Energy Market Update', color: SE_GREEN_DARK });
check('the colour is a bgcolor attribute Word honours', html.includes(`bgcolor="${SE_GREEN_DARK}"`));
check('and a style, for every other client', html.includes(`background-color:${SE_GREEN_DARK}`));
check('the label is in there', html.includes('Energy Market Update'));
check('the text colour is the readable one', html.includes('color:#FFFFFF'));
check('the label is NOT force-uppercased — brand bands are title case',
  !html.includes('text-transform:uppercase'));
check('it is set in the brand face, with Arial to catch everyone else',
  html.includes("font-family:'Nunito Sans',Nunito,Arial,Helvetica,sans-serif"));
check('the green rule is a second row', html.includes(`bgcolor="${SE_GREEN}"`));
// Word gives a table cell a full line of text height unless told otherwise,
// which would turn the 3pt hairline into a second band.
check('the rule cell is height-pinned for Word',
  html.includes('mso-line-height-rule:exactly') && html.includes('font-size:0;'));
check('it is a full-width table, not a div', /^<table[^>]*width="100%"/.test(html));
check('it ends with the break before the greeting', html.endsWith('</table><br>'));
check('no banner, no markup', bannerHtml(null) === '');
check('an unlabelled banner renders nothing', bannerHtml({ id: 'x', label: '  ', color: '#111111' }) === '');

// User text goes into HTML, so it is escaped — a label with an angle bracket
// must not be able to open a tag.
const nasty = bannerHtml({ id: 'x', label: 'Q3 <b>Update</b> & More', color: '#111111' });
check('the label is escaped', nasty.includes('Q3 &lt;b&gt;Update&lt;/b&gt; &amp; More'));
check('and no raw tag survives it', !nasty.includes('<b>'));

// --- moving existing banners onto the palette -----------------------------
// A user who has had banners since before the brand format still has the old
// blue / green / amber stored. Only a colour still sitting on its pre-brand
// default moves; anything actually chosen is left alone.
const stale = [
  { id: 'energy-market-update', label: 'Energy Market Update', color: LEGACY_BANNER_COLORS['energy-market-update'] },
  { id: 'market-intelligence', label: 'Market Intelligence', color: '#BE185D' },
  { id: 'mine', label: 'My Own', color: '#123456' },
];
check('a stale list is spotted', needsBrandColors(stale));
eq('only the untouched default moves',
  brandedBanners(stale).map(b => b.color), [SE_GREEN_DARK, '#BE185D', '#123456']);
check('a branded list needs nothing', needsBrandColors(brandedBanners(stale)) === false);
check('and running it twice changes nothing more',
  JSON.stringify(brandedBanners(brandedBanners(stale))) === JSON.stringify(brandedBanners(stale)));
check('nothing saved needs nothing', needsBrandColors(undefined) === false);
eq('labels and ids are untouched by the recolour',
  brandedBanners(stale).map(b => `${b.id}:${b.label}`), stale.map(b => `${b.id}:${b.label}`));

// --- the plain-text fallback ---------------------------------------------

eq('plain text carries the label as a heading',
  bannerPlainText({ label: 'Compliance Update' }), 'COMPLIANCE UPDATE\n\n');
eq('no banner adds no plain text', bannerPlainText(null), '');

console.log(failures === 0 ? '\nAll email banner tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
