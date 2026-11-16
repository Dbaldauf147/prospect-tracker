// Issues > "Opp company not in Table View" > Resolve: point a company's opps
// at a Table View company, picked from the roster or created there and then.
//
// The opps are tied to a company by name, so mapping sets each one's
// Account to the company's exact name (one Opps save for them all). The old
// spelling(s) can be kept as the company's alias (utils/companyAliases), so
// an import under that name lands on it too. The popup is
// IssuesView/OppCompanyMapModal.jsx; the row is utils/oppCompanyMissing.js.
import { bulkSetOppFields } from './opps2Store';
import { ALIASES_FIELD } from './companyAliases';
import { companyDedupeKey } from './companyKey';

/** The aliases `record` would have with `names` added (new spellings only). */
export function aliasesWith(record, names) {
  const have = Array.isArray(record?.[ALIASES_FIELD]) ? record[ALIASES_FIELD] : [];
  const keys = new Set([companyDedupeKey(record?.company), ...have.map(companyDedupeKey)].filter(Boolean));
  const add = [];
  for (const n of names || []) {
    const name = String(n || '').trim();
    const k = companyDedupeKey(name);
    if (!k || keys.has(k)) continue;
    keys.add(k);
    add.push(name);
  }
  return add.length ? [...have, ...add] : null;
}

/**
 * Map the row's opps to a company. `target` is { mode: 'existing', record }
 * or { mode: 'create', name, status }. Returns { name, created } (`created`
 * false when the roster already had that company, which addProspect hands
 * back instead of adding a second).
 *
 * deps: { uid, prospects, addProspect, updateProspect }.
 */
export async function mapOppsToCompany(resolve, target, { keepAlias = true } = {}, deps = {}) {
  const { uid, prospects = [], addProspect, updateProspect } = deps;
  const oppIds = (resolve?.oppIds || []).map(String);
  if (!oppIds.length) throw new Error('This issue has no opps to map.');
  const spellings = resolve?.accounts?.length ? resolve.accounts : [resolve?.account];

  let record;
  let created = false;
  if (target?.mode === 'create') {
    const name = String(target.name || '').trim();
    if (!name) throw new Error('Type a name for the new company.');
    if (!addProspect) throw new Error('Companies can\'t be added from this page.');
    const id = await addProspect({ company: name, status: target.status || 'Qualifying' });
    if (!id) throw new Error(`"${name}" could not be added to Table View.`);
    const existing = prospects.find(p => p.id === id);
    record = existing || { id, company: name };
    created = !existing;
  } else {
    record = target?.record;
    if (!record?.id || !String(record.company || '').trim()) throw new Error('Pick a Table View company from the list.');
  }

  const name = String(record.company).trim();
  const patches = {};
  for (const id of oppIds) patches[id] = { Account: name };
  // A new company named exactly what the opps say needs no rewrite.
  const needsRewrite = spellings.some(s => String(s || '').trim() !== name);
  if (needsRewrite) await bulkSetOppFields(uid, patches);

  if (keepAlias && updateProspect) {
    const next = aliasesWith(record, spellings.filter(s => String(s || '').trim() !== name));
    if (next) await updateProspect(record.id, { [ALIASES_FIELD]: next });
  }
  return { name, created };
}

/**
 * The Issues tab's "Approve best matches": several rows at once, each to an
 * existing company. `items` is [{ resolve, record }]. One Opps save for every
 * opp, then each company's aliases (all its new spellings in one write).
 * Returns { opps, companies } counts.
 */
export async function mapManyOppsToCompanies(items, { keepAlias = true } = {}, deps = {}) {
  const { uid, updateProspect } = deps;
  const patches = {};
  const spellingsByRecord = new Map();
  for (const { resolve, record } of items || []) {
    const name = String(record?.company || '').trim();
    if (!record?.id || !name) continue;
    for (const id of resolve?.oppIds || []) patches[String(id)] = { Account: name };
    const spellings = (resolve?.accounts?.length ? resolve.accounts : [resolve?.account]).filter(s => String(s || '').trim() && String(s).trim() !== name);
    const entry = spellingsByRecord.get(record.id) || { record, names: [] };
    entry.names.push(...spellings);
    spellingsByRecord.set(record.id, entry);
  }
  const opps = Object.keys(patches).length;
  if (!opps) throw new Error('Nothing to approve: no ticked row has a Table View company.');
  await bulkSetOppFields(uid, patches);
  if (keepAlias && updateProspect) {
    for (const { record, names } of spellingsByRecord.values()) {
      const next = aliasesWith(record, names);
      if (next) await updateProspect(record.id, { [ALIASES_FIELD]: next });
    }
  }
  return { opps, companies: spellingsByRecord.size };
}

/**
 * The Issues tab's "Create ticked as Hold Off companies": several rows at
 * once, each made a NEW Table View company named the opps' Account, at
 * `status` (Hold Off). `items` is [{ resolve }]. Companies are added one at
 * a time through addProspect, whose guard hands back an existing company
 * rather than a second copy, so a name already on Table View is mapped to it
 * instead. Then one Opps save for any opp spelled differently, and the other
 * spellings kept as aliases. Returns { created, existing, opps, failed }.
 *
 * deps: { uid, prospects, addProspect, updateProspect }.
 */
export async function createCompaniesForOpps(items, { status = 'Hold Off', keepAlias = true } = {}, deps = {}) {
  const { uid, prospects = [], addProspect, updateProspect } = deps;
  if (!addProspect) throw new Error('Companies can\'t be added from this page.');
  const known = new Set((prospects || []).map(p => p?.id).filter(Boolean));
  const patches = {};
  const aliasJobs = [];
  let created = 0, existing = 0;
  const failed = [];
  for (const { resolve } of items || []) {
    const name = String(resolve?.account || '').trim();
    if (!name) continue;
    let id;
    try {
      id = await addProspect({ company: name, status });
    } catch (err) {
      failed.push(`${name}: ${err?.message || err}`);
      continue;
    }
    if (!id) { failed.push(`${name}: not added`); continue; }
    const prior = known.has(id) ? prospects.find(p => p.id === id) : null;
    if (prior) existing++; else { created++; known.add(id); }
    const record = prior || { id, company: name };
    const target = String(record.company || name).trim();
    const spellings = (resolve?.accounts?.length ? resolve.accounts : [name]).map(s => String(s || '').trim()).filter(Boolean);
    if (spellings.some(s => s !== target)) {
      for (const oid of resolve?.oppIds || []) patches[String(oid)] = { Account: target };
    }
    const others = spellings.filter(s => s !== target);
    if (others.length) aliasJobs.push({ record, names: others });
  }
  const opps = Object.keys(patches).length;
  if (opps) await bulkSetOppFields(uid, patches);
  if (keepAlias && updateProspect) {
    for (const { record, names } of aliasJobs) {
      const next = aliasesWith(record, names);
      if (next) await updateProspect(record.id, { [ALIASES_FIELD]: next });
    }
  }
  return { created, existing, opps, failed };
}
