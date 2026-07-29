// A company's PE Owner field (prospect.peOwner and the Opps tab's
// "PE Owner" column) holds one or more PE firm names in a single
// comma-separated string — e.g. "Blue Owl Capital, KKR". splitPeOwners
// is the one parser for that format: every consumer that needs the
// individual firms (contact rosters, the PE tab's portfolio-company
// linkage, owner filters, autocomplete) splits through here so they
// can't drift.
//
// Splitting is on commas/semicolons, with one guard: a fragment that is
// just a corporate suffix ("LP", "LLC", "Inc") is glued back onto the
// previous name so a single owner like "Bain Capital, LP" survives.
const CORP_SUFFIX_FRAGMENT = /^(l\.?l\.?c|l\.?p|l\.?l\.?p|inc|incorporated|ltd|limited|plc|co|corp|corporation|s\.?a|n\.?v|gmbh|ag)\.?$/i;

export function splitPeOwners(value) {
  const out = [];
  for (const raw of String(value || '').split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    if (out.length > 0 && CORP_SUFFIX_FRAGMENT.test(part)) {
      out[out.length - 1] += `, ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

export function joinPeOwners(owners) {
  return (owners || []).map(o => String(o || '').trim()).filter(Boolean).join(', ');
}
