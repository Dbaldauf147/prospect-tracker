// Category banners for the Draft Emails composer.
//
// A banner is the coloured bar that sits at the very top of the email body,
// above the greeting — "ENERGY MARKET UPDATE" over a message about power
// prices, say. It tells the reader what kind of email this is before they
// read a word of it, and the colour does that job at a glance across a
// stack of messages, so each category gets its own.
//
// The definitions (label + colour) are the user's, edited on the Drafts tab
// and stored on their settings; the draft picks one of them by id. Only the
// id travels with a draft, so recolouring a category updates every draft
// that carries it rather than freezing the old colour into each one.
//
// Every banner ends up rendered by Outlook, which lays HTML out with Word's
// engine — hence the single-cell table with a `bgcolor` attribute below
// rather than a styled <div>. Word honours bgcolor on a table cell; a
// background-colour on a block element it may quietly drop, which would
// leave the label sitting on white with no banner at all.
//
// The format is Schneider Electric's, matching the branded Excel exports:
// a solid band in a brand colour with the label in white Nunito Sans, over a
// thin rule in the Life Is On green. The band colour is the category's — that
// is what tells two emails apart at a glance — and the green rule is the part
// every banner shares, so a stack of them reads as one brand rather than as
// three unrelated coloured bars.

import { escapeHtml } from './draftEmail.js';
import {
  SE_GREEN, SE_GREEN_DARK, SE_GRAPHITE, SE_SLATE, SE_MUTED, SE_EMAIL_FONT,
} from './schneiderBrand.js';

// Seeded on first use with the three categories the composer was built for,
// in brand colours. They're ordinary editable entries from that point on —
// renaming or recolouring one, or deleting it outright, is expected.
export const DEFAULT_EMAIL_BANNERS = Object.freeze([
  Object.freeze({ id: 'energy-market-update', label: 'Energy Market Update', color: SE_GREEN_DARK }),
  Object.freeze({ id: 'market-intelligence', label: 'Market Intelligence', color: SE_GRAPHITE }),
  Object.freeze({ id: 'compliance-update', label: 'Compliance Update', color: SE_GREEN }),
]);

// The colour a banner falls back to when its own is missing or unreadable:
// the brand's own header green, so a fallback still looks deliberate.
export const DEFAULT_BANNER_COLOR = SE_GREEN_DARK;

// One-click swatches in the banner editor — the brand palette, every value
// one the branded exports already use. The colour picker beside them still
// takes any hex; these are the ones that look like Schneider.
export const BANNER_SWATCHES = Object.freeze([
  SE_GREEN_DARK, // header green — the default band
  SE_GREEN,      // Life Is On green
  SE_GRAPHITE,   // graphite
  SE_SLATE,      // slate
  SE_MUTED,      // muted grey
]);

// What the three seeded categories used to be, before the banners were put
// into brand format. A user who never touched a colour still has these
// stored, and the composer swaps them for the brand ones once — see
// brandedBanners below.
export const LEGACY_BANNER_COLORS = Object.freeze({
  'energy-market-update': '#1D4ED8',
  'market-intelligence': '#047857',
  'compliance-update': '#B45309',
});

// "#abc" / "ABCDEF" / "#AABBCC" → "#AABBCC". null for anything else, so a
// junk value falls back rather than reaching the email as a broken colour.
export function normalizeBannerColor(raw) {
  const s = String(raw ?? '').trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const hex = m[1];
  const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
  return `#${full.toUpperCase()}`;
}

// Black or white text, whichever the banner colour can actually be read
// against. Uses the WCAG relative-luminance formula rather than a plain
// average so mid-tone greens (bright to the eye, middling by average) get
// dark text instead of white-on-lime. The user picks a background and never
// has to think about the text colour.
export function bannerTextColor(bg) {
  const hex = normalizeBannerColor(bg) || DEFAULT_BANNER_COLOR;
  const channel = (i) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.45 ? '#111827' : '#FFFFFF';
}

// Turn whatever is on settings into a clean list. Anything without a usable
// label is dropped — an unlabelled banner is a coloured bar with nothing to
// say — and ids are made unique so the draft's `bannerId` always names one
// entry. `undefined` (no banners saved yet) seeds the defaults; an explicit
// empty array is a user who deleted them all and means it.
export function normalizeBanners(raw) {
  if (raw === undefined || raw === null) return DEFAULT_EMAIL_BANNERS.map(b => ({ ...b }));
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const label = String(entry.label ?? '').trim();
    if (!label) continue;
    let id = String(entry.id ?? '').trim() || bannerIdFor(label);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    out.push({ id, label, color: normalizeBannerColor(entry.color) || DEFAULT_BANNER_COLOR });
  }
  return out;
}

// A stable id derived from the label, for a banner the user has just added.
// Falls back to a timestamp when the label is all punctuation, which would
// otherwise slugify to an empty string.
export function bannerIdFor(label) {
  const slug = String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `banner-${Date.now().toString(36)}`;
}

// The banner a draft is carrying, or null when it names none (or names one
// that has since been deleted — a stale id reads as "no banner" rather than
// putting an empty bar on the email).
export function findBanner(banners, id) {
  if (!id) return null;
  return (Array.isArray(banners) ? banners : []).find(b => b && b.id === id) || null;
}

// The thin rule under the band. It is the Life Is On green on every banner —
// that shared green is what makes three differently-coloured category bars
// read as one brand — except on a banner whose band is already that green,
// where the rule steps down to the header green so the two are still two.
export function bannerAccentColor(bg) {
  return (normalizeBannerColor(bg) || DEFAULT_BANNER_COLOR) === SE_GREEN ? SE_GREEN_DARK : SE_GREEN;
}

// The banner as it goes into the email, above the greeting.
//
// A table rather than a <div> so Outlook's Word renderer keeps the colours
// (see the note at the top of this file), full-width so it reads as a banner
// rather than a tag, in the same shape as a branded export: a solid band
// carrying the label, then a 3pt rule in the brand green. The trailing <br>
// is the blank line between the banner and the greeting — the body's own
// leading blank lines are stripped before it is sent, so without this the
// greeting would butt straight up against the bar.
//
// The rule's cell needs a zeroed font-size and line-height (plus Word's own
// mso-line-height-rule) or Word gives it a full line of text height and the
// hairline becomes a second band.
export function bannerHtml(banner) {
  if (!banner) return '';
  const label = String(banner.label ?? '').trim();
  if (!label) return '';
  const bg = normalizeBannerColor(banner.color) || DEFAULT_BANNER_COLOR;
  const fg = bannerTextColor(bg);
  const accent = bannerAccentColor(bg);
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"',
    ' style="border-collapse:collapse;width:100%;">',
    '<tr>',
    `<td bgcolor="${bg}" style="background-color:${bg};padding:9pt 12pt;`,
    `font-family:${SE_EMAIL_FONT};font-size:13pt;font-weight:bold;`,
    `letter-spacing:0.2pt;color:${fg};">`,
    escapeHtml(label),
    '</td></tr>',
    '<tr>',
    `<td bgcolor="${accent}" height="4" style="background-color:${accent};height:3pt;`,
    'line-height:3pt;mso-line-height-rule:exactly;font-size:0;">&nbsp;</td>',
    '</tr></table><br>',
  ].join('');
}

// The user's banners with the three seeded categories moved onto brand
// colours — but only where the stored colour is still the pre-brand default,
// so a colour anyone has actually chosen is left alone. The composer applies
// this once and saves the result; doing it on every read instead would mean a
// user who deliberately picked the old blue could never make it stick.
export function brandedBanners(banners) {
  return (Array.isArray(banners) ? banners : []).map((b) => {
    const legacy = LEGACY_BANNER_COLORS[b?.id];
    if (!legacy || normalizeBannerColor(b?.color) !== legacy) return b;
    const branded = DEFAULT_EMAIL_BANNERS.find(d => d.id === b.id);
    return branded ? { ...b, color: branded.color } : b;
  });
}

// Does this list still carry a pre-brand default colour to move over?
export function needsBrandColors(banners) {
  return (Array.isArray(banners) ? banners : []).some(b => (
    LEGACY_BANNER_COLORS[b?.id] && normalizeBannerColor(b?.color) === LEGACY_BANNER_COLORS[b?.id]
  ));
}

// The banner in a plain-text body — the Outlook deeplink and the clipboard's
// text/plain flavour, where the coloured bar can't survive. Upper-cased so
// it still reads as a heading with nothing but characters to work with.
export function bannerPlainText(banner) {
  const label = String(banner?.label ?? '').trim();
  return label ? `${label.toUpperCase()}\n\n` : '';
}
