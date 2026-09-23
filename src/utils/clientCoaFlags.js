// The client's COA requirements, carried onto its opps.
//
// The company card's Contracts tab records, per client, which COA exceptions
// its contracts need (`coaRequirements` on the company record; see
// clientContracts.js). An opp for that client should say so where the COA
// work happens: the COA Approval Items table marks those rows, and the Flags
// column raises "Client requires COA" while one of them hasn't been sent for
// approval yet.
//
// Pure, so the tests run in plain Node. The caller builds the index once per
// prospects list and hands it to the per-row lookups: the Flags column asks
// for every row on every render, and only the handful of companies that have
// answers are worth scanning.

import { normalizeCompany } from './companyNorm.js';
import { normalizeCoaRequirements } from './clientContracts.js';
import { coaCatalogNames, withCoaCatalog, coaItemStatus } from './coaItems.js';

// The stages an opp is no longer being worked in.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold']);

// The names a company or account goes by: the whole name, the name with any
// "(...)" stripped, and whatever the parentheses hold - the same keys the Opps
// page matches an Account to a company on.
function nameKeys(name) {
  const s = String(name || '').trim();
  const keys = new Set();
  if (!s) return keys;
  const full = normalizeCompany(s);
  if (full) keys.add(full);
  const inParens = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  if (inParens.length) {
    const stripped = normalizeCompany(s.replace(/\([^)]*\)/g, ' '));
    if (stripped) keys.add(stripped);
    for (const a of inParens) {
      const n = normalizeCompany(a);
      if (n) keys.add(n);
    }
  }
  return keys;
}

export const EMPTY_CLIENT_COA_INDEX = Object.freeze({ exact: new Map(), alias: new Map() });

/**
 * Index the companies that have COA answers, by name. The company's own name
 * wins over another company's former name, so an Account that matches one
 * company exactly never picks up a different company's answers.
 */
export function buildClientCoaIndex(prospects) {
  const exact = new Map();
  const alias = new Map();
  for (const p of prospects || []) {
    const reqs = normalizeCoaRequirements(p?.coaRequirements);
    const answers = Object.values(reqs);
    if (!answers.length) continue;
    const entry = {
      company: String(p.company || '').trim(),
      required: answers.filter(a => a.required === 'yes').map(a => ({ item: a.item, notes: a.notes })),
      notRequired: answers.filter(a => a.required === 'no').map(a => ({ item: a.item, notes: a.notes })),
    };
    for (const k of nameKeys(p.company)) if (!exact.has(k)) exact.set(k, entry);
    for (const a of String(p.aliases || '').split(/[\n;,]+/)) {
      for (const k of nameKeys(a)) if (!alias.has(k)) alias.set(k, entry);
    }
  }
  return exact.size || alias.size ? { exact, alias } : EMPTY_CLIENT_COA_INDEX;
}

/** The COA answers for an opp's Account, or null when its client has none. */
export function clientCoaFor(account, index) {
  if (!index) return null;
  const keys = nameKeys(account);
  for (const k of keys) if (index.exact.has(k)) return index.exact.get(k);
  for (const k of keys) if (index.alias.has(k)) return index.alias.get(k);
  return null;
}

/**
 * The COA list with the client's required items added: an item the client
 * needs is a row on its opps even if it has since left the Dropdowns list.
 */
export function catalogWithClientRequired(catalog, entry) {
  return coaCatalogNames([...(catalog || []), ...((entry?.required || []).map(r => r.item))]);
}

/** How the client answered one item: 'yes', 'no' or ''. */
export function clientCoaAnswer(entry, item) {
  const key = String(item || '').trim().toLowerCase();
  if (!entry || !key) return { required: '', notes: '' };
  const hit = (list) => list.find(r => r.item.toLowerCase() === key);
  const yes = hit(entry.required);
  if (yes) return { required: 'yes', notes: yes.notes };
  const no = hit(entry.notRequired);
  if (no) return { required: 'no', notes: no.notes };
  return { required: '', notes: '' };
}

/**
 * The client-required items an open opp hasn't sent for approval yet: not
 * requested, not approved, not marked N/A. What the amber flag names.
 *
 * Nothing on a closed opp, and nothing at Agreement Sent - that stage has its
 * own red "COA approvals needed" flag, which already names every unsettled
 * item, the client's included.
 */
export function clientRequiredCoaNotRequested(row, entry, catalog, dueStage = 'Agreement Sent') {
  if (!row || !entry || !entry.required.length) return [];
  const stage = String(row['Stage'] ?? '').trim();
  if (CLOSED_STAGES.has(stage) || stage === dueStage) return [];
  const rows = withCoaCatalog(row._coaItems, catalogWithClientRequired(catalog, entry));
  const required = new Set(entry.required.map(r => r.item.toLowerCase()));
  return rows.filter(r => required.has(r.item.toLowerCase()) && coaItemStatus(r) === 'open');
}
