// Keeping the Marketing Leads' Salesforce Links (settings.marketingLeads[].sfUrl)
// from being lost.
//
// Every writer of settings.marketingLeads rewrites the WHOLE array: the
// Marketing Leads page, the Agents page's Salesforce Link cells, the BFO
// Activity Leads-subtab paste. A writer holding a copy of the array from
// before a link was set (another open tab, a stale render closure, an
// async loop that captured the rows before it started) writes the row
// back with a blank link, and the id-keyed settings merge lets that copy
// win because it was the most recent write. A whole agent run's worth of
// links went that way.
//
// Three layers, all pure so scripts/leadLinks.test.mjs can drive them:
//
//  1. guardLeadLinks: a write may not blank a link the row already
//     carries unless the caller names that row as a deliberate clear.
//     useUserSettings applies it to every marketingLeads write, and to
//     both sides of a cross-device merge.
//  2. A ledger (settings.marketingLeadLinks) of every link ever set,
//     keyed by lead id. It lives outside the marketingLeads array, so a
//     stale rewrite of the leads never touches it.
//  3. findRecoverableLinks: match leads that are missing a link against
//     the ledger and against settings backups (local and cloud), by id,
//     then email, then name, so a lead that was deleted and re-imported
//     under a new id still gets its link back.

export const LEAD_LINK_LEDGER_KEY = 'marketingLeadLinks';

const clean = (v) => String(v ?? '').trim();
const emailKey = (row) => clean(row?.email).toLowerCase();
// Order-insensitive, so "Blancarte, Victor" and "Victor Blancarte" match.
const nameKey = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(' ');

// Stop `next` from blanking a Salesforce Link that `prev` (or the ledger)
// holds for the same lead id. `allowClear` names the ids whose link is
// being cleared on purpose. Returns the same array when nothing needed
// restoring, so a caller can compare by identity.
//
// The ledger counts as well as `prev` because `prev` can already be the
// damaged copy: a stale rewrite from another tab arrives as an ordinary
// snapshot, and the next write from this tab then restores from the
// ledger instead of carrying the blank on.
export function guardLeadLinks(next, prev, allowClear = [], ledger = null) {
  if (!Array.isArray(next)) return { rows: next, restored: [] };
  const clears = new Set((allowClear || []).map(String));
  const knownUrl = new Map();
  if (ledger && typeof ledger === 'object') {
    for (const [id, v] of Object.entries(ledger)) {
      const url = clean(v?.url);
      if (url) knownUrl.set(String(id), url);
    }
  }
  for (const r of Array.isArray(prev) ? prev : []) {
    const url = clean(r?.sfUrl);
    if (r?.id != null && url) knownUrl.set(String(r.id), url);
  }
  if (!knownUrl.size) return { rows: next, restored: [] };
  const restored = [];
  const rows = next.map((r) => {
    if (r?.id == null || clean(r?.sfUrl)) return r;
    const id = String(r.id);
    const url = knownUrl.get(id);
    if (!url || clears.has(id)) return r;
    restored.push({ id, name: clean(r?.name), url });
    return { ...r, sfUrl: url };
  });
  return restored.length ? { rows, restored } : { rows: next, restored };
}

// Add every link in `rows` to the ledger, and drop the entries for leads
// whose link was cleared on purpose. Returns the same object when
// nothing changed, so a caller can skip the write.
export function recordLeadLinks(ledger, rows, cleared = [], now = Date.now()) {
  const base = ledger && typeof ledger === 'object' && !Array.isArray(ledger) ? ledger : {};
  let out = base;
  const edit = () => { if (out === base) out = { ...base }; };
  for (const r of Array.isArray(rows) ? rows : []) {
    const url = clean(r?.sfUrl);
    if (r?.id == null || !url) continue;
    const id = String(r.id);
    const had = base[id];
    const name = clean(r?.name);
    const email = emailKey(r);
    if (had && had.url === url && had.name === name && had.email === email) continue;
    edit();
    out[id] = { url, name, email, at: had?.url === url ? (had.at || now) : now };
  }
  for (const id of (cleared || []).map(String)) {
    if (!(id in out)) continue;
    edit();
    delete out[id];
  }
  return out;
}

// The ledger as lead-shaped rows, so it can be searched like a backup.
export function ledgerRows(ledger) {
  if (!ledger || typeof ledger !== 'object') return [];
  return Object.entries(ledger)
    .filter(([, v]) => clean(v?.url))
    .map(([id, v]) => ({ id, name: v.name || '', email: v.email || '', sfUrl: v.url }));
}

// For every lead in `rows` with a Name and no Salesforce Link, look for
// its link in `sources` ([{ label, rows }], searched in order). Match by
// id first, then email, then name. A name shared by two different links
// in one source is ambiguous and skipped, rather than guessed.
export function findRecoverableLinks(rows, sources = []) {
  const missing = (Array.isArray(rows) ? rows : [])
    .filter(r => clean(r?.name) && !clean(r?.sfUrl));
  if (!missing.length) return [];
  const indexes = sources.map(({ label, rows: srcRows }) => {
    const byId = new Map();
    const byEmail = new Map();
    const byName = new Map();
    for (const r of Array.isArray(srcRows) ? srcRows : []) {
      const url = clean(r?.sfUrl);
      if (!url) continue;
      if (r?.id != null && !byId.has(String(r.id))) byId.set(String(r.id), url);
      const e = emailKey(r);
      if (e && !byEmail.has(e)) byEmail.set(e, url);
      const n = nameKey(r?.name);
      if (n) {
        const set = byName.get(n) || new Set();
        set.add(url);
        byName.set(n, set);
      }
    }
    return { label, byId, byEmail, byName };
  });
  const out = [];
  for (const r of missing) {
    const id = r?.id != null ? String(r.id) : '';
    const e = emailKey(r);
    const n = nameKey(r?.name);
    for (const ix of indexes) {
      let url = (id && ix.byId.get(id)) || (e && ix.byEmail.get(e)) || '';
      if (!url && n) {
        const set = ix.byName.get(n);
        if (set?.size === 1) [url] = set;
      }
      if (url) {
        out.push({ id, name: clean(r.name), company: clean(r.company), url, source: ix.label });
        break;
      }
    }
  }
  return out;
}

// Write recovered links onto the leads. Only fills blanks: a link that
// was set in the meantime stays as it is.
export function applyRecoveredLinks(rows, recovered) {
  const byId = new Map((recovered || []).map(x => [String(x.id), x.url]));
  if (!byId.size) return rows;
  return (Array.isArray(rows) ? rows : []).map(r => {
    const url = byId.get(String(r?.id));
    return url && !clean(r?.sfUrl) ? { ...r, sfUrl: url } : r;
  });
}
