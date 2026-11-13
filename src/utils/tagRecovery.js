// Putting back tag answers and tags that went missing, from the settings
// backups (utils/settingsBackupSources).
//
// Two things can be lost, and they live in different places:
//
//   the answers - settings.contactTagReview, { [contactId]: { [tag]:
//     { answer, status } } }: the No / Not sure / Sold / Not sold a contact
//     was given, and a Yes beside the tag;
//   the tags - what the contact carries (now the app's own tag store,
//     api/_lib/contactTagStore.js), where a Yes and a Sold live.
//
// The backups hold the answers, and an answer of Yes or Sold says the tag
// was on. So a recovery plan, per contact on the rosters:
//
//   * every answer a backup has that the contact has NO answer for today is
//     put back, from the newest backup that has one;
//   * every Yes or Sold it puts back, or that already stands, whose tag is
//     off today, is a tag to put back on.
//
// It only ever fills gaps. An answer that exists today is never replaced -
// a No changed to Not sure last week stays Not sure - and a tag is only
// added, never taken off. Pure: data in, plan out.

import { tagKey, tagRecordFrom, recordKeepsTag } from './contactTagReview.js';

const recordsByKey = (map) => {
  const out = new Map();
  for (const [tag, rec] of Object.entries(map || {})) {
    const k = tagKey(tag);
    if (!out.has(k)) out.set(k, { tag, rec: tagRecordFrom(rec) });
  }
  return out;
};

const hasAnything = (rec) => !!(rec && (rec.answer || rec.status));

/**
 * The plan.
 *
 *   contacts - [{ id, name, company, tags }] the roster contacts to consider,
 *              `tags` their tag string as it stands now
 *   current  - settings.contactTagReview today
 *   backups  - [{ label, review }] each backup's contactTagReview, NEWEST FIRST
 *
 * Returns { rows: [{ id, name, company, answers: { [tag]: record },
 * addTags: [tag], from: label }], answerCount, tagCount }, rows ordered by
 * how much each puts back.
 */
export function planTagRecovery({ contacts = [], current = {}, backups = [] }) {
  const rows = [];
  let answerCount = 0;
  let tagCount = 0;
  for (const c of contacts) {
    const id = c?.id == null ? '' : String(c.id);
    if (!id) continue;
    const now = recordsByKey(current?.[id]);
    const onNow = new Set(String(c.tags || '').split(';').map(t => tagKey(t.trim())).filter(Boolean));
    const answers = {};
    const sources = new Set();
    for (const b of backups) {
      const then = recordsByKey(b?.review?.[id]);
      for (const [k, { tag, rec }] of then) {
        if (!hasAnything(rec)) continue;
        if (hasAnything(now.get(k)?.rec)) continue;
        if (Object.keys(answers).some(t => tagKey(t) === k)) continue;
        answers[tag] = rec;
        sources.add(b.label);
      }
    }
    // Tags whose answer says they're on - restored or already standing -
    // but which aren't on the contact today.
    const addTags = [];
    const consider = [
      ...[...now.values()].map(v => [v.tag, v.rec]),
      ...Object.entries(answers),
    ];
    for (const [tag, rec] of consider) {
      if (!recordKeepsTag(rec)) continue;
      const k = tagKey(tag);
      if (onNow.has(k) || addTags.some(t => tagKey(t) === k)) continue;
      addTags.push(tag);
    }
    const n = Object.keys(answers).length;
    if (!n && !addTags.length) continue;
    answerCount += n;
    tagCount += addTags.length;
    rows.push({
      id,
      name: c.name || '',
      company: c.company || '',
      answers,
      addTags,
      from: [...sources][0] || '',
    });
  }
  rows.sort((a, b) => (Object.keys(b.answers).length + b.addTags.length) - (Object.keys(a.answers).length + a.addTags.length)
    || a.name.localeCompare(b.name));
  return { rows, answerCount, tagCount };
}

/** settings.contactTagReview with a plan's answers filled in. */
export function withRecoveredAnswers(current, rows) {
  const next = { ...(current || {}) };
  for (const r of rows || []) {
    if (!Object.keys(r.answers || {}).length) continue;
    next[r.id] = { ...(next[r.id] || {}), ...r.answers };
  }
  return next;
}
