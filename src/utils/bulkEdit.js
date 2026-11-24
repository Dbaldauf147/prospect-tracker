// What a Table View bulk edit writes to one company, for a column of the
// Table View's column list. Kept pure so the rules can be tested without a
// browser.
//
//   col      the column ({ key, type })
//   mode     'set' for every column; for a tags column 'add' or 'remove'
//   value    what was picked or typed (blank clears, except on tags)
//   current  the company's value for that column now
//
// Returns { patch } to write, { skip: true } when the company already has
// it (so it isn't written for nothing), or { error } for input that can't
// be stored.
export function bulkEditPatch(col, mode, value, current) {
  const key = col.key;
  if (col.type === 'tags') {
    const tag = String(value ?? '').trim();
    if (!tag) return { error: 'Pick a value to add or remove.' };
    const arr = Array.isArray(current) ? current : [];
    const has = arr.some(t => String(t).toLowerCase() === tag.toLowerCase());
    if (mode === 'remove') {
      if (!has) return { skip: true };
      return { patch: { [key]: arr.filter(t => String(t).toLowerCase() !== tag.toLowerCase()) } };
    }
    if (has) return { skip: true };
    return { patch: { [key]: [...arr, tag] } };
  }
  if (col.type === 'number') {
    const raw = String(value ?? '').replace(/[$,\s]/g, '');
    if (!raw) return current == null || current === '' ? { skip: true } : { patch: { [key]: null } };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `"${value}" is not a number.` };
    return Number(current) === n && current !== '' && current != null ? { skip: true } : { patch: { [key]: n } };
  }
  const next = String(value ?? '').trim();
  if (String(current ?? '') === next) return { skip: true };
  return { patch: { [key]: next } };
}
