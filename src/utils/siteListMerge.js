// Folding a freshly analysed site list into the one a company already has.
//
// A company's site list (settings.companySiteLists[slug]) is built up over
// time: a file for the east region, a spreadsheet from the acquisition, a
// paste from a broker. The Utility Lookup page holds one of those at a
// time, so a "Save to Company" that wrote its rows straight over the
// stored list deleted every site the page didn't happen to have loaded.
// This merges instead — the stored list is the union, and a save adds to
// it and refreshes what it already knew.
//
// Everything here is pure: two { headers, rows } lists in, one out. No
// React, no Firestore — so the matching rules can be tested directly,
// which matters, because getting them wrong either duplicates a site or
// silently folds two different ones together.

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const alnum = (v) => norm(v).replace(/[^a-z0-9]/g, '');

// A postal code as an identity. ZIP+4 keys on its first five digits so
// "60901" and "60901-1234" are one site; anything else (Canadian and
// international codes are alphanumeric) compares whole.
function zipKey(value) {
  const s = alnum(value);
  return /^\d{9}$/.test(s) ? s.slice(0, 5) : s;
}

function pickHeader(headers, patterns) {
  for (const pattern of patterns) {
    const hit = headers.find(h => pattern.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

/**
 * Which of a list's columns say WHICH SITE a row is.
 *
 * Deliberately narrow: this is only ever used to recognise the same site
 * across two lists whose headers may not be spelled the same way. The
 * uploaded spelling is preferred over the analysis's own ("Postal / Zip
 * Code" before the derived "Zip") so a re-save keys off the same column
 * the first save did.
 */
export function identityColumns(headers = []) {
  const list = (headers || []).filter(h => typeof h === 'string');
  return {
    name: pickHeader(list, [/^site\s*name$/i, /\bsite\s*name\b/i, /^site$/i, /^property(\s*name)?$/i, /^facility(\s*name)?$/i, /^location(\s*name)?$/i, /^building(\s*name)?$/i, /\bname\b/i]),
    zip: pickHeader(list, [/^zip\s*code$/i, /^postal\s*\/?\s*zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /\bzip\b/i, /\bpostal\b/i]),
    address: pickHeader(list, [/^address\s*line\s*1$/i, /^address$/i, /^street\s*address$/i, /\baddress\b/i, /\bstreet\b/i]),
    city: pickHeader(list, [/^city$/i, /^town$/i, /\bcity\b/i]),
  };
}

// Every way a row can be recognised, strongest first.
//
// Name + postal code is the pairing worth trusting: "Distribution Center"
// is a name three sites in a portfolio share, and a postal code alone is
// shared by every site on a campus. The weaker keys below it exist for
// lists that carry only one of the two, and are only ever consulted when
// they are unique within their own list (see buildIndex) — an ambiguous
// key merges two different sites together, which is worse than saving one
// twice.
function candidateKeys(row, cols) {
  const name = cols.name ? norm(row[cols.name]) : '';
  const zip = cols.zip ? zipKey(row[cols.zip]) : '';
  const address = cols.address ? norm(row[cols.address]) : '';
  const city = cols.city ? norm(row[cols.city]) : '';

  const strong = [];
  const weak = [];
  if (name && zip) strong.push(`nz:${name}|${zip}`);
  if (address && zip) strong.push(`az:${address}|${zip}`);
  if (address && city) strong.push(`ac:${address}|${city}`);
  if (name) weak.push(`n:${name}`);
  if (address) weak.push(`a:${address}`);

  // Nothing identifies this row (a blank spacer row, a totals line). Key
  // it on its own content so re-saving the same file doesn't stack a
  // fresh copy of it every time — including the wholly empty row, which
  // keys on an empty signature rather than on nothing at all.
  if (!strong.length && !weak.length) {
    const values = Object.keys(row).sort().map(k => norm(row[k])).filter(Boolean);
    weak.push(`sig:${values.join('|')}`);
  }
  return { strong, weak, name, zip, address };
}

// Could these two rows be the same site?
//
// A key says two rows MIGHT be the same; this says whether anything they
// both carry rules it out. Two sites really do share a street address
// ("100 Industrial Way" in two states) and a name ("Distribution
// Center"), so a match on one identity that another identity contradicts
// is a coincidence, not a site.
function compatible(a, aCols, b, bCols) {
  const conflict = (colA, colB, key = norm) => {
    if (!colA || !colB) return false;
    const va = key(a[colA]);
    const vb = key(b[colB]);
    return !!va && !!vb && va !== vb;
  };
  if (conflict(aCols.name, bCols.name)) return false;
  if (conflict(aCols.zip, bCols.zip, zipKey)) return false;
  if (conflict(aCols.address, bCols.address)) return false;
  return true;
}

function buildIndex(rows, cols) {
  const index = new Map();
  const ambiguous = new Set();
  rows.forEach((row, i) => {
    const { strong, weak } = candidateKeys(row, cols);
    for (const key of strong) {
      if (!index.has(key)) index.set(key, i);
    }
    for (const key of weak) {
      // A weak key that two rows share identifies neither of them.
      if (index.has(key)) ambiguous.add(key);
      else index.set(key, i);
    }
  });
  for (const key of ambiguous) index.delete(key);
  return index;
}

/**
 * Merge `incoming` into `existing`, returning the combined list.
 *
 *   { headers, rows, added, updated, matched }
 *
 * Headers are the union, in existing-first order, so a stored list keeps
 * the column order someone is used to reading and new columns arrive at
 * the end. Rows keep their stored order, with the incoming rows that
 * matched nothing appended — a save never reshuffles the list.
 *
 * On a matched row a non-blank incoming value wins (it is the fresher
 * measurement) and a blank one leaves the stored value alone: an upload
 * that happens to omit a column must not erase what another upload filled
 * in. `updated` counts only rows a value actually changed on.
 */
export function mergeIntoSiteList(existing, incoming) {
  const existingHeaders = (existing?.headers || []).filter(h => typeof h === 'string');
  const existingRows = (existing?.rows || []).filter(r => r && typeof r === 'object');
  const incomingHeaders = (incoming?.headers || []).filter(h => typeof h === 'string');
  const incomingRows = (incoming?.rows || []).filter(r => r && typeof r === 'object');

  const headers = [...existingHeaders];
  const seen = new Set(existingHeaders);
  for (const h of incomingHeaders) {
    if (!seen.has(h)) { seen.add(h); headers.push(h); }
  }

  if (!existingRows.length) {
    const rows = incomingRows.map(r => fill(r, headers));
    return { headers, rows, added: rows.length, updated: 0, matched: 0 };
  }

  // Both sides are keyed by their OWN columns: the stored list may have
  // been uploaded with different headers than the page is holding now.
  const existingCols = identityColumns(existingHeaders);
  const incomingCols = identityColumns(incomingHeaders);
  const index = buildIndex(existingRows, existingCols);

  const rows = existingRows.map(r => fill(r, headers));
  let added = 0;
  let updated = 0;
  let matched = 0;

  for (const row of incomingRows) {
    const { strong, weak } = candidateKeys(row, incomingCols);
    let at = -1;
    for (const key of [...strong, ...weak]) {
      if (!index.has(key)) continue;
      const candidate = index.get(key);
      // Every key is only a candidate: take it if nothing the two rows
      // agree to carry says they are different sites.
      if (!compatible(row, incomingCols, existingRows[candidate], existingCols)) continue;
      at = candidate;
      break;
    }

    if (at === -1) {
      rows.push(fill(row, headers));
      added += 1;
      continue;
    }
    matched += 1;
    let changed = false;
    for (const h of headers) {
      const value = row[h];
      if (value === undefined || value === null || value === '') continue;
      if (rows[at][h] !== value) { rows[at][h] = value; changed = true; }
    }
    if (changed) updated += 1;
  }

  return { headers, rows, added, updated, matched };
}

// Every row carries every column, so a merged list renders as a table
// rather than as rows with holes where another upload's columns are.
function fill(row, headers) {
  const out = {};
  for (const h of headers) {
    const v = row[h];
    out[h] = (v === undefined || v === null) ? '' : v;
  }
  return out;
}
