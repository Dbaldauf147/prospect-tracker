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

import { escapeHtml } from './draftEmail.js';

// Seeded on first use with the three categories the composer was built for.
// They're ordinary editable entries from that point on — renaming or
// recolouring one, or deleting it outright, is expected.
export const DEFAULT_EMAIL_BANNERS = Object.freeze([
  Object.freeze({ id: 'energy-market-update', label: 'Energy Market Update', color: '#1D4ED8' }),
  Object.freeze({ id: 'market-intelligence', label: 'Market Intelligence', color: '#047857' }),
  Object.freeze({ id: 'compliance-update', label: 'Compliance Update', color: '#B45309' }),
]);

// The colour a banner falls back to when its own is missing or unreadable —
// a slate that looks deliberate rather than broken.
export const DEFAULT_BANNER_COLOR = '#334155';

// Colours offered as one-click swatches in the banner editor. The user can
// still type any hex through the colour picker; these are just a starting
// palette wide enough that neighbouring categories don't blur together.
export const BANNER_SWATCHES = Object.freeze([
  '#1D4ED8', // blue
  '#047857', // green
  '#B45309', // amber
  '#B91C1C', // red
  '#6D28D9', // violet
  '#0E7490', // teal
  '#BE185D', // pink
  '#334155', // slate
]);

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

// The banner as it goes into the email, above the greeting.
//
// A one-cell table so Outlook's Word renderer keeps the colour (see the note
// at the top of this file), full-width so it reads as a banner rather than a
// tag, and followed by a <br> for the blank line between it and the greeting
// — the body's own leading blank lines are stripped before it is sent, so
// without this the greeting would butt straight up against the bar.
export function bannerHtml(banner) {
  if (!banner) return '';
  const label = String(banner.label ?? '').trim();
  if (!label) return '';
  const bg = normalizeBannerColor(banner.color) || DEFAULT_BANNER_COLOR;
  const fg = bannerTextColor(bg);
  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"',
    ' style="border-collapse:collapse;width:100%;">',
    '<tr>',
    `<td bgcolor="${bg}" style="background-color:${bg};padding:8pt 12pt;`,
    'font-family:Aptos,Calibri,Arial,sans-serif;font-size:12pt;font-weight:bold;',
    `letter-spacing:0.5pt;text-transform:uppercase;color:${fg};">`,
    escapeHtml(label),
    '</td></tr></table><br>',
  ].join('');
}

// The banner in a plain-text body — the Outlook deeplink and the clipboard's
// text/plain flavour, where the coloured bar can't survive. Upper-cased so
// it still reads as a heading with nothing but characters to work with.
export function bannerPlainText(banner) {
  const label = String(banner?.label ?? '').trim();
  return label ? `${label.toUpperCase()}\n\n` : '';
}
