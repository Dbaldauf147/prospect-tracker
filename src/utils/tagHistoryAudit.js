// Reading a contact's dans_tags history to find where tags were lost.
//
// dans_tags is ONE semicolon-joined string, so every write to it replaces
// the whole list. That makes a tag wipe indistinguishable from an ordinary
// edit at write time — the only record of what a contact used to carry is
// HubSpot's own property history, which keeps a value per version with the
// timestamp and the source that wrote it.
//
// This module is the pure half of the audit: history in, verdict out. The
// API layer fetches the versions (api/hubspot.js, action=tag-history) and
// the HubSpot page renders what comes back.
//
// Imported with the extension so this module also loads under plain Node
// (scripts/tagHistoryAudit.test.mjs), not just through the bundler.
import { tagKey } from './contactTagReview.js';

/** A dans_tags string as a list of tags. */
export function splitTags(value) {
  return String(value || '').split(';').map(t => t.trim()).filter(Boolean);
}

// Tags in `older` that `newer` no longer carries, in the older list's own
// spelling. Compared by tagKey, so "Efficiency / Renewables" and
// "Efficiency/Renewables" are one tag rather than a loss and a gain.
function removedBetween(older, newer) {
  const kept = new Set(newer.map(tagKey));
  return older.filter(t => !kept.has(tagKey(t)));
}

/**
 * What happened to one contact's tags.
 *
 * `entry` is { id, name, email, current, history }, where `history` is
 * HubSpot's version list for dans_tags, NEWEST FIRST — each
 * { value, timestamp, sourceType, sourceId }.
 *
 * Returns { id, name, email, current, lost, removed, previous, restoreTo,
 * at, sourceType, sourceId }.
 *
 * `lost` marks the contacts this audit exists to find: a version older than
 * the current one carried tags the contact no longer has. The most RECENT
 * such transition is the one reported — a contact whose tags were cleared
 * and then partly re-added has lost whatever is still missing, and dating
 * that to the original clear would point at the wrong write.
 *
 * `restoreTo` is what the string should be put back to: what they carry now
 * plus what went missing, so a restore can't undo a deliberate later edit.
 * Nothing here writes it — that is a separate, approved step.
 */
export function auditTagHistory(entry) {
  const current = splitTags(entry?.current);
  const versions = Array.isArray(entry?.history) ? entry.history : [];
  const base = {
    id: entry?.id != null ? String(entry.id) : '',
    name: entry?.name || '',
    email: entry?.email || '',
    current: current.join(';'),
    lost: false,
    removed: [],
    previous: '',
    restoreTo: '',
    at: '',
    sourceType: '',
    sourceId: '',
  };
  if (versions.length < 2) return base;

  // Newest first, so walking forward walks backwards in time. Each step
  // compares a version with the one before it: the first step that dropped
  // a tag the contact STILL doesn't have is the loss to report.
  for (let i = 0; i < versions.length - 1; i += 1) {
    const newer = splitTags(versions[i]?.value);
    const older = splitTags(versions[i + 1]?.value);
    const dropped = removedBetween(older, newer);
    if (dropped.length === 0) continue;
    // Only what is still missing counts: a tag dropped here and re-added
    // since is not a loss, and would make a restore write it twice.
    const stillMissing = removedBetween(dropped, current);
    if (stillMissing.length === 0) continue;
    return {
      ...base,
      lost: true,
      removed: stillMissing,
      previous: older.join(';'),
      restoreTo: [...current, ...stillMissing].join(';'),
      at: versions[i]?.timestamp || '',
      sourceType: versions[i]?.sourceType || '',
      sourceId: versions[i]?.sourceId || '',
    };
  }
  return base;
}

/**
 * The audit over many contacts: the rows that lost tags, worst first, and
 * the shape of the incident.
 *
 * `byHour` and `bySource` are what turn a list of casualties into a cause:
 * a wipe done by one bulk action lands as one spike from one source, and a
 * scatter across days is somebody editing contacts one at a time.
 */
export function summarizeTagAudit(rows) {
  const all = (Array.isArray(rows) ? rows : []).map(auditTagHistory);
  const lost = all.filter(r => r.lost);
  const byHour = new Map();
  const bySource = new Map();
  let tagsLost = 0;
  for (const r of lost) {
    tagsLost += r.removed.length;
    const hour = String(r.at).slice(0, 13).replace('T', ' ');
    if (hour) byHour.set(hour, (byHour.get(hour) || 0) + 1);
    const src = [r.sourceType, r.sourceId].filter(Boolean).join(':') || 'unknown';
    bySource.set(src, (bySource.get(src) || 0) + 1);
  }
  const stamps = lost.map(r => r.at).filter(Boolean).sort();
  return {
    examined: all.length,
    lostCount: lost.length,
    tagsLost,
    firstAt: stamps[0] || '',
    lastAt: stamps[stamps.length - 1] || '',
    byHour: [...byHour.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => b.count - a.count || a.hour.localeCompare(b.hour)),
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    // Most tags lost first: the worst-hit contacts are the ones worth
    // eyeballing before anything is written back.
    rows: lost.sort((a, b) => b.removed.length - a.removed.length || a.name.localeCompare(b.name)),
  };
}

/** The audit rows as a CSV, for keeping a copy before anything is restored. */
export function tagAuditCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Contact ID', 'Name', 'Email', 'Tags now', 'Tags before', 'Lost', 'Restore to', 'Changed at', 'Source'];
  const body = (rows || []).map(r => [
    r.id, r.name, r.email, r.current, r.previous, r.removed.join(';'), r.restoreTo, r.at,
    [r.sourceType, r.sourceId].filter(Boolean).join(':'),
  ].map(esc).join(','));
  return [head.join(','), ...body].join('\n');
}
