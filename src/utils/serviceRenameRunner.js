// Carries a service rename into every store outside settings and the
// prospect records (App.jsx writes those from planServiceMerge). The
// planning is in serviceRenamePlans.js; this file reads each store, writes
// back only what changed, and tells any open view.
//
// Two halves, because the stores live in two places:
//
//   shared   Opps (Firestore, every device), Deal Sizing scopes, the
//            pipeline dashboard, hidden timeline bands (all mirrored to
//            Firestore), and the Contract Language clauses. Run once, by
//            the device that makes the rename.
//   local    the Pricing page's IndexedDB cache and the Account Potential
//            estimate, which live in one browser only. Run on every
//            browser the account is used in.
//
// Each store is its own try: one that fails to load is logged and the rest
// still move, rather than a rename stopping halfway at the first error. A
// store that doesn't answer at all (Firestore offline) gets a time limit,
// so it can't hold up the ones after it; it counts as failed, and the pass
// tries again on the next load.

import { dbGet, dbPut } from './db';
import { loadOpps2Newest, bulkSetOppFields } from './opps2Store';
import { loadClientScopeMap, setClientScopes } from './clientManagerStore';
import { loadPipelineDashboard, PIPELINE_STORE, PIPELINE_KEY, notifyPipelineDashboardChanged } from './pipelineDashboardStore';
import { mirrorDbPut } from './localMirrorSync';
import { saveHiddenServices } from './dealTimelineHiddenStore';
import { userLsGet } from './userLs';
import { loadPricingEstimate, savePricingEstimate } from './pricingEstimateStore';
import { mergeServiceLanguage } from './contractLanguageStore';
import { withTimeout } from './withTimeout';
import {
  planOppsRename, renameLineItemServices, renamePricingOptionServices, renameFeeStructures,
  renameWorkbookServices, renameClientScopeMap, renameEstimate, renamePipeline, renameHiddenBands,
} from './serviceRenamePlans';

// Fired with { from, to } once a rename has been written, so a view holding
// its own copy (Pricing, Opps) can apply it to what it has on screen rather
// than save its stale copy back over the store.
export const SERVICE_RENAMED_EVENT = 'service-renamed';
// Asks an open Opps page to merge in the records a rename just wrote.
export const OPPS2_EXTERNAL_UPDATE_EVENT = 'opps2-external-update';

const PRICING_STORE = 'pricing-cache';

function emit(name, detail) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail })); }
  catch { /* CustomEvent unavailable */ }
}

const STEP_TIMEOUT_MS = 30000;

async function step(label, out, fn) {
  try {
    const n = await withTimeout(Promise.resolve().then(fn), STEP_TIMEOUT_MS, `service rename: ${label}`);
    if (n) out[label] = n;
  } catch (err) {
    console.warn(`Service rename: ${label} failed`, err);
    out.failed = [...(out.failed || []), label];
  }
}

export async function renameServiceShared(uid, { from, to }) {
  const out = {};
  await step('opps', out, async () => {
    const data = await loadOpps2Newest(uid);
    // Not loaded is not the same as nothing to rename: failing here is what
    // makes the pass try again on the next load instead of calling it done.
    if (!data || !Array.isArray(data.records)) throw new Error('Opps data has not loaded yet');
    const patches = planOppsRename(data.records, from, to, data.columnLinks);
    if (!Object.keys(patches).length) return 0;
    const n = await bulkSetOppFields(uid, patches);
    emit(OPPS2_EXTERNAL_UPDATE_EVENT, { from, to });
    return n;
  });
  await step('dealSizing', out, async () => {
    const map = loadClientScopeMap();
    const next = renameClientScopeMap(map, from, to);
    if (!next) return 0;
    const changed = Object.keys(next).filter(k => next[k] !== map[k]);
    setClientScopes(changed.map(k => [k, next[k]]));
    return changed.length;
  });
  await step('pipeline', out, async () => {
    const next = renamePipeline(await loadPipelineDashboard(), from, to);
    if (!next) return 0;
    await mirrorDbPut(PIPELINE_STORE, PIPELINE_KEY, next);
    notifyPipelineDashboardChanged();
    return 1;
  });
  await step('timelineBands', out, async () => {
    let map = {};
    try { map = JSON.parse(userLsGet('deal-timeline-hidden') || '{}') || {}; } catch { map = {}; }
    const next = renameHiddenBands(map, from, to);
    if (!next) return 0;
    const changed = Object.keys(next).filter(k => next[k] !== map[k]);
    for (const k of changed) saveHiddenServices(k, next[k]);
    return changed.length;
  });
  await step('contractLanguage', out, async () => {
    const res = await mergeServiceLanguage(uid, from, to);
    return res?.moved ? 1 : 0;
  });
  return out;
}

export async function renameServiceLocal(uid, { from, to }) {
  const out = {};
  await step('pricing', out, async () => {
    let n = 0;
    const put = async (key, value) => { await dbPut(PRICING_STORE, value, key); n += 1; };
    const lis = renameLineItemServices(await dbGet(PRICING_STORE, 'lineItemServices'), from, to);
    if (lis) await put('lineItemServices', lis);
    const pos = renamePricingOptionServices(await dbGet(PRICING_STORE, 'pricingOptionServices'), from, to);
    if (pos) await put('pricingOptionServices', pos);
    const fs = renameFeeStructures(await dbGet(PRICING_STORE, 'serviceFeeStructures'), from, to);
    if (fs) await put('serviceFeeStructures', fs);
    const current = await dbGet(PRICING_STORE, 'current');
    if (current && typeof current === 'object') {
      const wb = renameWorkbookServices(current.workbook, from, to);
      const cur = renameLineItemServices(current.lineItemServices, from, to);
      if (wb || cur) await put('current', { ...current, ...(wb ? { workbook: wb } : {}), ...(cur ? { lineItemServices: cur } : {}) });
    }
    if (lis) emit('pricing:lineItemServicesChanged', lis);
    if (pos) emit('pricing:optionServicesChanged', pos);
    return n;
  });
  await step('accountPotential', out, async () => {
    const next = renameEstimate(loadPricingEstimate(uid), from, to);
    if (!next) return 0;
    savePricingEstimate(uid, next);
    return 1;
  });
  emit(SERVICE_RENAMED_EVENT, { from, to });
  return out;
}
