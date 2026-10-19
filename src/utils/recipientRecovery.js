// Find To Also / CC recipients the backups still hold, for the All Contacts
// "Recover To / CC" button. The search half of recoverRecipientMaps
// (utils/recipientMaps): this browser's settings backups first, then the
// nightly cloud backups, newest first, the same order the Marketing Leads
// link recovery searches them in.
import { settingsBackupSources } from './settingsBackupSources';
import { recoverRecipientMaps } from './recipientMaps';

const hasMaps = (d) => d && (d.ccMap || d.toAlsoMap);

/** Every backup holding a To Also or CC map, newest first (see settingsBackupSources). */
export function recipientBackupSources(opts) {
  return settingsBackupSources(hasMaps, opts);
}

/** What recovery would put back, against `current` settings. */
export async function findLostRecipients(current, opts) {
  const { sources, read } = await recipientBackupSources(opts);
  return { ...recoverRecipientMaps(current, sources), sources, read };
}
