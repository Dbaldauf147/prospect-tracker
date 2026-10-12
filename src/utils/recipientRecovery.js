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

/** Every backup holding a To Also or CC map, newest first: [{ label, data }]. */
export async function recipientBackupSources({ onProgress } = {}) {
  const sources = [];
  for (const b of await listBackups()) {
    if (hasMaps(b?.data)) sources.push({ label: `browser backup ${new Date(b.timestamp).toLocaleString()}`, data: b.data });
  }
  try {
    const resp = await apiFetch('/api/backups-list');
    const files = resp.ok ? ((await resp.json())?.files || []) : [];
    const newest = [...files]
      .sort((a, b) => String(b.createdTime || b.name).localeCompare(String(a.createdTime || a.name)))
      .slice(0, CLOUD_BACKUPS_TO_READ);
    let i = 0;
    for (const f of newest) {
      i += 1;
      onProgress?.(`Reading cloud backup ${i} of ${newest.length}...`);
      const r = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(f.name)}&part=userSettings`);
      if (!r.ok) continue;
      const out = await r.json();
      if (hasMaps(out?.value)) sources.push({ label: `cloud backup ${String(out.generatedAt || f.name).slice(0, 10)}`, data: out.value });
    }
  } catch { /* cloud backups are a bonus; the browser ones are already in */ }
  return sources;
}

/** What recovery would put back, against `current` settings. */
export async function findLostRecipients(current, opts) {
  const sources = await recipientBackupSources(opts);
  return { ...recoverRecipientMaps(current, sources), sources };
}
