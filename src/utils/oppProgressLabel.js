// The Progressing / Stalled / On Hold label on the company card's Opps table.
//
// Held in user settings as `oppProgress`, keyed by the opp's Opps 2 `_id`,
// so it follows Dan to his other machine:
//   { 'abc123': 'stalled', 'def456': 'progressing', 'ghi789': 'on-hold' }
// Separate from the opp's own Status column on the Opps tab, which is free
// text about who is waiting on whom.

export const OPP_PROGRESS_KEY = 'oppProgress';

export const OPP_PROGRESS_OPTIONS = [
  { value: 'progressing', label: 'Progressing', bg: '#DCFCE7', color: '#166534', border: '#86EFAC' },
  { value: 'stalled', label: 'Stalled', bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' },
  { value: 'on-hold', label: 'On Hold', bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
];

// A settings path segment for an opp id: dots and slashes would split the
// dotted path, so they are swapped out.
export function oppProgressId(id) {
  const s = id == null ? '' : String(id).trim();
  return s ? s.replace(/[./]/g, '_') : '';
}

export function oppProgressFor(map, id) {
  const key = oppProgressId(id);
  const v = key && map && typeof map === 'object' ? map[key] : '';
  return OPP_PROGRESS_OPTIONS.some(o => o.value === v) ? v : '';
}

// The updateSettingsPath patch that sets (or, with '', clears) a label.
export function oppProgressPatch(id, value) {
  const key = oppProgressId(id);
  if (!key) return null;
  const ok = OPP_PROGRESS_OPTIONS.some(o => o.value === value);
  return { [`${OPP_PROGRESS_KEY}.${key}`]: ok ? value : null };
}
