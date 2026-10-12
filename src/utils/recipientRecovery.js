// Find To Also / CC recipients the backups still hold, for the All Contacts
// "Recover To / CC" button. The search half of recoverRecipientMaps
// (utils/recipientMaps): this browser's settings backups first, then the
// nightly cloud backups, newest first, the same order the Marketing Leads
// link recovery searches them in.
import { listBackups } from './settingsBackup';
import { apiFetch } from './apiFetch';
import { recoverRecipientMaps } from './recipientMaps';

// Cloud backups are one per night; this many is a month and a half back.
const CLOUD_BACKUPS_TO_READ = 45;

const hasMaps = (d) => d && (d.ccMap || d.toAlsoMap);

/**
 * Every backup holding a To Also or CC map, newest first: [{ label, data }],
 * plus how many of each kind were read and the oldest date reached, so a
 * search that finds nothing can say how far back it looked. One backup that
 * can't be read is skipped rather than ending the search.
 */
export async function recipientBackupSources({ onProgress } = {}) {
  const sources = [];
  const read = { browser: 0, cloud: 0, cloudFailed: 0, oldest: null, cloudError: '' };
  const note = (when) => { if (when && (!read.oldest || when < read.oldest)) read.oldest = when; };
  for (const b of await listBackups()) {
    read.browser += 1;
    note(new Date(b.timestamp).toISOString().slice(0, 10));
    if (hasMaps(b?.data)) sources.push({ label: `browser backup ${new Date(b.timestamp).toLocaleString()}`, data: b.data });
  }
  let newest = [];
  try {
    const resp = await apiFetch('/api/backups-list');
    const body = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(body?.error || `HTTP ${resp.status}`);
    newest = [...(body?.files || [])]
      .sort((a, b) => String(b.createdTime || b.name).localeCompare(String(a.createdTime || a.name)))
      .slice(0, CLOUD_BACKUPS_TO_READ);
  } catch (err) {
    read.cloudError = err?.message || String(err);
  }
  let i = 0;
  for (const f of newest) {
    i += 1;
    onProgress?.(`Reading cloud backup ${i} of ${newest.length}...`);
    try {
      const r = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(f.name)}&part=userSettings`);
      const out = await r.json();
      if (!r.ok) throw new Error(out?.error || `HTTP ${r.status}`);
      read.cloud += 1;
      const when = String(out.generatedAt || f.createdTime || '').slice(0, 10);
      note(when);
      if (hasMaps(out?.value)) sources.push({ label: `cloud backup ${when || f.name}`, data: out.value });
    } catch (err) {
      read.cloudFailed += 1;
      if (!read.cloudError) read.cloudError = err?.message || String(err);
    }
  }
  return { sources, read };
}

/** What recovery would put back, against `current` settings. */
export async function findLostRecipients(current, opts) {
  const { sources, read } = await recipientBackupSources(opts);
  return { ...recoverRecipientMaps(current, sources), sources, read };
}
