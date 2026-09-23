// The company card's Contracts tab: the client's agreements off the Deals
// subtab, and which COA exceptions this client's contracts need.
//
// Two halves, both pure so the tests can run in plain Node.
//
// AGREEMENTS. The Deals subtab holds the uploaded contract rows, keyed by a
// free-typed Client Name, and the Clients tab groups them under a client
// through the user's source-name -> client mapping (groupDealsByClient). The
// card does the same grouping and takes the bucket for the company's own
// name plus its former names (the Aliases field), so an account that was
// renamed still shows the contracts signed under the old one.
//
// COA REQUIREMENTS. The COA list on the Dropdowns page (COA Items tab) is the
// set of exceptions an opp can need signed off. Some clients need an item on
// every deal - their MSA carries a 3% escalator, say - and some never do. The
// card records that per client under `coaRequirements` on the company record:
//
//   { [lowercased item]: { item, required: 'yes' | 'no' | '', notes } }
//
// Keyed on the lowercased name so "3% esc" and "3% ESC" are one answer, with
// the spelling kept alongside for display. An item nobody has answered is
// simply absent, so an untouched company carries nothing.

import { asDate, asNumber, isInactiveAgreement } from './dealsFormat.js';
import { coaCatalogNames } from './coaItems.js';

// Same key and the same source-name -> client remapping as clientIssues'
// groupDealsByClient, which the Clients tab uses. Restated rather than
// imported so this module loads in plain Node for its test.
function normClientName(s) {
  return String(s || '').trim().toLowerCase();
}
function dealClientKey(deal, clientMap) {
  const raw = normClientName(deal?.['Client Name']);
  if (!raw) return '';
  const mapped = clientMap?.[raw];
  return mapped ? normClientName(mapped) : raw;
}

export const COA_REQUIRED_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'yes', label: 'Required' },
  { value: 'no', label: 'Not required' },
];

/** The names this company's contracts may be filed under on the Deals subtab. */
export function companyClientNames(company, aliases) {
  const out = [];
  const seen = new Set();
  const all = [company, ...String(aliases || '').split(/[\n;,]+/)];
  for (const v of all) {
    const k = normClientName(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * The deal rows that belong to this company, active agreements first and
 * each group by End Date ascending (undated last) - the order the Clients
 * tab's drill-down uses.
 */
export function dealsForCompany(dealsList, clientMap, company, aliases) {
  const names = new Set(companyClientNames(company, aliases));
  if (!names.size) return [];
  const rows = (dealsList || []).filter(d => names.has(dealClientKey(d, clientMap)));
  return rows.sort((a, b) => {
    const ai = isInactiveAgreement(a) ? 1 : 0;
    const bi = isInactiveAgreement(b) ? 1 : 0;
    if (ai !== bi) return ai - bi;
    const ad = asDate(a['End Date']);
    const bd = asDate(b['End Date']);
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad.getTime() - bd.getTime();
  });
}

/** The headline figures for the summary strip. */
export function contractsSummary(deals, nowMs = Date.now()) {
  const list = deals || [];
  const active = list.filter(d => !isInactiveAgreement(d));
  const sum = (key) => {
    let total = 0;
    let any = false;
    for (const d of active) {
      const n = asNumber(d[key]);
      if (n != null) { total += n; any = true; }
    }
    return any ? total : null;
  };
  let firstStart = null;
  for (const d of list) {
    const s = asDate(d['Original Contract Start']);
    if (s && (!firstStart || s < firstStart)) firstStart = s;
  }
  // The earliest End Date across the active agreements, as the Clients
  // tab's Soonest Expiration column reads it.
  let soonestEnd = null;
  for (const d of active) {
    const e = asDate(d['End Date']);
    if (e && (!soonestEnd || e < soonestEnd)) soonestEnd = e;
  }
  let soonestEndDays = null;
  if (soonestEnd) {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const end = new Date(soonestEnd);
    end.setHours(0, 0, 0, 0);
    soonestEndDays = Math.round((end.getTime() - today.getTime()) / 86400000);
  }
  return {
    total: list.length,
    active: active.length,
    inactive: list.length - active.length,
    recurring: sum('Recurring Revenue'),
    setup: sum('Setup'),
    firstStart,
    soonestEnd,
    soonestEndDays,
    autoRenewCount: active.filter(d => /^(y|yes|true|x|1)$/i.test(String(d['Auto renewal?'] ?? '').trim())).length,
  };
}

/** Clean a stored requirements map. Forgiving: hand-edited, long-lived data. */
export function normalizeCoaRequirements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const item = String(v.item ?? k ?? '').trim();
    const key = item.toLowerCase();
    if (!key) continue;
    const req = String(v.required ?? '').trim().toLowerCase();
    const required = req === 'yes' || req === 'no' ? req : '';
    const notes = String(v.notes ?? '');
    if (!required && !notes.trim()) continue;
    out[key] = { item, required, notes };
  }
  return out;
}

/**
 * One row per COA list item, in the list's order, carrying this client's
 * answer; then any item answered on this client that the list no longer
 * names, so removing an item from the Dropdowns tab never loses what was
 * recorded against it.
 */
export function coaRequirementRows(raw, catalog) {
  const stored = normalizeCoaRequirements(raw);
  const rows = [];
  const used = new Set();
  for (const item of coaCatalogNames(catalog)) {
    const key = item.toLowerCase();
    used.add(key);
    const s = stored[key];
    rows.push({ key, item, required: s?.required || '', notes: s?.notes || '', inCatalog: true });
  }
  for (const [key, s] of Object.entries(stored)) {
    if (used.has(key)) continue;
    rows.push({ key, item: s.item, required: s.required, notes: s.notes, inCatalog: false });
  }
  return rows;
}

/**
 * The stored map with one item's answer changed. An item left with no
 * answer and no notes is dropped, so clearing a row leaves no trace.
 */
export function setCoaRequirement(raw, item, patch) {
  const next = normalizeCoaRequirements(raw);
  const label = String(item ?? '').trim();
  const key = label.toLowerCase();
  if (!key) return next;
  const cur = next[key] || { item: label, required: '', notes: '' };
  const merged = { ...cur, ...patch, item: cur.item || label };
  const req = String(merged.required ?? '').trim().toLowerCase();
  merged.required = req === 'yes' || req === 'no' ? req : '';
  merged.notes = String(merged.notes ?? '');
  if (!merged.required && !merged.notes.trim()) delete next[key];
  else next[key] = merged;
  return next;
}

/** Counts for the section header. */
export function coaRequirementsSummary(rows) {
  const list = rows || [];
  return {
    total: list.length,
    required: list.filter(r => r.required === 'yes').length,
    notRequired: list.filter(r => r.required === 'no').length,
    unset: list.filter(r => !r.required).length,
  };
}
