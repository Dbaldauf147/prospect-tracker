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

// Firm names that carry a comma of their own. A run of fragments that
// spells one of these is kept as ONE owner, so "Clayton, Dubilier & Rice
// (CD&R)" is a single chip, not "Clayton" + "Dubilier & Rice (CD&R)".
// The last segment only has to START the fragment, so a trailing
// "(CD&R)" / "(CDR)" / ", LP" variant still matches. The app also
// registers every company on the roster whose name has a comma
// (registerKnownPeOwnerNames), so a firm added later is covered too.
const BUILTIN_COMMA_FIRMS = [
  'Clayton, Dubilier & Rice',
  'Welsh, Carson, Anderson & Stowe',
  'Golder, Thoma, Cressey, Rauner',
  'Kohlberg, Kravis, Roberts',
  'Hicks, Muse, Tate & Furst',
  'Forstmann, Little & Co',
  'Brown, Gibbons, Lang & Company',
  'Bruckmann, Rosser, Sherrill & Co',
  'Castle Harlan, Inc',
];

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const knownSegments = new Map(); // normalized full name -> normalized segments

function addKnown(name) {
  const segs = String(name || '').split(/[,;]/).map(norm).filter(Boolean);
  if (segs.length < 2) return;
  knownSegments.set(segs.join(', '), segs);
}
BUILTIN_COMMA_FIRMS.forEach(addKnown);

export function registerKnownPeOwnerNames(names) {
  for (const n of names || []) addKnown(n);
}

// How many fragments from `parts[i]` on spell a known comma name (0 = none).
function knownRunAt(parts, i) {
  let best = 0;
  for (const segs of knownSegments.values()) {
    const n = segs.length;
    if (n <= best || i + n > parts.length) continue;
    let ok = true;
    for (let k = 0; k < n - 1 && ok; k++) ok = norm(parts[i + k]) === segs[k];
    if (!ok) continue;
    const last = norm(parts[i + n - 1]);
    const tail = segs[n - 1];
    if (last === tail || (last.startsWith(tail) && !/[a-z0-9]/.test(last[tail.length]))) best = n;
  }
  return best;
}

export function splitPeOwners(value) {
  const parts = String(value || '').split(/[,;]/).map(p => p.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const run = knownRunAt(parts, i);
    if (run > 1) {
      out.push(parts.slice(i, i + run).join(', '));
      i += run - 1;
      continue;
    }
    const part = parts[i];
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
