// Keeping the Marketing Leads' Company Mapping
// (settings.marketingLeads[].mappedCompany) from being lost.
//
// Same failure as the Salesforce Links (see utils/leadLinks): every writer
// of settings.marketingLeads rewrites the WHOLE array, so a writer holding
// a copy from before a mapping was accepted (another open tab, the Agents
// page pasting links, the bulk "Add to HubSpot" loop that captured the rows
// before its API calls) writes the row back unmapped, and the id-keyed
// settings merge lets that copy win. Mappings accepted on the page came
// back as "Map to account..." on the next load.
//
// Same two layers as the links, both pure so scripts/leadMappings.test.mjs
// can drive them:
//
//  1. guardLeadMappings: a write may not blank a mapping the row already
//     carries unless the caller names that row as a deliberate clear.
//  2. A ledger (settings.marketingLeadMappings) of every mapping set,
//     keyed by lead id. It lives outside the marketingLeads array, so a
//     stale rewrite of the leads never touches it, and a later write puts
//     a mapping back even when this tab's copy was already damaged.

export const LEAD_MAPPING_LEDGER_KEY = 'marketingLeadMappings';

const clean = (v) => String(v ?? '').trim();

// Stop `next` from blanking a mappedCompany that `prev` (or the ledger)
// holds for the same lead id. `allowClear` names the ids whose mapping is
// being cleared on purpose. Returns the same array when nothing needed
// restoring, so a caller can compare by identity.
export function guardLeadMappings(next, prev, allowClear = [], ledger = null) {
  if (!Array.isArray(next)) return { rows: next, restored: [] };
  const clears = new Set((allowClear || []).map(String));
  const known = new Map();
  if (ledger && typeof ledger === 'object') {
    for (const [id, v] of Object.entries(ledger)) {
      const company = clean(v?.company);
      if (company) known.set(String(id), company);
    }
  }
  for (const r of Array.isArray(prev) ? prev : []) {
    const company = clean(r?.mappedCompany);
    if (r?.id != null && company) known.set(String(r.id), company);
  }
  if (!known.size) return { rows: next, restored: [] };
  const restored = [];
  const rows = next.map((r) => {
    if (r?.id == null || clean(r?.mappedCompany)) return r;
    const id = String(r.id);
    const company = known.get(id);
    if (!company || clears.has(id)) return r;
    restored.push({ id, name: clean(r?.name), company });
    return { ...r, mappedCompany: company };
  });
  return restored.length ? { rows, restored } : { rows: next, restored };
}

// Add every mapping in `rows` to the ledger, and drop the entries for
// leads whose mapping was cleared on purpose. Returns the same object when
// nothing changed, so a caller can skip the write.
export function recordLeadMappings(ledger, rows, cleared = [], now = Date.now()) {
  const base = ledger && typeof ledger === 'object' && !Array.isArray(ledger) ? ledger : {};
  let out = base;
  const edit = () => { if (out === base) out = { ...base }; };
  for (const r of Array.isArray(rows) ? rows : []) {
    const company = clean(r?.mappedCompany);
    if (r?.id == null || !company) continue;
    const id = String(r.id);
    if (base[id]?.company === company) continue;
    edit();
    out[id] = { company, at: now };
  }
  for (const id of (cleared || []).map(String)) {
    if (!(id in out)) continue;
    edit();
    delete out[id];
  }
  return out;
}
