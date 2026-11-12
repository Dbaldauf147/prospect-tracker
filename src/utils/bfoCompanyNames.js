// A company can sit under more than one Account in BFO (a parent and a
// regional entity, an old name and the new one). `bfoCompanyName` stays the
// primary name, the one every BFO Company Name column shows; any others are
// kept in `bfoCompanyAltNames`, one per line, the same way `aliases` is.
// Matching against BFO should go through bfoCompanyNamesOf so every name
// counts.

export const splitBfoNames = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n;]+/))
  .map(s => String(s || '').trim())
  .filter(Boolean);

// Primary first, then the others, without repeats (case-insensitive).
export function bfoCompanyNamesOf(p) {
  const out = [];
  const seen = new Set();
  for (const n of [String(p?.bfoCompanyName || '').trim(), ...splitBfoNames(p?.bfoCompanyAltNames)]) {
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}
