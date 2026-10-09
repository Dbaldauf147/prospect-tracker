// Tier labels as people type them into a Target Accounts workbook: "Tier 3",
// "3", and also roman numerals, "Tier III" or a bare "III". Every reader of
// the list matches digits ("Tier\s*[1-9]"), so a roman tier read as no tier
// at all: Triumph Group's "Tier III" made the company popup offer to move
// the card to Not on tier list. Readers pass a cell through this first so
// the roman forms reach them as digits; anything else comes back unchanged.

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
const ROMAN_RE = '(ix|iv|v?i{1,3}|v)';

export function normalizeTierText(value) {
  const s = String(value ?? '').trim();
  if (!s) return s;
  const bare = s.match(new RegExp(`^${ROMAN_RE}$`, 'i'));
  if (bare) return String(ROMAN[bare[1].toLowerCase()]);
  return s.replace(new RegExp(`\\btier(\\s*[-:]?\\s*)${ROMAN_RE}\\b`, 'gi'),
    (_, sep, r) => `Tier ${ROMAN[r.toLowerCase()]}`);
}
