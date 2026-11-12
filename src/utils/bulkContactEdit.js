// Bulk edit for a list of HubSpot contacts outside the company popup (the
// popup has its own, with Company moves and tag answers on top). The fields
// are the ones that are a plain HubSpot property write or the per-user Notes:
// Title, City, Country, Tags (add / remove / replace) and Notes.
//
// planBulkContactEdit is pure: it says what to write for each contact, and
// the caller sends it (api/hubspot update-contact) and patches the cache.
import { planTagEdit } from './contactTagReview.js';

export const BULK_CONTACT_FIELDS = [
  { key: 'jobtitle', label: 'Title', kind: 'text' },
  { key: 'city', label: 'City', kind: 'text' },
  { key: 'country', label: 'Country', kind: 'text' },
  { key: 'dans_tags', label: 'Tags', kind: 'tags', modes: [['add', 'Add'], ['remove', 'Remove'], ['replace', 'Replace all']] },
  { key: 'notes', label: 'Notes (per-user)', kind: 'notes', modes: [['append', 'Append'], ['replace', 'Replace']] },
];

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
