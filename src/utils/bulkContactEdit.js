// Bulk edit for a list of HubSpot contacts outside the company popup (the
// popup has its own, with Company moves and tag answers on top). The fields
// are the ones that are a plain HubSpot property write or the per-user Notes:
// Title, City, Country, Tags (add / remove / replace) and Notes, plus a saved
// tag preset (planBulkTagPreset), which writes both the HubSpot tag list and
// the per-user tag answers.
//
// planBulkContactEdit is pure: it says what to write for each contact, and
// the caller sends it (api/hubspot update-contact) and patches the cache.
import { planTagEdit, findTagRecord, tagRecordKeyFor, recordForVerdict, recordKeepsTag, sameTagRecord } from './contactTagReview.js';
import { applyTagPresetToContact } from './tagPresets.js';

// The Field choice that applies a saved tag preset (settings.tagPresets).
export const TAG_PRESET_FIELD = '__tag_preset__';

export const BULK_CONTACT_FIELDS = [
  { key: 'jobtitle', label: 'Title', kind: 'text' },
  { key: 'city', label: 'City', kind: 'text' },
  { key: 'country', label: 'Country', kind: 'text' },
  { key: 'dans_tags', label: 'Tags', kind: 'tags', modes: [
    ['yes', 'Mark Yes (adds the tag)'],
    ['no', 'Mark No (removes the tag)'],
    ['unsure', 'Mark Not sure (removes the tag)'],
    ['add', 'Add the tag only'],
    ['remove', 'Remove the tag only'],
    ['replace', 'Replace all tags'],
  ] },
  { key: 'notes', label: 'Notes (per-user)', kind: 'notes', modes: [['append', 'Append'], ['replace', 'Replace']] },
  { key: TAG_PRESET_FIELD, label: 'Tag preset', kind: 'preset' },
];

// The Tags modes that record an answer (the contact popup's Yes / No / Not
// sure) as well as moving the HubSpot tag, and what each one does, for the
// line under the How box.
export const TAG_ANSWER_MODES = ['yes', 'no', 'unsure'];
export const TAG_MODE_HELP = {
  yes: 'Records Yes for each tag on every selected contact and puts the tag on in HubSpot.',
  no: 'Records No for each tag on every selected contact and takes the tag off in HubSpot.',
  unsure: 'Records Not sure for each tag on every selected contact and takes the tag off in HubSpot.',
  add: 'Puts the tag on in HubSpot. No answer is recorded, so the tag table reads it as Yes.',
  remove: 'Takes the tag off in HubSpot. No answer is recorded, so the tag stays unanswered.',
  replace: 'Replaces every tag each selected contact has with the ones typed here. Their other tags are removed.',
};

export const contactIdOf = (c) => String(c?.id || c?.vid || '');
const tagsOf = (c) => c?.dans_tags ?? c?.dan_s_tags ?? c?.dans_tag;

/**
 * contacts: the selected HubSpot contacts. Returns
 *   { writes: [{ cid, properties }], notes: { cid: text } | null, skipped }
 * writes go to HubSpot; notes (Notes only) is the whole new contactNotes map
 * built from `currentNotes`; skipped counts contacts left alone (no id, or
 * nothing would change).
 */
export function planBulkContactEdit(contacts, { field, mode = 'replace', value = '' }, currentNotes = {}) {
  const writes = [];
  let skipped = 0;
  const text = String(value ?? '').trim();
  if (field === 'notes') {
    const notes = { ...(currentNotes || {}) };
    for (const c of contacts || []) {
      const cid = contactIdOf(c);
      if (!cid) { skipped += 1; continue; }
      const existing = String(notes[cid] || '');
      const merged = mode === 'append' && existing ? (text ? `${existing}\n${text}` : existing) : text;
      if (merged === existing) { skipped += 1; continue; }
      if (merged) notes[cid] = merged; else delete notes[cid];
    }
    return { writes, notes, skipped };
  }
  for (const c of contacts || []) {
    const cid = contactIdOf(c);
    if (!cid) { skipped += 1; continue; }
    if (field === 'dans_tags') {
      const plan = planTagEdit(mode, text.split(';'), tagsOf(c) ?? '');
      if (plan.action !== 'write') { skipped += 1; continue; }
      writes.push({ cid, properties: { dans_tags: plan.tags } });
      continue;
    }
    if (String(c?.[field] ?? '').trim() === text) { skipped += 1; continue; }
    writes.push({ cid, properties: { [field]: text } });
  }
  return { writes, notes: null, skipped };
}

/**
 * A saved tag preset applied to every selected contact, as the company
 * popup's Bulk Edit does it (utils/tagPresets applyTagPresetToContact).
 * `review` is settings.contactTagReview; `tags` the tag vocabulary. Returns
 *   { records: { cid: recordMap }, writes: [{ cid, properties }], skipped }
 * records are the contacts whose tag answers change (each one's whole new
 * map, for contactTagReview), writes the ones whose HubSpot tag list
 * changes, and skipped the contacts already answered the way the preset
 * answers (or with no id).
 */
export function planBulkTagPreset(contacts, preset, review = {}, tags = null) {
  const records = {};
  const writes = [];
  let skipped = 0;
  for (const c of contacts || []) {
    const cid = contactIdOf(c);
    if (!cid) { skipped += 1; continue; }
    const out = applyTagPresetToContact({ dansTags: tagsOf(c) || '', records: review?.[cid] || {}, preset, tags });
    if (out.recordsChanged) records[cid] = out.records;
    if (out.tagsChanged) writes.push({ cid, properties: { dans_tags: out.dansTags } });
    if (!out.recordsChanged && !out.tagsChanged) skipped += 1;
  }
  return { records, writes, skipped };
}

/**
 * One answer (yes / no / unsure) recorded for the typed tags on every
 * selected contact, the way the company popup's Bulk Edit does it. The
 * answer goes on top of whatever record is there (recordForVerdict), and
 * the HubSpot tag follows the record that leaves behind: on for a Yes, off
 * for a No or a Not sure, and still off for a Yes over a Not sold hold-off.
 * Returns the same shape as planBulkTagPreset:
 *   { records: { cid: recordMap }, writes: [{ cid, properties }], skipped }
 */
export function planBulkTagAnswer(contacts, verdict, value, review = {}) {
  const records = {};
  const writes = [];
  let skipped = 0;
  const tags = String(value ?? '').split(';').map(t => t.trim()).filter(Boolean);
  for (const c of contacts || []) {
    const cid = contactIdOf(c);
    if (!cid || tags.length === 0) { skipped += 1; continue; }
    const map = { ...(review?.[cid] || {}) };
    let recordsChanged = false;
    const on = [];
    const off = [];
    for (const tag of tags) {
      const stored = findTagRecord(map, tag);
      const record = recordForVerdict(stored, verdict);
      (recordKeepsTag(record) ? on : off).push(tag);
      if (sameTagRecord(stored, record)) continue;
      map[tagRecordKeyFor(map, tag)] = record;
      recordsChanged = true;
    }
    const before = String(tagsOf(c) ?? '');
    let cur = before;
    for (const [mode, list] of [['remove', off], ['add', on]]) {
      if (list.length === 0) continue;
      const step = planTagEdit(mode, list, cur);
      if (step.action === 'write') cur = step.tags;
    }
    if (recordsChanged) records[cid] = map;
    if (cur !== before) writes.push({ cid, properties: { dans_tags: cur } });
    if (!recordsChanged && cur === before) skipped += 1;
  }
  return { records, writes, skipped };
}
