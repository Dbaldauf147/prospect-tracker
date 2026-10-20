// Which of a service's cost lines are left out of its price check (the
// "In price check" tickbox on the Services subtab).
//
// A pick is saved by the line's description, lowercased, so it holds on
// every option and on the next SIA that carries the same line. That alone
// can't tell two lines apart when a service has more than one with the
// same description (a Hunting License line billed monthly beside the one
// that takes 35% of the gained share): unticking one unticked both. So a
// description that repeats within the service is keyed by which repeat it
// is as well, "<description> #2" for the second, in SIA order.
//
// A bare description saved before this still leaves out every line that
// carries it, as it always did; the first pick made on one of those lines
// rewrites it into a key per line, keeping the others as they were.
//
// Pure, so scripts/priceCheckExclusions.test.mjs can hold it still.

const norm = (v) => String(v ?? '').trim().toLowerCase();

// The key each of a service's cost lines is saved under, by line id.
export function priceCheckLineKeys(items = []) {
  const totals = new Map();
  for (const it of items) {
    const d = norm(it?.description);
    totals.set(d, (totals.get(d) || 0) + 1);
  }
  const seen = new Map();
  const keys = new Map();
  for (const it of items) {
    const d = norm(it?.description);
    if (!d) continue;
    const n = (seen.get(d) || 0) + 1;
    seen.set(d, n);
    keys.set(it.id, totals.get(d) > 1 ? `${d} #${n}` : d);
  }
  return keys;
}

// Whether each line is left out, by line id, given the saved list.
export function priceCheckExcludedIds(items = [], saved = []) {
  const set = new Set(saved || []);
  const keys = priceCheckLineKeys(items);
  const out = new Set();
  for (const it of items) {
    const k = keys.get(it.id);
    if (k && (set.has(k) || set.has(norm(it.description)))) out.add(it.id);
  }
  return out;
}

// The saved list after one line is left out (`ignored`) or put back. Null
// when the line has no description to save it by.
export function setPriceCheckExcluded(items = [], saved = [], itemId, ignored) {
  const keys = priceCheckLineKeys(items);
  const key = keys.get(itemId);
  if (!key) return null;
  const item = items.find(it => it.id === itemId);
  const desc = norm(item?.description);
  const next = new Set(saved || []);
  if (key !== desc && next.has(desc)) {
    // A bare description covered every line that carries it: spell it out
    // per line so this pick moves only this one.
    next.delete(desc);
    for (const it of items) {
      if (norm(it.description) === desc) next.add(keys.get(it.id));
    }
  }
  if (ignored) next.add(key); else next.delete(key);
  return [...next];
}
