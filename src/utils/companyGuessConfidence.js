// How sure the HubSpot page is of a guessed company name, as a percentage
// for the review popup. The guess itself is made in HubSpotView (four
// routes, below); this scores it after the fact so the doubtful ones can
// be found among several hundred.
//
//   name-exact    the typed name and the Table View name are the same once
//                 suffixes and punctuation are dropped ("Acme, Inc." and
//                 "Acme Corporation"). 100.
//   domain-known  the contact's email domain is on file for that company.
//                 95.
//   name-loose /  the typed name, or the brand in the email domain, starts
//   domain-loose  the way the Table View name does. Scored on how much of
//                 it the suggestion accounts for, and never above 90.
//
// The loose score asks one question: is everything distinctive in what the
// contact has now explained by the suggested name? "Seritage" inside
// "Seritage Growth Properties" is, so it scores high. "Silvertip" against
// "Silver Lake" leaves "tip" unexplained, so it scores low, even though
// the two share six letters.

// Words that say what kind of firm it is rather than which one.
const GENERIC = new Set([
  'the', 'and', 'of', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'llc', 'lp', 'llp', 'lllp', 'plc', 'holdings', 'group', 'grp',
  'capital', 'partners', 'properties', 'property', 'management', 'investment',
  'investments', 'real', 'estate', 'realty', 'advisors', 'advisers', 'asset',
  'assets', 'trust', 'fund', 'funds', 'financial', 'us', 'usa', 'international',
  'global', 'services', 'associates',
]);

function tokens(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// The tokens that identify the firm; all of them when none do.
function distinctive(name) {
  const all = tokens(name);
  const kept = all.filter((t) => !GENERIC.has(t));
  return kept.length ? kept : all;
}

// "@mail.acme.co.uk" -> "acme": the label that carries the brand.
function domainBrand(source) {
  const labels = String(source || '').replace(/^@/, '').toLowerCase().split('.').filter(Boolean);
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && ['co', 'com', 'org', 'net'].includes(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1] || '';
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// The unexplained tail is fine when it is only a kind-of-firm word glued
// on, as in the domain "amtrustgroup".
function isGenericTail(rest) {
  if (GENERIC.has(rest)) return true;
  for (let i = 2; i < rest.length - 1; i++) {
    if (GENERIC.has(rest.slice(0, i)) && GENERIC.has(rest.slice(i))) return true;
  }
  return false;
}

/**
 * 0-100. `source` is the typed company name, or "@domain" when the guess
 * came from the email address. `match` is the route the guess took.
 */
export function guessConfidence({ source, guess, match }) {
  if (!guess) return 0;
  if (match === 'name-exact') return 100;
  if (match === 'domain-known') return 95;

  const fromDomain = String(source || '').startsWith('@');
  const have = fromDomain ? domainBrand(source) : distinctive(source).join('');
  const want = distinctive(guess);
  const wantLen = want.join('').length;
  if (!have || !wantLen) return 5;

  // Walk the suggested name's words in order, each one taking as much of
  // the front of what is left as it matches. A word has to match whole, or
  // by three letters or more ("infra" for "Infrastructure").
  let rest = have;
  let used = 0;
  for (const word of want) {
    if (!rest) break;
    const n = commonPrefix(rest, word);
    if (n === word.length || n >= 3) {
      rest = rest.slice(n);
      used += n;
    }
  }
  if (rest && used > 0 && isGenericTail(rest)) rest = '';

  if (!rest) return Math.round(75 + 15 * Math.min(1, used / wantLen));
  return Math.max(5, Math.round((used / have.length) * 60));
}

export function confidenceBand(pct) {
  if (pct >= 80) return 'high';
  if (pct >= 50) return 'medium';
  return 'low';
}
