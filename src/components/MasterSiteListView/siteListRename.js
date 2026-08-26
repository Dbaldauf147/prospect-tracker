// Reading and writing the site lists a company rename has to carry.
//
// The rules that decide which cells move live in siteListRenameRules.js
// (pure); this is the IndexedDB half — load both lists, plan the rewrite
// so the caller can put counts in its confirmation prompt, then write
// back only the lists that actually changed.
import { loadList, saveList } from '../../utils/uploadedListStore';
import { renameMasterSiteRows, renameSitesFileRows } from './siteListRenameRules.js';

export { summarizeSiteListRename } from './siteListRenameRules.js';

// The two IDB lists these helpers rewrite. MasterSiteListView imports
// both from here so the keys have one home; SitesView owns the Utility
// Lookup page and declares the sites key itself.
export const MASTER_SITE_LIST_KEY = 'master-site-list-override';
export const UTILITY_SITES_KEY = 'sites-list-override';

/**
 * Read both lists and work out what a rename would change. Async because
 * the lists live in IndexedDB (mirrored to Firestore); a list that fails
 * to load simply contributes nothing rather than failing the rename.
 */
export async function planSiteListRename(oldName, newName) {
  const plan = { master: null, sites: null, masterCount: 0, sitesCount: 0, count: 0 };
  if (!String(oldName || '').trim() || !String(newName || '').trim()) return plan;

  let masterRows = null;
  try { masterRows = await loadList(MASTER_SITE_LIST_KEY); } catch { /* list unavailable — skip this leg */ }
  if (Array.isArray(masterRows)) {
    const res = renameMasterSiteRows(masterRows, oldName, newName);
    if (res.count > 0) { plan.master = res.rows; plan.masterCount = res.count; }
  }

  let siteRows = null;
  try { siteRows = await loadList(UTILITY_SITES_KEY); } catch { /* list unavailable — skip this leg */ }
  if (Array.isArray(siteRows)) {
    const res = renameSitesFileRows(siteRows, oldName, newName);
    if (res.count > 0) { plan.sites = res.rows; plan.sitesCount = res.count; }
  }

  plan.count = plan.masterCount + plan.sitesCount;
  return plan;
}

/** Write back whichever lists the plan actually changed. */
export async function applySiteListRename(plan) {
  if (plan?.master) await saveList(MASTER_SITE_LIST_KEY, plan.master);
  if (plan?.sites) await saveList(UTILITY_SITES_KEY, plan.sites);
}
