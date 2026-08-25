// Matching contract-extracted service names onto the tracked service
// catalogue. The LLM in /api/contract-services reads a contract and returns
// the services *as the contract words them* ("Resource Advisor Platform
// Subscription", "EED Services"); this module is what turns those into the
// canonical catalogue keys the rest of the app stores in
// `prospect.servicesExplored`.
//
// Deliberately a pure module with no React and no Vite-only imports, with
// explicit file extensions on its own imports, so scripts/contractServices.test.mjs
// can load it under plain Node.

// Lowercase, punctuation to single spaces, and runs of single LETTERS glued
// back together. Every comparison in here runs on this form, so "E.E.D." and
// "EED" both become "eed" and compare equal.
//
// Single digits are deliberately left alone. Gluing them too would fold
// "Cat 1 & 2" and "Cat 12" — two different Scope 3 categories — onto the same
// string, and the catalogue has nine of those to confuse.
export function normServiceName(s) {
  const parts = String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(run.join('')); run = []; } };
  for (const p of parts) {
    if (/^[a-z]$/.test(p)) { run.push(p); continue; }
    flush();
    out.push(p);
  }
  flush();
  return out.join(' ');
}

// Tokens worth comparing. Two-character-or-shorter words ("of", "to", "&")
// carry no signal and would inflate every overlap score — but a bare number
// carries the whole meaning ("Cat 4" is nothing like "Cat 15"), so digits are
// kept whatever their length.
function tokensOf(s) {
  return normServiceName(s).split(' ').filter(t => t.length > 2 || /^\d+$/.test(t));
}

/**
 * How alike two service names are, 0..1.
 *   1.00  the same name
 *   0.85  one name contains the other as a whole phrase ("GHG" in "Comp GHG")
 *   else  share of tokens in common, over the longer token set
 * Both sides are compared on their normalized alphanumeric form.
 *
 * Containment is whole-token, not raw substring, and that is load-bearing:
 * the catalogue is full of two- and three-letter keys (EV, SSO, GRI, IDM,
 * UCA), and a raw substring test scores "EV" 0.85 against "ASHRAE L-EV-el II
 * Energy Audit". Short keys stay safe here because ' ev ' does not occur
 * inside ' level '.
 */
export function scoreMatch(a, b) {
  const na = normServiceName(a);
  const nb = normServiceName(b);
  if (!na || !nb) return 0;
  // Normalization has already glued "E.E.D." down to "eed", so this compares
  // spaces and all — "Cat 1 & 2" must not read as equal to "Cat 12".
  if (na === nb) return 1;
  const pa = ` ${na} `;
  const pb = ` ${nb} `;
  if (pa.includes(pb) || pb.includes(pa)) return 0.85;
  const ta = new Set(tokensOf(a));
  const tb = new Set(tokensOf(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

// Hand-maintained wording variants that fuzzy matching will never reach:
// contract language and catalogue language that mean the same service but
// share no tokens. Consulted only when scoring finds nothing.
//
// ORDER MATTERS. Entries are read top to bottom and the first canonical with
// any matching alias wins, so specific canonicals must sit above generic ones
// — "RA AV report" has to precede "RA dashboards & reporting" or every
// mention of Resource Advisor collapses into the generic dashboard service.
// A `canonical` that isn't in the live catalogue resolves to nothing rather
// than inventing a service, so a renamed or hidden service degrades to
// "no match" instead of writing a key nothing else recognizes.
export const SERVICE_ALIASES = [
  { canonical: 'RA AV report', aliases: ['advanced visualization', 'advanced visualization portal', 'av report', 'av reporting'] },
  { canonical: 'ESPM to RA', aliases: ['espm to resource advisor', 'portfolio manager to resource advisor'] },
  { canonical: 'ESPM link', aliases: ['energy star portfolio manager', 'espm', 'portfolio manager link'] },
  { canonical: 'RA dashboards & reporting', aliases: ['resource advisor', 'ecostruxure resource advisor', 'resource advisor platform', 'resource advisor subscription', 'ra platform', 'sustainability data platform', 'platform subscription'] },
  { canonical: 'Risk managment', aliases: ['risk management', 'risk management services', 'risk managed portfolio services', 'risk managed portfolio'] },
  { canonical: 'E.E.D.', aliases: ['eed', 'eed services', 'energy efficiency directive'] },
  { canonical: 'Invoice recalculation', aliases: ['bill audit', 'invoice audit', 'bill recalculation', 'invoice verification'] },
  { canonical: 'Invoice collection', aliases: ['bill collection', 'invoice acquisition', 'bill acquisition', 'data collection services'] },
  { canonical: 'Bill payment', aliases: ['bill pay', 'utility bill payment', 'bill payment services', 'payment processing'] },
  { canonical: 'IDM', aliases: ['interval data management', 'interval data', 'interval meter data'] },
  { canonical: 'API/ETL', aliases: ['api integration', 'etl', 'data integration', 'systems integration'] },
  { canonical: 'Utility feeds', aliases: ['utility data feeds', 'edi feeds', 'edi data'] },
  { canonical: 'Strategic sourcing', aliases: ['energy supply procurement', 'supply procurement services', 'strategic energy sourcing', 'energy procurement', 'supply management'] },
  { canonical: 'Rate optimization', aliases: ['tariff analysis', 'rate analysis', 'tariff optimization'] },
  { canonical: 'Deposit recovery', aliases: ['utility deposit recovery'] },
  { canonical: 'Open/Close', aliases: ['account open close', 'move in move out', 'open close services'] },
  { canonical: 'Budgets', aliases: ['energy budgeting', 'budget forecasting', 'budgeting and forecasting'] },
  { canonical: 'Peak Alerts', aliases: ['peak alert', 'peak load notification', 'peak day alerts'] },
  { canonical: 'Demand response', aliases: ['demand response program', 'curtailment services', 'load curtailment'] },
  { canonical: 'Water Cost Recovery', aliases: ['water refund', 'water cost recovery services'] },
  { canonical: 'Waste data capture', aliases: ['waste data', 'waste tracking'] },
  { canonical: 'GHG', aliases: ['greenhouse gas inventory', 'ghg inventory', 'carbon accounting', 'carbon footprint', 'scope 1 and 2 inventory', 'corporate carbon footprint'] },
  { canonical: 'Assurance gap assessment', aliases: ['assurance readiness', 'verification readiness'] },
  { canonical: 'CDP climate', aliases: ['cdp response', 'carbon disclosure project', 'cdp climate change'] },
  { canonical: 'GRESB fully managed', aliases: ['gresb', 'gresb submission', 'gresb reporting'] },
  { canonical: 'Ecovadis', aliases: ['ecovadis assessment', 'ecovadis submission'] },
  { canonical: 'CSRD readiness', aliases: ['csrd', 'corporate sustainability reporting directive', 'csrd gap assessment'] },
  { canonical: 'CSRD - DMA - SUCON', aliases: ['double materiality assessment', 'dma'] },
  { canonical: 'Materiality assessment SUCON', aliases: ['materiality assessment'] },
  { canonical: 'Target setting/roadmaps SUCON', aliases: ['science based target', 'science based targets', 'sbti', 'target setting', 'decarbonization roadmap', 'decarbonisation roadmap'] },
  { canonical: 'PPA/VPPA', aliases: ['power purchase agreement', 'virtual power purchase agreement', 'vppa', 'ppa advisory'] },
  { canonical: 'EAC procurement - pull through', aliases: ['rec procurement', 'renewable energy certificates', 'renewable energy certificate procurement', 'eacs', 'eac procurement'] },
  { canonical: 'ENERGY STAR cert', aliases: ['energy star certification', 'energy star'] },
  { canonical: 'Audits', aliases: ['energy audit', 'energy audits', 'ashrae level ii', 'ashrae level 2'] },
  { canonical: 'EV', aliases: ['electric vehicle', 'electric vehicle charging', 'ev charging', 'ev infrastructure'] },
  { canonical: 'SSO', aliases: ['single sign on'] },
  { canonical: 'GRI', aliases: ['global reporting initiative'] },
  { canonical: 'LEED', aliases: ['leed certification'] },
  { canonical: 'Remote assessments', aliases: ['remote energy assessment', 'desktop assessment'] },
  { canonical: 'Corporate Compliance Screening', aliases: ['compliance screening', 'regulatory screening'] },
  { canonical: 'BPS reporting', aliases: ['building performance standards', 'bps compliance'] },
  { canonical: 'Local Law 88', aliases: ['ll88', 'local law 88 compliance'] },
  { canonical: 'Education calls', aliases: ['market education', 'market update calls'] },
];

// A service name's implied category: which catalogue category name it looks
// most like on its own ("Climate risk scenario analysis" implies Climate
// Risk). Used only as a tie-breaker for weak name scores.
function impliedCategory(name, categories) {
  let best = null;
  let bestScore = 0;
  for (const cat of categories) {
    const s = scoreMatch(name, cat.name);
    if (s > bestScore) { bestScore = s; best = cat.name; }
  }
  return bestScore >= 0.4 ? best : null;
}

/**
 * Flatten a catalogue — the [{ name, items: [{ key, label }] }] shape
 * buildServiceCatalog() returns — into the candidate list the matcher walks.
 * Both the canonical key and the user's display rename are matchable, and
 * either one resolves back to the key, which is what servicesExplored stores.
 */
export function catalogCandidates(catalog = []) {
  const out = [];
  for (const cat of catalog) {
    for (const item of cat.items || []) {
      const key = typeof item === 'string' ? item : item.key;
      const label = typeof item === 'string' ? item : (item.label || item.key);
      if (key) out.push({ key, label, category: cat.name });
    }
  }
  return out;
}

/**
 * Map one contract-worded service name onto a catalogue entry.
 * Returns { key, label, category, score, basis } or null when nothing is
 * confident enough — "no match" is the wanted failure, since a reviewer
 * resolves it once from the dropdown and an alias entry fixes it for good.
 *
 * Accepted when the name score is >= 0.5, or >= 0.4 and the name's implied
 * category agrees with the candidate's. Loosening these produces
 * confident-looking wrong mappings; add a SERVICE_ALIASES entry instead.
 */
export function matchCatalogService(rawName, catalog = []) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const candidates = catalogCandidates(catalog);
  if (!candidates.length) return null;
  const categories = catalog.map(c => ({ name: c.name }));
  const implied = impliedCategory(name, categories);

  let best = null;
  for (const cand of candidates) {
    const score = Math.max(scoreMatch(name, cand.key), scoreMatch(name, cand.label));
    const accepted = score >= 0.5 || (score >= 0.4 && implied && implied === cand.category);
    if (!accepted) continue;
    if (!best || score > best.score) best = { ...cand, score, basis: 'score' };
  }
  if (best) return best;

  // Nothing scored: fall back to the hand-maintained wording variants.
  const padded = ` ${normServiceName(name)} `;
  for (const entry of SERVICE_ALIASES) {
    const hit = entry.aliases.some(a => padded.includes(` ${normServiceName(a)} `));
    if (!hit) continue;
    const cand = candidates.find(c => c.key === entry.canonical);
    if (cand) return { ...cand, score: 0.75, basis: 'alias' };
    // Canonical isn't in this catalogue (renamed or hidden): resolve to
    // nothing rather than inventing a key nothing else reads.
  }
  return null;
}

/**
 * Fold the per-file extractions into the one review list the UI shows.
 *
 * `files` is [{ fileName, result }] in the order they were analyzed. Rows are
 * keyed by catalogue match where there is one and by normalized name where
 * there isn't, so "Resource Advisor" in the master agreement and "RA
 * platform" in its amendment land on one row rather than two.
 *
 * A later file's `remove` supersedes an earlier `add` (that is what an
 * amendment terminating a service means) and a later `add` un-removes it.
 * Files must be passed oldest first for that to say what it looks like.
 */
// Joining words that carry no signal in a service name. Dropped only when
// building the ignore key below — every other comparison in this module keeps
// them, because "Cat 1 and 2" is not "Cat 12".
const IGNORE_STOPWORDS = new Set(['and', 'the', 'of', 'for', 'to', 'a', 'an', 'in', 'on', 'with']);

/**
 * The key an "this wording isn't a service" decision is remembered under.
 *
 * Deliberately blunter than the row key. A remembered ignore has to survive
 * the way the same clause is worded from one contract to the next — "Global
 * Research & Analytics" in the amendment, "Global research and analytics" in
 * the renewal — and one that only matches the spelling it was made on is one
 * that doesn't work. So "&" folds to "and" and the joining words come out,
 * leaving both on "global research analytics".
 *
 * A row that DID match the catalogue is keyed by its catalogue key instead:
 * two contracts that both land on "Strategic sourcing" are the same service
 * whatever either of them calls it.
 */
export function ignoreKeyFor(row) {
  const catKey = row?.match?.key;
  if (catKey) return `k:${catKey}`;
  const name = String(row?.name ?? '').replace(/&/g, ' and ');
  const norm = normServiceName(name)
    .split(' ')
    .filter(t => t && !IGNORE_STOPWORDS.has(t))
    .join(' ');
  return `n:${norm}`;
}

// One file's evidence for one service: the short quote that says where the
// service came from, plus the service's scope wording transcribed in full.
// The quote is what the review table shows; the wording is what gets filed
// in the Contract Language library, which wants the clause rather than a
// line of it. A document that names a service without ever setting out its
// scope yields no `language`, and the quote stands in for it.
function evidenceEntry(fileName, svc) {
  const quote = String(svc?.evidence || '').trim();
  const language = String(svc?.scope_language || '').trim();
  if (!quote && !language) return null;
  return { fileName, quote, language };
}

export function mergeExtractedServices(files = [], catalog = []) {
  const rows = new Map();
  for (const file of files) {
    const fileName = file?.fileName || '';
    const services = Array.isArray(file?.result?.services) ? file.result.services : [];
    for (const svc of services) {
      const name = String(svc?.name || '').trim();
      if (!name) continue;
      const match = matchCatalogService(name, catalog);
      const key = match ? `k:${match.key}` : `n:${normServiceName(name)}`;
      const removed = String(svc?.action || 'add').toLowerCase() === 'remove';
      const existing = rows.get(key);
      if (!existing) {
        rows.set(key, {
          key,
          name,
          match,
          removed,
          kind: String(svc?.kind || '').toLowerCase() === 'one_time' ? 'one_time' : 'recurring',
          fee: String(svc?.fee || '').trim(),
          effectiveDate: String(svc?.effective_date || '').trim(),
          confidence: String(svc?.confidence || '').toLowerCase() || 'medium',
          evidence: [evidenceEntry(fileName, svc)].filter(Boolean),
          sources: [fileName].filter(Boolean),
        });
        continue;
      }
      // Later file wins on the facts that can change between amendments.
      existing.removed = removed;
      if (svc?.kind) existing.kind = String(svc.kind).toLowerCase() === 'one_time' ? 'one_time' : 'recurring';
      if (svc?.fee) existing.fee = String(svc.fee).trim();
      if (svc?.effective_date) existing.effectiveDate = String(svc.effective_date).trim();
      const entry = evidenceEntry(fileName, svc);
      if (entry && existing.evidence.length < 5) existing.evidence.push(entry);
      if (fileName && !existing.sources.includes(fileName)) existing.sources.push(fileName);
    }
  }
  return [...rows.values()];
}
