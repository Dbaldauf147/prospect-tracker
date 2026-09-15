// Read a first and last name out of a whole one somebody pasted. Pure - no
// React, no DOM.
//
// The contact form has a First Name box and a Last Name box, and almost
// nothing in the world hands you a name already in two pieces. A LinkedIn
// profile, an email signature, a forwarded introduction and a line off a
// spreadsheet all give you "Sarah Chen", and splitting that by hand -
// select, cut, tab, paste - is four operations to do something a computer
// can read at a glance.
//
// So this reads it, and the form OFFERS the split rather than taking it.
// Everything below is a guess about a person's name, which is a thing people
// are entitled to be particular about, and a guess that quietly overwrote
// what somebody typed would be worse than no guess at all.
//
// What it knows, in the order it applies:
//
//   - A comma is two different things. "Chen, Sarah" is a directory listing,
//     surname first. "Sarah Chen, CPA" is a signature with letters after it.
//     What follows the comma tells them apart: credentials, or a name.
//   - A title in front is not a first name. "Dr. Amelia Rodriguez" is Amelia.
//   - A particle belongs to the surname behind it. "Mary Van Der Berg" is one
//     surname in three words, which is the rule nameFromEmail already applies
//     to mary.van.der.berg@ - see SURNAME_PARTICLES, shared with it, because
//     the same person pasted two ways has to come out the same.
//   - A generational suffix belongs to the name; a credential does not. "John
//     Smith Jr." keeps the Jr.; "John Smith, PhD" loses the PhD, because a
//     qualification is something he has, not something he is called.
//   - Anything between the first and last name is a middle name, and this
//     form has nowhere to put one, so it is dropped rather than jammed into
//     one of the two boxes.

import { SURNAME_PARTICLES } from './nameFromEmail.js';

// Honorifics. Stripped off the front, never offered as a first name.
const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'professor', 'sir', 'dame',
  'rev', 'fr', 'capt', 'lt', 'col', 'gen', 'sgt', 'hon', 'rabbi', 'imam',
]);

// Letters after the name: what somebody has earned, not what they are
// called. Dropped wherever they appear.
const CREDENTIALS = new Set([
  'phd', 'md', 'dds', 'dvm', 'do', 'jd', 'esq', 'llm', 'mba', 'ma', 'ms',
  'msc', 'ba', 'bs', 'bsc', 'cpa', 'cfa', 'cfp', 'cma', 'pmp', 'pe', 'aia',
  'leed', 'rn', 'np', 'pa', 'mph', 'edd', 'psyd', 'ccim', 'sior', 'faia',
]);

// Part of the name, kept on the surname. No "V": a lone V after a name is
// far more often an initial than a fifth of anybody.
const GENERATIONAL = new Set(['jr', 'sr', 'ii', 'iii', 'iv', '2nd', '3rd', '4th']);

// Match on the word, not the punctuation around it: "Jr.", "Ph.D." and
// "PhD" are all the same token.
function norm(token) {
  return String(token || '').toLowerCase().replace(/[.,]/g, '');
}

function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean);
}

// "smith-jones" and "o'brien" are each one name, so capitalize across the
// punctuation rather than only at the front. Same rule nameFromEmail uses.
function capitalize(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Split a whole name into the two fields a contact form has.
 *
 * @param {string} raw  the name as pasted or typed
 * @returns {{firstname: string, lastname: string} | null}
 *   Either half may be an empty string when the text only evidences one of
 *   them (a mononym gives a first name and no surname). Null when there is
 *   nothing here worth offering.
 */
export function splitFullName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // An address, a phone number or a line off a spreadsheet is not a name,
  // and guessing at one would put junk in the two boxes that matter most.
  if (/[@\d]/.test(s)) return null;
  if (!/[a-z]/i.test(s)) return null;

  // A comma either reverses the name or introduces the letters after it.
  // Which one it is depends on what follows it.
  let tokens;
  const commaAt = s.indexOf(',');
  if (commaAt === -1) {
    tokens = words(s);
  } else {
    const head = words(s.slice(0, commaAt));
    const tail = words(s.slice(commaAt + 1));
    const trailingOnly = tail.length > 0
      && tail.every(t => CREDENTIALS.has(norm(t)) || GENERATIONAL.has(norm(t)));
    // "Sarah Chen, CPA" keeps its order; "Chen, Sarah" is turned back the
    // right way round. A generational suffix is kept either way, so the
    // tail rides along and the pass below files it on the surname.
    tokens = trailingOnly ? [...head, ...tail] : [...tail, ...head];
  }

  // Titles first: they sit in front of the name and are not part of it.
  // Never the last word standing, so "Dr" alone still reads as a name.
  while (tokens.length > 1 && TITLES.has(norm(tokens[0]))) tokens.shift();

  // Then the letters after it. A generational suffix is held back rather
  // than dropped - it goes on the surname once the surname is known.
  const kept = [];
  let suffix = '';
  for (const t of tokens) {
    const n = norm(t);
    if (CREDENTIALS.has(n)) continue;
    if (GENERATIONAL.has(n)) { if (!suffix) suffix = t.replace(/,$/, ''); continue; }
    kept.push(t.replace(/,$/, ''));
  }
  if (kept.length === 0) return null;

  // A signature pasted in block capitals is not a person shouting their
  // name, so it is re-cased. Anything with a lowercase letter in it was
  // cased by a human and is left exactly as they wrote it - McDonald,
  // DeSantis and van Gogh all survive that way, and none of them would
  // survive a blanket re-casing.
  const shouting = !/[a-z]/.test(s);
  const cased = (t) => (shouting ? capitalize(t) : t);

  if (kept.length === 1) {
    // One word. A mononym, or a first name somebody is still typing - either
    // way there is no surname here to claim, and inventing one is how a
    // contact ends up filed under half of their own name.
    const only = cased(kept[0]);
    return suffix
      ? { firstname: '', lastname: `${only} ${cased(suffix)}` }
      : { firstname: only, lastname: '' };
  }

  const [first, ...rest] = kept;
  // Everything from the first particle onward is the surname; without one,
  // the surname is the last word and anything between it and the first name
  // is a middle name this form has nowhere to keep.
  const particleAt = rest.findIndex(t => SURNAME_PARTICLES.has(norm(t)));
  const lastWords = particleAt === -1 ? rest.slice(-1) : rest.slice(particleAt);
  const lastname = [...lastWords, ...(suffix ? [suffix] : [])].map(cased).join(' ');
  return { firstname: cased(first), lastname };
}
