// Shared helper for computing "which Lists-tab lists is this company
// flagged on" across the app. Used by MyAccountsView's List Flags
// column and the Portfolio Companies table / export.

import { loadList as loadListFromIDB } from './uploadedListStore';

// Every list tab on the Lists view that stores its uploaded file under
// the UploadedListView convention. Keyed by the same storageKey the
// consumers pass in so we can read both the per-list confirmed
// mappings and (when present) the full list data to pick up
// non-dismissed fuzzy suggestions too.
export const LIST_FLAG_SOURCES = [
  { label: 'RECA',     storageKey: 'reca-clients-override', color: { bg: '#DBEAFE', text: '#1E40AF' } },
  { label: 'CSRD',     storageKey: 'csrd-list-override',    color: { bg: '#EDE9FE', text: '#5B21B6' } },
  { label: 'CDP',      storageKey: 'cdp-list-override',     color: { bg: '#DCFCE7', text: '#166534' } },
  { label: 'GRESB',    storageKey: 'gresb-list-override',   color: { bg: '#FEF3C7', text: '#92400E' } },
  { label: 'SBT',      storageKey: 'sbt-list-override',     color: { bg: '#FCE7F3', text: '#9D174D' } },
  { label: 'Ecovadis', storageKey: 'ecovadis-list-override', color: { bg: '#E0F2FE', text: '#075985' } },
  { label: 'UN PRI',   storageKey: 'unpri-list-override',   color: { bg: '#F3E8FF', text: '#6B21A8' } },
  { label: 'CA SB',    storageKey: 'casb-list-override',    color: { bg: '#FFEDD5', text: '#9A3412' } },
];
export const LIST_FLAG_BY_LABEL = Object.fromEntries(
  LIST_FLAG_SOURCES.map(s => [s.label, s])
);

const LIST_CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
export function normalizeListCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(LIST_CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fuzzy company-name match (looser than normalizeListCompany) so we
// catch cases like "Blue Owl" ↔ "Blue Owl Capital". Mirrors the
// MyAccountsView companiesMatch helper exactly so the two views stay
// consistent.
export function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  return false;
}

export function pickListNameKey(headers) {
  if (!headers?.length) return null;
  return headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k)) || headers[0];
}

export function safeReadListMapping(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Compute which List tabs each of the given company names has been
// flagged on. Checks both (a) confirmed My-Account mappings on each
// list and (b) non-dismissed fuzzy suggestions from the raw list
// rows. Returns a Map keyed by the lowercased-trimmed company name to
// a Set of list labels (e.g. 'CDP', 'GRESB').
export async function computeListFlags(names) {
  const flags = new Map();
  const addFlag = (companyKey, label) => {
    if (!companyKey) return;
    if (!flags.has(companyKey)) flags.set(companyKey, new Set());
    flags.get(companyKey).add(label);
  };
  const targets = (names || [])
    .filter(Boolean)
    .map(n => ({ company: n, key: String(n).toLowerCase().trim() }))
    .filter(t => t.key);
  if (!targets.length) return flags;

  for (const source of LIST_FLAG_SOURCES) {
    const mapping = safeReadListMapping(`${source.storageKey}:my-accounts-mapping`);
    const dismissed = safeReadListMapping(`${source.storageKey}:my-accounts-dismissed`);

    // 1. Confirmed My-Account mappings.
    for (const confirmed of Object.values(mapping)) {
      if (typeof confirmed !== 'string') continue;
      for (const t of targets) {
        if (companiesMatch(t.company, confirmed)) {
          addFlag(t.key, source.label);
          break;
        }
      }
    }

    // 2. Non-dismissed fuzzy suggestions from the uploaded list.
    try {
      const listRows = await loadListFromIDB(source.storageKey);
      if (!Array.isArray(listRows) || listRows.length === 0) continue;
      const headers = Object.keys(listRows[0] || {});
      const nameKey = pickListNameKey(headers);
      if (!nameKey) continue;
      for (const row of listRows) {
        const rawName = String(row[nameKey] ?? '').trim();
        if (!rawName) continue;
        const norm = normalizeListCompany(rawName);
        if (!norm) continue;
        const matchKey = `name::${norm}`;
        if (dismissed[matchKey]) continue;
        if (mapping[matchKey]) continue;
        for (const t of targets) {
          if (companiesMatch(t.company, rawName)) {
            addFlag(t.key, source.label);
            break;
          }
        }
      }
    } catch {}
  }
  return flags;
}
