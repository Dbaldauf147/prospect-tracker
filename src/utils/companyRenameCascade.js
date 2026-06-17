// When a company is renamed in the company popup, its name lives on the
// prospect record but many cross-references key off the *name string*
// rather than the record id. This module finds those references and
// repoints them onto the new name so a rename doesn't silently sever:
//
//   • Opportunities — opps store their own free-text `Account`; the
//     Opps↔company linkage is a name match (accountMatchesCompany), so a
//     substantive rename detaches them. We repoint every linked opp's
//     Account onto the new name.
//   • PE portfolio linkage — portfolio companies name their owner in a
//     `peOwner` string; renaming the firm orphans them. We rewrite the
//     matching owner token to the new name.
//   • Dismissed portfolio suggestions — settings.dismissedPortfolioGuesses
//     is keyed by lowercased company name; we move the old key.
//   • Confirmed list-flag mappings (RECA/CSRD/CDP…) — stored per user in
//     localStorage with the confirmed company name as the value; we
//     rewrite values that point at the old name.
//
// HubSpot contacts are migrated by the caller (the company popup), not in
// this plan: it owns the contact cache, the per-contact local overrides, and
// the HubSpot API, and matches contacts with the same fuzzy matcher the popup
// uses. Manual framework flags (prospect.frameworks) and the My Accounts
// activity counts already follow a rename on their own — they read the
// prospect's current name — so they need no migration here.
import { splitPeOwners, joinPeOwners } from './peOwners';
import { LIST_FLAG_SOURCES } from './listFlags';
import { userLsGet, userLsSet } from './userLs';

// Mirror of PEPortfolioView's opp-account matcher so the cascade repoints
// exactly the opps the PE/Opps views consider linked. Kept in sync with
// normalizeAccount / accountMatchesCompany there.
const CO_SUFFIX_RE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|lp|llp|plc|holdings?)\b\.?/gi;
function normalizeAccount(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(CO_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function accountMatchesCompany(companyName, oppAccount) {
  const a = normalizeAccount(companyName);
  const b = normalizeAccount(oppAccount);
  if (!a || !b) return false;
  if (a === b) return true;
  const aWords = a.split(' ');
  const bWords = b.split(' ');
  const [shortW, longW] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];
  if (shortW.length < 2) return false;
  return (' ' + longW.join(' ') + ' ').includes(' ' + shortW.join(' ') + ' ');
}

const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function readListMapping(key) {
  try { const raw = userLsGet(key); return raw ? (JSON.parse(raw) || {}) : null; } catch { return null; }
}

// Build a plan of every name-keyed reference that should move from
// `oldName` to `newName`. Pure/synchronous — opps are passed in as
// `oppsRecords` (the caller loads them from the opps store). The renamed
// record itself is excluded via `currentProspectId`.
export function buildCompanyRenamePlan({ oldName, newName, prospects = [], currentProspectId, settings = {}, oppsRecords = [] }) {
  const plan = { oppIds: [], peOwnerUpdates: [], dismissed: null, listWrites: [], counts: {} };
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old || !next || eq(old, next)) { plan.counts = { opps: 0, peOwner: 0, dismissed: 0, listMappings: 0 }; return plan; }

  // Opps whose Account currently links to the old company name.
  for (const r of oppsRecords) {
    if (r && r._id != null && accountMatchesCompany(old, r['Account'])) plan.oppIds.push(r._id);
  }

  // Other prospects naming the old firm as a PE owner (exact token match,
  // so renaming "Blue Owl Capital" never rewrites a sibling "Blue Owl").
  for (const p of prospects) {
    if (!p || p.id === currentProspectId) continue;
    const owners = splitPeOwners(p.peOwner);
    if (!owners.some(o => eq(o, old))) continue;
    plan.peOwnerUpdates.push({ id: p.id, peOwner: joinPeOwners(owners.map(o => (eq(o, old) ? next : o))) });
  }

  // Dismissed RA/Target suggestions keyed by lowercased name.
  const dg = settings.dismissedPortfolioGuesses;
  if (dg && typeof dg === 'object') {
    const ok = old.toLowerCase();
    const nk = next.toLowerCase();
    let changed = false;
    const moved = { ra: { ...(dg.ra || {}) }, target: { ...(dg.target || {}) } };
    for (const type of ['ra', 'target']) {
      if (moved[type][ok] != null) { moved[type][nk] = moved[type][ok]; delete moved[type][ok]; changed = true; }
    }
    if (changed) plan.dismissed = moved;
  }

  // Confirmed list-flag mappings whose stored value is the old name.
  for (const source of LIST_FLAG_SOURCES) {
    for (const scope of ['my-accounts-mapping', 'portfolio-mapping']) {
      const key = `${source.storageKey}:${scope}`;
      const obj = readListMapping(key);
      if (!obj || typeof obj !== 'object') continue;
      let changed = false;
      const updated = { ...obj };
      for (const [mk, val] of Object.entries(obj)) {
        if (typeof val === 'string' && eq(val, old)) { updated[mk] = next; changed = true; }
      }
      if (changed) plan.listWrites.push({ key, value: updated });
    }
  }

  plan.counts = {
    opps: plan.oppIds.length,
    peOwner: plan.peOwnerUpdates.length,
    dismissed: plan.dismissed ? 1 : 0,
    listMappings: plan.listWrites.length,
  };
  return plan;
}

// True when the plan would change anything outside the renamed record.
export function planHasWork(plan) {
  if (!plan) return false;
  const c = plan.counts || {};
  return !!(c.opps || c.peOwner || c.dismissed || c.listMappings);
}

// Human-readable bullet lines for the confirmation prompt.
export function summarizeRenamePlan(plan) {
  const c = (plan && plan.counts) || {};
  const lines = [];
  if (c.opps) lines.push(`• ${c.opps} opportunit${c.opps === 1 ? 'y' : 'ies'} (Account)`);
  if (c.peOwner) lines.push(`• ${c.peOwner} portfolio compan${c.peOwner === 1 ? 'y' : 'ies'} (PE Owner)`);
  if (c.listMappings) lines.push(`• ${c.listMappings} list mapping${c.listMappings === 1 ? '' : 's'}`);
  if (c.dismissed) lines.push('• dismissed-suggestion entries');
  return lines;
}

// Apply the localStorage list-mapping writes (the opps, prospect, and
// settings writes are applied by the caller, which owns those stores).
export function applyListMappingWrites(plan) {
  for (const w of (plan?.listWrites || [])) {
    try { userLsSet(w.key, JSON.stringify(w.value)); } catch { /* quota etc. — non-fatal */ }
  }
}
