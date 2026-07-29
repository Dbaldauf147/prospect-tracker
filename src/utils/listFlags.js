import { userLsGet } from './userLs';

// Shared helper for computing "which Lists-tab lists is this company
// flagged on" across the app. Used by MyAccountsView's List Flags
// column and the Portfolio Companies table / export.
//
// Strict-mapping mode: a flag turns on only when the user has explicitly
// confirmed a mapping for that list — in either the My Accounts column
// or the Portfolio Companies column on the Lists page. Live fuzzy
// suggestions don't count, since they can light up flags for raw list
// entries the user never decided about. Stale flags from before the
// flag definition tightened were caused by the suggestion path; running
// this version once resolves them.
export const LIST_FLAG_SOURCES = [
  { label: 'Largest',  storageKey: 'largest-list-override', color: { bg: '#FEE2E2', text: '#991B1B' } },
  { label: 'RECA',     storageKey: 'reca-clients-override', color: { bg: '#DBEAFE', text: '#1E40AF' } },
  { label: 'CSRD',     storageKey: 'csrd-list-override',    color: { bg: '#EDE9FE', text: '#5B21B6' } },
  { label: 'CDP',      storageKey: 'cdp-list-override',     color: { bg: '#DCFCE7', text: '#166534' } },
  { label: 'GRESB',    storageKey: 'gresb-list-override',   color: { bg: '#FEF3C7', text: '#92400E' } },
  { label: 'SBT',      storageKey: 'sbt-list-override',     color: { bg: '#FCE7F3', text: '#9D174D' } },
  { label: 'Ecovadis', storageKey: 'ecovadis-list-override', color: { bg: '#E0F2FE', text: '#075985' } },
  { label: 'UN PRI',   storageKey: 'unpri-list-override',   color: { bg: '#F3E8FF', text: '#6B21A8' } },
  { label: 'CA SB',    storageKey: 'casb-list-override',    color: { bg: '#FFEDD5', text: '#9A3412' } },
  { label: 'NZAM',     storageKey: 'nzam-list-override',    color: { bg: '#CCFBF1', text: '#115E59' } },
];
export const LIST_FLAG_BY_LABEL = Object.fromEntries(
  LIST_FLAG_SOURCES.map(s => [s.label, s])
);
// All framework / list-flag labels, in display order, so the modal's
// Frameworks dropdown and the My Accounts column read from the same
// vocabulary.
export const ALL_FRAMEWORK_LABELS = LIST_FLAG_SOURCES.map(s => s.label);

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
  return headers.find(k => /company|name|organi[sz]ation|signatory|entity|\bfirm\b/i.test(k)) || headers[0];
}

// List mappings (which row maps to which prospect/portfolio company)
// are personal salesperson curation, so they're scoped per user via
// userLs. The lists themselves stay shared per CLAUDE.md.
export function safeReadListMapping(storageKey) {
  try {
    const raw = userLsGet(storageKey);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Compute which framework labels each of the given company names should
// show. Returns a Map keyed by the lowercased-trimmed company name to a
// Set of labels (e.g. 'CDP', 'GRESB'). A label turns on when EITHER:
//   - The prospect's frameworks array (manual edits from the modal)
//     includes that label.
//   - The Lists page has a confirmed mapping (My Accounts or Portfolio
//     scope) on the corresponding list pointing to that company.
// The union means the Lists page and the modal are the same data: an
// edit in either surface shows up in both.
//
// The function is async for backwards compatibility with existing call
// sites that await it; the body itself runs synchronously.
export async function computeListFlags(names, opts = {}) {
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

  // Pull in the prospect.frameworks signal. We match a prospect to a
  // target name by exact lowercased-trimmed equality on `company` —
  // tighter than companiesMatch on purpose, since this side has a real
  // identifier to anchor on.
  const prospectsByKey = new Map();
  for (const p of (opts.prospects || [])) {
    const key = String(p?.company || '').toLowerCase().trim();
    if (key) prospectsByKey.set(key, p);
  }
  for (const t of targets) {
    const p = prospectsByKey.get(t.key);
    if (!p || !Array.isArray(p.frameworks)) continue;
    for (const label of p.frameworks) {
      if (typeof label === 'string' && label) addFlag(t.key, label);
    }
  }

  for (const source of LIST_FLAG_SOURCES) {
    const myAccountsMapping = safeReadListMapping(`${source.storageKey}:my-accounts-mapping`);
    const portfolioMapping = safeReadListMapping(`${source.storageKey}:portfolio-mapping`);
    // Confirmed values from either mapping store flag the matching
    // target. Both stores hold values keyed by an opaque match key —
    // the values are the prospect/portfolio company names the user
    // confirmed. We only care about those values.
    for (const confirmed of [...Object.values(myAccountsMapping), ...Object.values(portfolioMapping)]) {
      if (typeof confirmed !== 'string' || !confirmed) continue;
      for (const t of targets) {
        if (companiesMatch(t.company, confirmed)) {
          addFlag(t.key, source.label);
          break;
        }
      }
    }
  }
  return flags;
}
