// How two company names are compared to decide whether they are the SAME
// company. Pure — no Firestore, no React — so the Google Sheets diff can
// share it with the duplicate collapse, and so scripts/companyKey.test.mjs
// can exercise it directly.
//
// This lives in its own module rather than in firestoreSync because the
// sheet sync (utils/sheetSyncDiff) must stay importable without pulling in
// the firebase SDK. firestoreSync re-exports everything here, so existing
// importers are unaffected.

// Corporate suffixes / structural tokens stripped before comparing two
// company names. Mirrors the normalization used by the My Accounts
// "similar names" detector so the de-dupe collapses exactly the
// records the UI already flags as the same company.
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;

// Parenthetical tags that mark which portfolio list a row came from
// rather than which company it is. "Chamberlain", "Chamberlain (BX)" and
// "Chamberlain (BX-PC)" are one company filed three ways.
const LIST_MARKERS = new Set(['bx', 'bx pc', 'bx pe', 'pc', 'pe', 'ppc', 'ppc pc']);

function basicClean(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ');
}

// Collapse a run of two or more single-character words into one token, so
// punctuated initials and their run-together spelling reduce alike:
// "H.I.G. Capital" and "HIG Capital" both become "hig capital". A lone
// single letter is left alone — "Fund A" and "Fund B" are not the same.
function collapseInitials(s) {
  return s.replace(/\b(?:[a-z0-9] )+[a-z0-9]\b/g, m => m.replace(/ /g, ''));
}

// A trailing ownership appositive written without parentheses:
// "Nuveen Real Estate, a TIAA Co." Same noise as "(a TIAA co.)", which
// the parenthetical strip already removes, so it comes off here too —
// 27 names in the sheet are filed this way. Anchored to the end and
// required to close on a corporate suffix, so it can't eat a comma'd
// name that happens to contain the word "a".
const TRAILING_OWNER = /,\s+an?\s+[^,]*?\b(co|company|corp|corporation|inc|ltd|limited|llc|lp|ag|sa|ab|nv|bv|plc|group|holdings)\b\.?\s*$/i;

// Normalize a company name to a comparison key: lowercase, drop
// diacritics, strip parentheticals/brackets, trailing ownership notes
// and corporate suffixes, then collapse punctuation to single spaces.
// "Affinius Capital" and "Affinius Capital, a USAA Co." both reduce to
// "affinius capital".
export function normalizeCompanyName(s) {
  return collapseInitials(
    basicClean(String(s || '').replace(TRAILING_OWNER, ''))
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(CORP_SUFFIXES, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

// One parenthetical / bracketed tag, normalized the same way a name is.
function normalizeQualifierText(s) {
  return basicClean(s)
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every parenthetical / bracketed tag on a name, normalized. Corporate
// suffixes inside a tag are still removed so an ownership note like
// "(a Brookfield Co.)" collapses to "a brookfield" rather than surviving
// as junk.
function qualifierParts(s) {
  const parts = [];
  const re = /[([]([^)\]]*)[)\]]/g;
  let m;
  while ((m = re.exec(String(s || ''))) !== null) {
    const tag = normalizeQualifierText(m[1]);
    if (tag) parts.push(tag);
  }
  return parts;
}

// Pull out and normalize any parenthetical / bracketed qualifier so it can
// be kept as part of a record's identity. normalizeCompanyName() throws
// these away — which is right for stripping noise like "(a USAA Co.)" but
// wrong when the qualifier is the ONLY thing distinguishing two records,
// e.g. "Brookfield (Dubai)" vs "Brookfield (NAM Multifamily)".
// Returns '' when there is no qualifier at all.
export function companyQualifier(s) {
  return qualifierParts(s).sort().join(' ');
}

// Words of a name, keeping corporate suffixes (an acronym is built from
// the name as written — "IRG" spells out "Industrial Realty Group",
// suffix included) and dropping the "and" that "&" expands to.
function lightTokens(s) {
  return basicClean(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t && t !== 'and');
}

const initialsOf = (tokens) => tokens.map(t => t[0]).join('');
const compactOf = (tokens) => tokens.join('');

// Does this tag say WHICH company this is, or only something about it?
// Only identifying tags belong in the dedupe key — an ownership note or a
// list marker must not keep two copies of one company apart.
function isIdentifyingQualifier(normalized, raw, baseTokens, baseNormTokens) {
  if (!normalized) return false;
  // "(a Blackstone co.)", "(an Apollo co.)" — who owns it, not who it is.
  if (/^an?\b/.test(normalized)) return false;
  // "(BX-PC)", "(PPC)" — which list it was pulled from.
  if (LIST_MARKERS.has(normalized)) return false;

  const qTokens = lightTokens(raw);
  if (baseTokens.length && qTokens.length) {
    // The name's own acronym: "Clayton, Dubilier & Rice (CD&R)".
    if (compactOf(qTokens) === initialsOf(baseTokens)) return false;
    // Or the name spelled out: "IRG (Industrial Realty Group)".
    if (initialsOf(qTokens) === compactOf(baseTokens)) return false;
  }
  // Or words the name already contains: "Berkshire Residential
  // Investments (Berkshire Group)". Compared suffix-stripped on both
  // sides, so the "Group" in the tag isn't what keeps the two apart.
  const qNorm = normalized.split(' ').filter(Boolean);
  if (baseNormTokens.length && qNorm.length) {
    const baseSet = new Set(baseNormTokens);
    if (qNorm.every(t => baseSet.has(t))) return false;
  }
  return true;
}

// The qualifiers that genuinely distinguish one record from another,
// normalized and sorted. "Brookfield (Dubai)" keeps "dubai"; "Edens (a
// Blackstone co.)" keeps nothing.
export function identifyingQualifier(s) {
  const raws = [];
  const re = /[([]([^)\]]*)[)\]]/g;
  let m;
  while ((m = re.exec(String(s || ''))) !== null) raws.push(m[1]);
  if (!raws.length) return '';
  const bare = String(s || '').replace(/[([][^)\]]*[)\]]/g, ' ');
  const baseTokens = lightTokens(bare);
  const baseNormTokens = normalizeCompanyName(bare).split(' ').filter(Boolean);
  const kept = [];
  for (const raw of raws) {
    const normalized = normalizeQualifierText(raw);
    if (isIdentifyingQualifier(normalized, raw, baseTokens, baseNormTokens)) kept.push(normalized);
  }
  return kept.sort().join(' ');
}

// The key two records must share to be treated as the SAME company: the
// normalized base name with spaces removed, plus any qualifier that
// actually identifies the record.
//
// Spaces come out of the base because a word break is not an identity:
// "LendLease" / "Lend Lease" and "Citi Bank" / "Citibank" are each one
// company entered two ways, and every path that mints an account — the
// sheet import, the paste importers, the opps auto-add — was reading them
// as two.
//
// Records that differ only by a corporate suffix still merge ("Brookfield
// Inc." == "Brookfield"), and records distinguished solely by a region or
// segment tag stay separate ("Brookfield (Dubai)" != "Brookfield (NAM
// Multifamily)").
export function companyDedupeKey(s) {
  const base = normalizeCompanyName(s).replace(/ /g, '');
  if (!base) return '';
  const qual = identifyingQualifier(s);
  return qual ? `${base}|${qual}` : base;
}
