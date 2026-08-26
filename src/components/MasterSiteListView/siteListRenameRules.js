// Which site-list cells a company rename rewrites.
//
// Both site tables store the company as free text on every row — the
// Master Site List in its own `company` field, the Utility Lookup sites
// file in whichever uploaded header reads as the company column. Neither
// holds a reference to the prospect record, so renaming a company in its
// popup used to leave those rows under the old name: the Master Site List
// dropped the company into its "unmapped" bucket and the user had to
// re-match every row by hand.
//
// Pure — no IndexedDB, no React — so the rules can be exercised directly
// and so the caller can count what would change and show it in the
// confirmation prompt before anything is written. siteListRename.js does
// the reading and writing. See companyRenameCascade.js for the name-keyed
// references that live outside the site lists.
import { detectMasterMapping } from './masterSiteFields.js';

// Same comparison the Master Site List uses when it decides whether a row
// maps to a Table View company: trimmed, case-insensitive, exact. A looser
// match would rewrite the rows of a company the user never renamed.
const sameCompany = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Master Site List rows carrying `oldName` in their `company` field,
 * repointed onto `newName`. Returns the original array and a zero count
 * when nothing matches, so the caller can skip the write. Rows already
 * spelled the new way don't count, so the prompt never offers to change
 * rows that already read correctly.
 */
export function renameMasterSiteRows(rows, oldName, newName) {
  const list = Array.isArray(rows) ? rows : [];
  const next = String(newName || '').trim();
  if (!next || !String(oldName || '').trim()) return { rows: list, count: 0 };
  let count = 0;
  const out = list.map(r => {
    if (r && sameCompany(r.company, oldName) && String(r.company || '').trim() !== next) {
      count++;
      return { ...r, company: next };
    }
    return r;
  });
  return { rows: count > 0 ? out : list, count };
}

/**
 * The same, for the Utility Lookup sites file. Its rows are raw
 * header→value objects from whatever workbook was uploaded, so the
 * company column is found the way the Master Site List's own import finds
 * it. A file with no company-ish header is left alone.
 */
export function renameSitesFileRows(rows, oldName, newName) {
  const list = Array.isArray(rows) ? rows : [];
  const next = String(newName || '').trim();
  if (!list.length || !next || !String(oldName || '').trim()) return { rows: list, count: 0, header: '' };
  // Headers are unioned over the first rows rather than read off row 0,
  // which can be sparse when the upload left early cells blank.
  const headers = [];
  const seen = new Set();
  for (const r of list.slice(0, 50)) {
    for (const h of Object.keys(r || {})) {
      if (!seen.has(h)) { seen.add(h); headers.push(h); }
    }
  }
  const header = detectMasterMapping(headers).company || '';
  if (!header) return { rows: list, count: 0, header: '' };
  let count = 0;
  const out = list.map(r => {
    if (r && sameCompany(r[header], oldName) && String(r[header] || '').trim() !== next) {
      count++;
      return { ...r, [header]: next };
    }
    return r;
  });
  return { rows: count > 0 ? out : list, count, header };
}

/**
 * A company's own uploaded site list (settings.companySiteLists[slug]),
 * with the old name taken off both places it is stored as text: the
 * entry's `company` label — which is what the Site List Overview and the
 * Utility Lookup picker render — and any company column in the uploaded
 * rows themselves. Returns null when there is nothing to change, so the
 * caller can skip the write. `headers` is the entry's own header list,
 * which is authoritative here; the rows fall back to it.
 */
export function renameCompanySiteListEntry(entry, oldName, newName) {
  if (!entry || typeof entry !== 'object') return null;
  const next = String(newName || '').trim();
  if (!next || !String(oldName || '').trim()) return null;

  // The entry is this company's own list, so its label is simply the
  // company's current name — whatever spelling it was uploaded under.
  const labelStale = String(entry.company || '').trim() !== next;

  const rows = Array.isArray(entry.rows) ? entry.rows : null;
  const headers = Array.isArray(entry.headers) && entry.headers.length
    ? entry.headers
    : Object.keys(rows?.[0] || {});
  const header = detectMasterMapping(headers).company || '';
  let cells = 0;
  let nextRows = rows;
  if (rows && header) {
    nextRows = rows.map(r => {
      if (r && sameCompany(r[header], oldName) && String(r[header] || '').trim() !== next) {
        cells++;
        return { ...r, [header]: next };
      }
      return r;
    });
  }

  if (!labelStale && cells === 0) return null;
  return {
    entry: { ...entry, company: next, ...(cells > 0 ? { rows: nextRows } : {}) },
    cells,
  };
}

/** Confirmation-prompt lines for a plan; empty when it changes nothing. */
export function summarizeSiteListRename(plan) {
  const lines = [];
  const m = plan?.masterCount || 0;
  const s = plan?.sitesCount || 0;
  if (m) lines.push(`• ${m} Master Site List row${m === 1 ? '' : 's'}`);
  if (s) lines.push(`• ${s} Utility Lookup site row${s === 1 ? '' : 's'}`);
  return lines;
}
