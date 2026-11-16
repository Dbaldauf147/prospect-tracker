// The services each client reads N/A on without anybody setting it, the two
// ways the company popup's Services board derives one:
//
//  - a sold service retires it (the Auto-N/A Services column on Dropdowns ›
//    Services, utils/serviceAutoNa), and
//  - its contact category is N/A at the company: the By Category heading's
//    N/A, or a contact there with that category's tag marked N/A
//    (bucketServices.categoryNaServices).
//
// The Service Exploration Coverage table counted neither, so a company the
// popup showed as N/A sat under "Not yet explored". Pass the result to
// computeServiceCoverage / effectiveServiceStatus as `autoNaByClient`.
import { BUCKETS } from '../components/ProspectModal/contactTags.js';
import { serviceBucketContext, categoryNaServices } from './bucketServices.js';
import { collectAutoNa, isSoldStatus } from './serviceAutoNa.js';
import { applyCompanyOverride, makeAccountRecordLookup } from './contactRosters.js';

/**
 * Map(client record -> Set of service names that read N/A automatically).
 * `contacts` are the HubSpot contacts (Company pins are applied here);
 * `oppStagesByClient` is buildOppStagesByClient's map, for services sold
 * through an opp.
 */
export function buildAutoNaByClient(clients, { settings = {}, contacts = [], oppStagesByClient = null } = {}) {
  const out = new Map();
  if (!clients?.length) return out;
  const ctx = serviceBucketContext(settings);
  const canonical = (n) => ctx.byLower.get(String(n || '').trim().toLowerCase()) || n;
  const tagReview = settings?.contactTagReview || {};

  const recordOf = makeAccountRecordLookup(clients);
  const contactsByClient = new Map();
  if (Object.keys(tagReview).length) {
    for (const base of contacts || []) {
      const c = applyCompanyOverride(base, settings?.contactLocalFields);
      if (!tagReview[String(c?.id ?? c?.vid ?? '')]) continue;
      const rec = recordOf(c);
      if (!rec) continue;
      if (!contactsByClient.has(rec)) contactsByClient.set(rec, []);
      contactsByClient.get(rec).push(c);
    }
  }

  for (const p of clients) {
    const svc = p?.servicesExplored || {};
    const statusOf = (n) => {
      const manual = String(svc[n] ?? '').trim();
      if (manual && manual !== '-') return manual;
      return oppStagesByClient?.get(p)?.get(n) || '';
    };
    const set = new Set();
    const sold = ctx.names.filter(n => isSoldStatus(statusOf(n)));
    if (sold.length) {
      for (const [name, by] of collectAutoNa(sold, ctx.overrides, { names: ctx.names, canonical })) {
        if (by && (!Array.isArray(by) || by.length)) set.add(name);
      }
    }
    const byCategory = categoryNaServices({
      buckets: BUCKETS, serviceNames: ctx.names, overrides: ctx.overrides,
      dmSearchSteps: p?.dmSearchSteps || null, contacts: contactsByClient.get(p) || [], tagReview,
    });
    for (const name of byCategory.keys()) set.add(name);
    if (set.size) out.set(p, set);
  }
  return out;
}
