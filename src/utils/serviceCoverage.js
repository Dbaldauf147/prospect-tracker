// Service Exploration Coverage — how many of your active clients have
// explored each tracked service. Lives here (rather than inside
// PipelineView) because two consumers need the identical numbers: the
// Pipeline page's coverage table / Excel export, and the Issues tab's
// "service coverage below 100%" detector. One implementation means the
// Issues row can never disagree with the row it's warning about.
// Extensions spelled out so this module loads under plain Node too — the
// tests in scripts/ run without Vite's resolver.
import { SERVICE_CATEGORIES } from '../data/enums.js';
import { getServiceCategories } from './serviceCategoriesStore.js';
import { matchesCdm } from './cdmMatch.js';
import { scopeTokens, scopeTokenMatchesService } from './scopeMatch.js';

// Loose company-name match for joining opp Account values to a prospect's
// company. This is a verbatim copy of ProspectModal's companiesMatch so the
// coverage table joins opps to clients EXACTLY as each company page does —
// any looser or stricter and the two views could disagree on which opps
// belong to a client (e.g. "Blackstone" vs "The Blackstone Group L.P.").
export function coverageCompaniesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  const squish = (s) => s.replace(/\s+/g, ' ').trim();
  if (squish(na) === squish(nb)) return true;
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
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// Priority order when an account has several opps naming the same service —
// keep the strongest signal. Mirrors ProspectModal's scopeMatchedServices so
// the coverage table and the company page settle on the same status.
const OPP_STAGE_PRIORITY = { 'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2, 'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0 };

// For each client, the service statuses implied by that client's opportunities
// (open OR closed) — an opp whose Scope names a service makes that service
// "explored", exactly as the company page's Services Explored section treats
// it. Returns Map<prospect, Map<serviceKey, stage>>. Scope text is split on
// ; , / and each part is fuzzily matched against the canonical service list,
// mirroring ProspectModal so the two views can't disagree.
export function buildOppStagesByClient(clients, oppsRecords) {
  const result = new Map();
  if (!Array.isArray(oppsRecords) || oppsRecords.length === 0) return result;
  const opps = [];
  for (const r of oppsRecords) {
    const scope = String(r?.Scope || '').trim();
    if (!scope) continue;
    opps.push({ account: String(r?.Account || ''), scope, stage: String(r?.Stage || '').trim() });
  }
  if (opps.length === 0) return result;
  for (const p of clients) {
    const matched = new Map();
    for (const o of opps) {
      if (!coverageCompaniesMatch(o.account, p.company)) continue;
      for (const part of scopeTokens(o.scope)) {
        for (const cat of SERVICE_CATEGORIES) {
          for (const item of cat.items) {
            if (scopeTokenMatchesService(part, item)) {
              const existing = matched.get(item);
              const existingPri = existing ? (OPP_STAGE_PRIORITY[existing] ?? 1) : -1;
              const newPri = OPP_STAGE_PRIORITY[o.stage] ?? 1;
              if (newPri > existingPri) matched.set(item, o.stage);
            }
          }
        }
      }
    }
    if (matched.size) result.set(p, matched);
  }
  return result;
}

// The status a client's company page would show for one service: a real
// manual value in servicesExplored wins (it's an explicit override), otherwise
// fall back to the status implied by the client's opportunities. Returns '' when
// neither applies — i.e. the service is genuinely unexplored. Mirrors the
// company page's effective-status logic (manual override > opp-derived).
export function effectiveServiceStatus(prospect, serviceKey, oppStagesByClient) {
  const manual = (prospect?.servicesExplored || {})[serviceKey];
  if (manual && manual !== '-') return manual;
  const oppStage = oppStagesByClient?.get(prospect)?.get(serviceKey);
  return oppStage || '';
}

// Service catalogue for the coverage picker/table — the user's custom
// categories when set, otherwise the code defaults; hidden services dropped,
// renames applied for display. Options stay keyed by the canonical service
// name so lookups into each prospect's servicesExplored map line up. Shared by
// the on-screen section and the Excel export so both agree on names + which
// services are eligible.
export function buildServiceCatalog(settings = {}) {
  const hidden = new Set(settings.hiddenServices || []);
  const renames = settings.serviceRenames || {};
  return getServiceCategories(settings)
    .map(cat => ({
      name: cat.name,
      items: (cat.items || [])
        .filter(it => !hidden.has(it))
        .map(it => ({ key: it, label: renames[it] || it })),
    }))
    .filter(cat => cat.items.length > 0);
}

// Canonical service key -> display label (honoring renames), from a catalogue.
export function serviceLabelMap(catalog) {
  const m = new Map();
  for (const cat of catalog) for (const it of cat.items) m.set(it.key, it.label);
  return m;
}

// Renewal Status (Clients tab) that takes a client out of coverage entirely:
// an account that's told us it's cancelling isn't one we'd explore new
// services with, so counting it only drags every service's coverage down.
const EXCLUDED_RENEWAL_STATUS = 'cancelling for sure';

// Does this client's Renewal Status mark it as cancelling? The column is free
// text by default but can be bound to a Dropdowns list (including a
// multi-select), so a value can arrive as a comma-joined list — match on any
// one part rather than the whole string.
export function isCancellingForSure(renewalStatus) {
  return String(renewalStatus || '')
    .split(',')
    .some(part => part.trim().toLowerCase() === EXCLUDED_RENEWAL_STATUS);
}

// Clients-tab maps are keyed by the company name trimmed + lowercased —
// same normalization as normClientName and clientManagerStore's own key.
function coverageKey(company) {
  return String(company || '').trim().toLowerCase();
}

// Every client eligible for coverage before the Clients-tab exclusions:
// Status = Client and matching the configured CDM (or every client when no
// CDM is set). Mirrors the renewals table's client set.
function coverageBaseClients(prospects, cdmName) {
  return (prospects || []).filter(p => {
    if (String(p?.status || '').trim().toLowerCase() !== 'client') return false;
    return cdmName ? matchesCdm(p.cdm, cdmName) : true;
  });
}

// Which Clients-tab flag (if any) takes a client out of coverage. Both mean
// "not an account we'd explore new services with", so counting them only
// drags every service's percentage down. Returns '' when the client counts.
function coverageExclusionOf(prospect, { statusMap, untrackedMap }) {
  const key = coverageKey(prospect?.company);
  if (isCancellingForSure(statusMap?.[key])) return 'cancelling';
  if (untrackedMap?.[key]) return 'untracked';
  return '';
}

// Active clients for coverage, minus anyone the Clients tab marks
// "Cancelling for Sure" (Renewal Status) or "Don't Track". `exclusions`
// carries those two maps — `statusMap` (clients-status-map) and
// `untrackedMap` (clients-untracked-map), both keyed by normalized company
// name. Omit either to skip that exclusion.
export function coverageClientsOf(prospects, cdmName, exclusions = {}) {
  return coverageBaseClients(prospects, cdmName)
    .filter(p => !coverageExclusionOf(p, exclusions));
}

// How many clients each exclusion removed, so a caller can explain a total
// that's smaller than the client count elsewhere. A client that's both
// cancelling and untracked is counted once, under `cancelling`.
export function coverageExclusions(prospects, cdmName, exclusions = {}) {
  let cancelling = 0;
  let untracked = 0;
  for (const p of coverageBaseClients(prospects, cdmName)) {
    const reason = coverageExclusionOf(p, exclusions);
    if (reason === 'cancelling') cancelling += 1;
    else if (reason === 'untracked') untracked += 1;
  }
  return { cancelling, untracked, total: cancelling + untracked };
}

// Is this service status the "N/A" marker — the service doesn't apply to this
// client? It's a real, deliberate answer (so it still counts as explored), but
// it's not exploration activity, which is why callers can split it out.
export function isNotApplicableStatus(status) {
  return String(status || '').trim().toLowerCase() === 'n/a';
}

// Coverage of one service across a client list: who's explored it (with each
// client's status) and who hasn't, plus the rolled-up count / percentage. A
// client counts as "explored" when its company page would show a status for
// the service — a manual servicesExplored value OR an opportunity naming the
// service in its Scope (In Progress / Sold / etc.). `oppStagesByClient` carries
// the opp-derived statuses; pass it so this matches each company page.
//
// The returned lists overlap on purpose: `explored` is every client with a
// status (the coverage count / percentage), and it splits into `exploredActive`
// (a real exploration status) plus `na` (the service doesn't apply). Callers
// that only want the headline number keep using `explored`.
export function computeServiceCoverage(clients, serviceKey, oppStagesByClient) {
  const explored = [];
  const exploredActive = [];
  const na = [];
  const notExplored = [];
  for (const p of clients) {
    const status = serviceKey ? effectiveServiceStatus(p, serviceKey, oppStagesByClient) : '';
    if (status) {
      const entry = { p, status };
      explored.push(entry);
      if (isNotApplicableStatus(status)) na.push(entry);
      else exploredActive.push(entry);
    } else {
      notExplored.push({ p });
    }
  }
  const byName = (a, b) => String(a.p.company || '').localeCompare(String(b.p.company || ''));
  explored.sort(byName);
  exploredActive.sort(byName);
  na.sort(byName);
  notExplored.sort(byName);
  const total = clients.length;
  const pct = total ? Math.round((explored.length / total) * 100) : 0;
  return { explored, exploredActive, na, notExplored, total, pct };
}
