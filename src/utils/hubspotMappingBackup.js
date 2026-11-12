// Backups of the Hubspot Mapping page's two stores (hubspotMappingStore.js):
// the company export with Dan's account links, and the activity history.
// The page's backup bar (components/MyAccountsView/HubspotMappingBackup.jsx)
// downloads them as a file of their own, and restores from any of the
// three places a copy can be:
//
//   * that file                           { format, version, mapping, activity }
//   * the Backups page's full backup      env.firestore.{hubspotMapping, hubspotActivity}
//   * a nightly / Back up now snapshot    collections.lookupTables['hubspot-mapping' | 'hubspot-activity']
//
// A restore is ADDITIVE (fullBackup's mergeHubspot*Restore): what is here
// now wins, the backup fills in lost links and activities, so restoring an
// old copy can't take away anything added since.
//
// Pure: runs under plain Node in scripts/hubspotMappingBackup.test.mjs.

import { mergeHubspotMappingRestore, mergeHubspotActivityRestore, FULL_BACKUP_FORMAT } from './fullBackup.js';
import { mergeActivities, activityKey } from './hubspotActivity.js';

export const HUBSPOT_BACKUP_FORMAT = 'prospect-tracker-hubspot-mapping-backup';

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** The file the Download button saves. */
export function buildHubspotBackupFile({ mapping, activity, now = new Date() } = {}) {
  return {
    format: HUBSPOT_BACKUP_FORMAT,
    version: 1,
    createdAt: now.toISOString(),
    mapping: obj(mapping) || { companies: [], links: {}, meta: {} },
    activity: obj(activity) || { activities: [], meta: {} },
  };
}

export function hubspotBackupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `hubspot-mapping-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/**
 * The mapping and activity a parsed backup holds, whichever of the three
 * shapes it is: { mapping, activity, createdAt } (either may be null), or
 * null when it is none of them.
 */
export function readHubspotBackup(parsed) {
  const p = obj(parsed);
  if (!p) return null;
  if (p.format === HUBSPOT_BACKUP_FORMAT) {
    return { mapping: obj(p.mapping), activity: obj(p.activity), createdAt: p.createdAt || null };
  }
  if (p.format === FULL_BACKUP_FORMAT) {
    const cloud = obj(p.firestore) || {};
    const mapping = obj(cloud.hubspotMapping);
    const activity = obj(cloud.hubspotActivity);
    return mapping || activity ? { mapping, activity, createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null } : null;
  }
  // A nightly snapshot, whole or as backup-fetch's part=lookupTables value.
  const lt = obj(p.collections?.lookupTables) || (p['hubspot-mapping'] !== undefined || p['hubspot-activity'] !== undefined ? p : null);
  if (lt) {
    const mapping = obj(lt['hubspot-mapping']);
    const activity = obj(lt['hubspot-activity']);
    return mapping || activity ? { mapping, activity, createdAt: p.generatedAt || null } : null;
  }
  return null;
}

/**
 * What restoring `backup` over `current` would do, and the stores to save:
 * { mapping, activity } (null where the backup has nothing for that store)
 * plus the counts the confirmation shows.
 */
export function planHubspotRestore(current, backup) {
  const cur = current || {};
  const curLinks = cur.mapping?.links || {};
  const curKeys = new Set((cur.activity?.activities || []).map(activityKey));
  const out = { mapping: null, activity: null, linksAdded: 0, exportRestored: false, activitiesAdded: 0, ignoredAdded: 0 };
  if (backup?.mapping) {
    out.mapping = mergeHubspotMappingRestore(cur.mapping, backup.mapping);
    out.linksAdded = Object.keys(out.mapping.links).filter(k => !(k in curLinks)).length;
    out.exportRestored = !(cur.mapping?.companies || []).length && out.mapping.companies.length > 0;
  }
  if (backup?.activity) {
    out.activity = mergeHubspotActivityRestore(cur.activity, backup.activity, mergeActivities);
    out.activitiesAdded = out.activity.activities.filter(a => !curKeys.has(activityKey(a))).length;
    const curIgnored = new Set(cur.activity?.ignored || []);
    out.ignoredAdded = out.activity.ignored.filter(k => !curIgnored.has(k)).length;
  }
  out.changes = out.linksAdded + out.activitiesAdded + out.ignoredAdded + (out.exportRestored ? 1 : 0);
  return out;
}
