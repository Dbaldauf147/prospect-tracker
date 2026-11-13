// Put back the Changed Jobs page's own edits that a save wiped.
//
// Hide, Snooze, Reached Out and New Company on the Changed Jobs page are
// flags in settings.contactLocalFields. Until the stale check learned to
// compare that map's own stamp (settingsCodec staleKeysIn), a tab holding an
// old cached copy of the map could write it back over the stored one, and
// every one of those flags set since that copy was cached was gone. The
// backups still hold them: this browser's pre-save backups and the nightly
// cloud backups (settingsBackupSources).
//
// Recovery only fills blanks. A contact that has a flag now keeps it as it
// is; a flag a backup holds goes back only where the contact has none. A
// snooze that has already run out is not put back, since it would only send
// the contact straight back to the list it was snoozed off.
import { settingsBackupSources } from './settingsBackupSources';
import { activeSnoozeMs } from './changedJobs';

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// What each flag is, and the fields that go with it. `has` says whether an
// entry carries the flag; `fields` are copied together when it goes back.
export const RECOVERABLE_FLAGS = [
  { key: 'hidden', label: 'Hidden', has: (e) => !!e?._changedJobsHidden, fields: ['_changedJobsHidden', '_changedJobsHiddenAt'] },
  { key: 'snoozed', label: 'Snoozed', has: (e, now) => activeSnoozeMs(e, now) != null, fields: ['_changedJobsSnoozeUntil'] },
  { key: 'reachedOut', label: 'Reached Out', has: (e) => !!e?._reachedOut, fields: ['_reachedOut', '_reachedOutAt'] },
  { key: 'newCompany', label: 'New Company', has: (e) => typeof e?._newCompany === 'string' && !!e._newCompany.trim(), fields: ['_newCompany'] },
];

const hasAnyFlag = (data) => isMap(data?.contactLocalFields);

/**
 * What the backups would put back, against `current` settings. `sources` is
 * [{ label, data }] newest first: for each contact and flag, the newest
 * backup holding it wins.
 *
 * Returns { patch, found }: `patch` is the new contactLocalFields (null when
 * nothing would change), `found` is [{ id, flag, label, value, from }].
 */
export function recoverChangedJobsFlags(current, sources, nowMs = Date.now()) {
  const cur = isMap(current?.contactLocalFields) ? current.contactLocalFields : {};
  const out = { ...cur };
  const found = [];
  const done = new Set(); // `${id}|${flag}` already settled, by now or by a newer backup
  for (const [id, entry] of Object.entries(cur)) {
    for (const f of RECOVERABLE_FLAGS) if (f.has(entry, nowMs)) done.add(`${id}|${f.key}`);
  }
  for (const src of sources || []) {
    const map = src?.data?.contactLocalFields;
    if (!isMap(map)) continue;
    for (const [id, entry] of Object.entries(map)) {
      if (!isMap(entry)) continue;
      for (const f of RECOVERABLE_FLAGS) {
        const k = `${id}|${f.key}`;
        if (done.has(k) || !f.has(entry, nowMs)) continue;
        done.add(k);
        const next = { ...(out[id] || {}) };
        for (const field of f.fields) {
          if (entry[field] !== undefined) next[field] = entry[field];
        }
        out[id] = next;
        found.push({
          id,
          flag: f.key,
          label: f.label,
          value: f.key === 'snoozed' ? entry._changedJobsSnoozeUntil : f.key === 'newCompany' ? entry._newCompany : true,
          from: src.label || '',
        });
      }
    }
  }
  return { patch: found.length ? out : null, found };
}

/** The search: every backup with a contactLocalFields map, then what it would put back. */
export async function findLostChangedJobsFlags(current, opts) {
  const { sources, read } = await settingsBackupSources(hasAnyFlag, opts);
  return { ...recoverChangedJobsFlags(current, sources), sources, read };
}
