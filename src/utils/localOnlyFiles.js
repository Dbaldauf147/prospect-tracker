// Files that exist only in this browser: the ones a "clear browsing data"
// would take for good.
//
// Every file store keeps a local IndexedDB copy and a cloud copy. A file
// lands here when the cloud copy could not be written, either because it
// is over that store's size ceiling (SIA workbooks, RFP workbooks, Market
// Update emails) or because the write failed (offline, a rules error, a
// commit too big). The store takes it back off when a later write succeeds
// or the file is deleted, and the daily repair pass (repairCloudBackups)
// re-checks everything held locally, so files that were already stranded
// before this registry existed are found too.
//
// The Issues tab lists what is here as "File not backed up" rows, so the
// user can see which files are at risk and act before clearing anything.
//
// The registry lives in this browser's localStorage, deliberately: it is a
// statement about this browser's IndexedDB. If site data is cleared it goes
// with the files it describes, and another machine has nothing at risk
// from them.

import { userLsGet, userLsSet } from './userLs.js';

const KEY = 'local-only-files';
export const LOCAL_ONLY_FILES_EVENT = 'local-only-files-changed';

// What each kind of file is called on the Issues tab, and where to go to
// find it.
export const LOCAL_ONLY_KINDS = {
  portfolio: { label: 'PE portfolio workbook', where: 'Company card > Portfolio' },
  sia: { label: 'SIA / pricing workbook', where: 'Opps > the opp > Pricing' },
  rfp: { label: 'RFP workbook', where: 'Opps > the opp > Follow Up Notes > RFP' },
  marketUpdate: { label: 'Market Update email', where: 'Draft Emails > Market Updates' },
  list: { label: 'Uploaded list', where: 'Lists' },
  // Not a file in IndexedDB: a site list whose save failed, so the change
  // is held only by the open tab (see companySiteListsStore). Same list,
  // different wording below.
  siteList: { label: 'Site list', where: 'Company card > Site list' },
};

function read() {
  try {
    const parsed = JSON.parse(userLsGet(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(map) {
  try { userLsSet(KEY, JSON.stringify(map)); } catch { /* quota: the next mark retries */ }
  try { window.dispatchEvent(new Event(LOCAL_ONLY_FILES_EVENT)); } catch { /* no window (tests) */ }
}

/**
 * Record that a file is only on this device.
 *   id      stable per file, e.g. `sia:<oppId>`; a second mark replaces the first
 *   kind    a LOCAL_ONLY_KINDS key
 *   reason  'too-big' (over the store's ceiling) or 'backup-failed'
 *   name    the file's name, for the row
 *   sizeBytes, limitBytes, error
 *   owner   the company it belongs to, when the store knows it
 *   oppId   the opp it is attached to (the Issues row names the opp and
 *           its company from the Opps records)
 */
export function markLocalOnly(id, { kind, reason, name = '', sizeBytes = 0, owner = '', oppId = null, limitBytes = 0, error = '' }) {
  if (!id || !kind) return;
  const map = read();
  const prev = map[id];
  const next = {
    kind, reason, name: String(name || ''), sizeBytes: Number(sizeBytes) || 0,
    owner: String(owner || ''), oppId: oppId == null ? null : String(oppId), limitBytes: Number(limitBytes) || 0,
    error: String(error || '').slice(0, 300),
    // Keep the first time it was seen: "at risk since" is the useful date.
    since: prev?.since || Date.now(),
  };
  if (prev && JSON.stringify({ ...prev, since: 0 }) === JSON.stringify({ ...next, since: 0 })) return;
  map[id] = next;
  write(map);
}

/** The file is backed up (or gone): take it off the list. */
export function clearLocalOnly(id) {
  const map = read();
  if (!(id in map)) return;
  delete map[id];
  write(map);
}

/** Every file at risk, as [{ id, ...entry }]. */
export function loadLocalOnlyFiles() {
  return Object.entries(read()).map(([id, entry]) => ({ id, ...entry }));
}

/** A failed write's message, short enough for a tooltip. */
export function errorText(err) {
  return String(err?.code || err?.message || err || '').slice(0, 300);
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * Issues-tab rows for the files at risk. Pure, for the tests.
 *   oppsRecords  the Opps 2 records, to name an opp-attached file's company
 *   oppNumbers   _id -> the "Opp #" the Opps tab shows
 */
export function localOnlyFileIssues(entries, { oppsRecords = null, oppNumbers = new Map(), prospects = [] } = {}) {
  const oppById = new Map((oppsRecords || []).filter(r => r?._id != null).map(r => [String(r._id), r]));
  // A portfolio workbook is filed under its company's slug, and the repair
  // pass only has the slug to go on, so the company card is found by
  // slugging both sides (slugging a slug changes nothing).
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const prospectBySlug = new Map();
  for (const p of (prospects || [])) {
    const k = slug(p?.company);
    if (k && !prospectBySlug.has(k)) prospectBySlug.set(k, p);
  }
  return (entries || []).filter(e => e?.id && LOCAL_ONLY_KINDS[e.kind]).map((e) => {
    const kind = LOCAL_ONLY_KINDS[e.kind];
    const opp = e.oppId != null ? oppById.get(String(e.oppId)) : null;
    const prospect = (e.kind === 'portfolio' || e.kind === 'siteList') ? prospectBySlug.get(slug(e.owner)) : null;
    const company = prospect?.company || e.owner || String(opp?.Account || '').trim();
    const size = e.sizeBytes ? ` (${fmtSize(e.sizeBytes)})` : '';
    const why = e.reason === 'too-big'
      ? `over the ${fmtSize(e.limitBytes)} backup limit`
      : `its cloud backup failed${e.error ? ` (${e.error})` : ''}`;
    if (e.kind === 'siteList') {
      return {
        id: `local-only:${e.id}`,
        source: 'Site lists',
        type: 'Site list not saved',
        company: company || '-',
        oppNumber: null,
        prospectId: prospect?.id || null,
        daysUntil: null,
        expirationDate: null,
        detail: `The last save of ${e.name ? `the site list "${e.name}"` : 'this site list'}${size} failed: `
          + `${e.reason === 'too-big' ? `it is over the ${fmtSize(e.limitBytes)} one site list can hold` : `the save was refused${e.error ? ` (${e.error})` : ''}`}. `
          + 'The change was only in the tab you made it in, so a refresh loses it. '
          + `${e.reason === 'too-big' ? 'Make the list smaller, then save it again' : 'Save it again'} from ${kind.where}.`,
      };
    }
    return {
      id: `local-only:${e.id}`,
      source: 'Backups',
      type: 'File not backed up',
      company: company || '-',
      oppNumber: opp ? (oppNumbers.get(opp._id) ?? null) : null,
      prospectId: prospect?.id || null,
      daysUntil: null,
      expirationDate: null,
      detail: `${kind.label} "${e.name || 'unnamed'}"${size} is only in this browser: ${why}. `
        + `Clearing browsing data would delete it. Find it under ${kind.where}.`,
    };
  });
}
