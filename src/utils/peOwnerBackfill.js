// One-time prospect backfills, run once per user/browser from App.jsx
// (each pass guarded by its own userLs flag) after prospects finish
// loading. Each pass stamps a set of field values onto a fixed list of
// Table View companies, then reports what changed and which names found
// no match — with close-name candidates so a renamed record can be
// fixed by hand.
import { normalizeCompanyName } from './firestoreSync';
import { splitPeOwners, joinPeOwners } from './peOwners';

export const BLUE_OWL_PE_OWNER = 'Blue Owl Capital';

export const BLUE_OWL_COMPANIES = [
  'Clearlake Capital Group',
  'ICONIQ Capital',
  'Sixth Street Partners',
  'Stonepeak',
  'Golub Capital',
  'H.I.G. Capital',
  'Platinum Equity',
  'SoundPoint Capital Management',
  'Veritas Capital',
  'I Squared Capital',
  'EnCap Investments',
  'Bridgepoint Advisers',
  'Providence Equity Partners',
  'DivCore',
  'ECP',
  'MBK Partners',
  'PAI Partners',
  'Quantum',
  'American Securities',
  'NEA',
  'Cerberus Capital Management',
  'TowerBrook Capital Partners',
  'KPS Capital Partners',
  'Graham Capital Management',
  'RXR Realty',
  'Capital Fund Management',
  'TSG Consumer',
  'Landmark Properties',
  'Round Hill Capital',
  'Waterfall Asset Management',
  'Capstone Partners',
  'LibreMax Capital',
  'LBA Logistics',
  'LBA Realty',
  'CrossHarbor',
  'HGGC',
  'Linden',
  'Pinnacle Asset Management',
  'INCLINE EQUITY PARTNERS',
  'Whitebox Advisors',
  'Lead Edge Capital',
  'Chenavari',
  'Vector Capital',
  'Carnelian Energy Capital',
  'Bardin Hill',
  'MKP Capital Management',
  'GrowthCurve Capital',
  'BITKRAFT Ventures',
  'Scopia',
  'Dragoneer',
  'H.I.G. Growth Partners',
  'HPS Investment Partners',
  'Marble Capital',
  'New Enterprise Associates',
];

// The Blue Owl GP-stakes firms Dan hand-added to Table View after the
// first pass reported them missing — these also get typed as PE Firm.
export const PE_FIRM_COMPANIES = [
  'Capital Fund Management',
  'Carnelian Energy Capital',
  'Chenavari',
  'CrossHarbor',
  'Dragoneer',
  'Golub Capital',
  'Graham Capital Management',
  'GrowthCurve Capital',
  'H.I.G. Growth Partners',
  'LBA Logistics',
  'LibreMax Capital',
  'Marble Capital',
  'MKP Capital Management',
  'NEA',
  'Pinnacle Asset Management',
  'Quantum',
  'Scopia',
  'Sixth Street Partners',
  'SoundPoint Capital Management',
  'TSG Consumer',
  'Vector Capital',
  'Waterfall Asset Management',
  'Whitebox Advisors',
];

// Every pass runs at most once per user/browser; a new pass = a new
// entry with a fresh flag. `fields` are written verbatim onto each
// matching prospect (only when at least one differs).
export const BACKFILL_PASSES = [
  {
    flag: 'pe-owner-blue-owl-2026-06',
    companies: BLUE_OWL_COMPANIES,
    fields: { peOwner: BLUE_OWL_PE_OWNER },
    description: `PE Owner = "${BLUE_OWL_PE_OWNER}"`,
  },
  {
    flag: 'pe-firm-blue-owl-2026-06-12',
    companies: PE_FIRM_COMPANIES,
    fields: { peOwner: BLUE_OWL_PE_OWNER, type: 'PE Firm' },
    description: `PE Owner = "${BLUE_OWL_PE_OWNER}" and Type = "PE Firm"`,
  },
];

// Whole-word containment between two normalized names, so candidate
// suggestions catch "Stonepeak Infrastructure Partners" for "Stonepeak"
// without "NEA" matching the letters inside "Lineage".
function containsPhrase(longer, shorter) {
  return ` ${longer} `.includes(` ${shorter} `);
}

// A list name and a Table View name suggest each other when one is a
// whole-word extension of the other. When the *record* is the shorter
// side it must still be a distinctive name — "Capital Group" normalizes
// to just "capital" (corp suffix stripped) and would otherwise surface
// as a candidate for every target containing that word.
function isCandidate(targetNorm, recordNorm) {
  if (containsPhrase(recordNorm, targetNorm)) return true;
  if (!containsPhrase(targetNorm, recordNorm)) return false;
  return recordNorm.includes(' ') || recordNorm.length >= 9;
}

function fieldEquals(current, wanted, key) {
  // peOwner can hold several comma-separated owners; the pass is
  // satisfied as soon as the wanted firm is one of them, so a record a
  // user extended with a second owner isn't treated as needing a write.
  if (key === 'peOwner') {
    const want = String(wanted || '').trim().toLowerCase();
    return splitPeOwners(current).some(o => o.toLowerCase() === want);
  }
  return String(current || '').trim().toLowerCase() === String(wanted || '').trim().toLowerCase();
}

// Updates every prospect whose normalized company name exactly matches
// a list entry. Deliberately no fuzzy matching on the write path — a
// near-miss name only ever becomes a suggestion in the report, never
// an edit.
export async function runProspectBackfill(prospects, updateProspect, { companies, fields }) {
  const byNorm = new Map();
  for (const p of prospects) {
    const n = normalizeCompanyName(p?.company);
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(p);
  }

  const updated = [];
  const alreadySet = [];
  const failed = [];
  const notFound = [];

  for (const name of companies) {
    const norm = normalizeCompanyName(name);
    const matches = byNorm.get(norm) || [];
    if (matches.length === 0) {
      const candidates = [];
      for (const [key, list] of byNorm) {
        if (key !== norm && isCandidate(norm, key)) {
          for (const p of list) candidates.push(p.company);
        }
        if (candidates.length >= 3) break;
      }
      notFound.push({ name, candidates: candidates.slice(0, 3) });
      continue;
    }
    for (const p of matches) {
      // Only write the fields that actually differ; for peOwner, append
      // the firm to whatever owners are already listed rather than
      // overwriting them.
      const writes = {};
      for (const [k, v] of Object.entries(fields)) {
        if (fieldEquals(p[k], v, k)) continue;
        writes[k] = k === 'peOwner' ? joinPeOwners([...splitPeOwners(p[k]), v]) : v;
      }
      if (Object.keys(writes).length === 0) {
        alreadySet.push(p.company);
        continue;
      }
      try {
        await updateProspect(p.id, writes);
        updated.push(p.company);
      } catch (err) {
        failed.push(`${p.company} · ${err?.message || err}`);
      }
    }
  }

  return { updated, alreadySet, failed, notFound };
}

export function formatBackfillReport(pass, { updated, alreadySet, failed, notFound }) {
  const lines = [
    `Company update: set ${pass.description} on ${updated.length} ` +
    `compan${updated.length === 1 ? 'y' : 'ies'} in Table View.`,
  ];
  if (alreadySet.length) lines.push(`\nAlready set on ${alreadySet.length}: ${alreadySet.join(', ')}`);
  if (failed.length) lines.push(`\nFAILED to save (${failed.length}):\n  ${failed.join('\n  ')}`);
  if (notFound.length) {
    lines.push(`\nNOT FOUND in Table View (${notFound.length}): update these by hand:`);
    for (const { name, candidates } of notFound) {
      lines.push(`  • ${name}${candidates.length ? ` (close match: ${candidates.join(', ')})` : ''}`);
    }
  }
  if (!failed.length && !notFound.length) lines.push('\nEvery company matched: nothing left to do.');
  return lines.join('\n');
}
