import { tagKey, findTagRecord, tagStateFrom, recordKeepsTag } from './contactTagReview.js';

// Tag presets: a named set of answers for the contact popup's tag table,
// applied in one click.
//
// Tagging somebody means answering every row of the table (Yes / No / Not
// sure, Sold / Not sold), and most contacts fall into a handful of shapes -
// an ESG director answers the same way as the last ESG director. A preset
// is one of those shapes, saved off a contact already tagged that way.
//
// Stored in settings.tagPresets as
//   [{ id, name, tags: { [tag]: { answer, status } } }]
// with only the tags that had something recorded. Applying one sets every
// tag it names and leaves the rest of the table alone, so a preset saved
// before a tag existed doesn't wipe that tag's answer on the next contact.

// The preset a contact's current table would save: every tag with an answer
// or a status, as the table shows it (the HubSpot tag folded in, so a tag
// that's on reads as Yes even with nothing recorded locally).
export function presetTagsFrom({ checked, verdicts, tags }) {
  const out = {};
  for (const tag of tags || []) {
    const st = tagStateFrom(checked.has(tag), findTagRecord(verdicts, tag));
    if (st.answer || st.status) out[tag] = { answer: st.answer, status: st.status };
  }
  return out;
}

// The table after a preset is applied: the checked set (what goes to
// HubSpot) and the local record map. `tags` is the popup's vocabulary; a
// preset tag is matched to it by tagKey, so a preset saved under one
// spelling still lands on the row shown under another. A preset tag the
// vocabulary no longer has is skipped rather than invented.
export function applyTagPreset({ checked, verdicts, tags, preset }) {
  const byKey = new Map((tags || []).map(t => [tagKey(t), t]));
  const nextChecked = new Set(checked);
  const nextVerdicts = { ...(verdicts || {}) };
  for (const [raw, rec] of Object.entries(preset?.tags || {})) {
    const tag = byKey.get(tagKey(raw));
    if (!tag) continue;
    const record = { answer: rec?.answer || '', status: rec?.status || '' };
    // The HubSpot tag may be carried under another spelling; drop that too.
    for (const t of [...nextChecked]) if (tagKey(t) === tagKey(tag)) nextChecked.delete(t);
    if (recordKeepsTag(record)) nextChecked.add(tag);
    // One record per tag, under the vocabulary's spelling.
    for (const key of Object.keys(nextVerdicts)) if (tagKey(key) === tagKey(tag)) delete nextVerdicts[key];
    if (record.answer || record.status) nextVerdicts[tag] = record;
  }
  return { checked: nextChecked, verdicts: nextVerdicts };
}

// The preset list with `name` saved as `tags`. A name already in use (any
// case) is overwritten in place, so re-saving "ESG Director" updates it
// rather than adding a second one.
export function savePreset(list, name, tags) {
  const clean = String(name || '').trim();
  if (!clean) return list || [];
  const cur = Array.isArray(list) ? list : [];
  const idx = cur.findIndex(p => String(p?.name || '').trim().toLowerCase() === clean.toLowerCase());
  if (idx !== -1) {
    const next = [...cur];
    next[idx] = { ...cur[idx], name: clean, tags };
    return next;
  }
  const id = `tp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return [...cur, { id, name: clean, tags }];
}

export function deletePreset(list, id) {
  return (Array.isArray(list) ? list : []).filter(p => p?.id !== id);
}

// Short description of a preset for its tooltip: the tags it turns on.
export function presetSummary(preset) {
  const on = Object.entries(preset?.tags || {}).filter(([, r]) => recordKeepsTag(r)).map(([t]) => t);
  const rest = Object.keys(preset?.tags || {}).length - on.length;
  const parts = [];
  if (on.length) parts.push(`Tags on: ${on.join(', ')}`);
  if (rest) parts.push(`${rest} other answer${rest === 1 ? '' : 's'} (No / Not sure / Not sold)`);
  return parts.join('. ') || 'No answers saved';
}
