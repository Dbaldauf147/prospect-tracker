// One-time backfill: stamp PE Owner = "Blue Owl Capital" on a fixed
// list of PE firms in Table View. Runs once per user/browser from
// App.jsx (guarded by a userLs flag) after prospects finish loading,
// then reports what changed and which names found no match — with
// close-name candidates so a renamed record can be fixed by hand.
import { normalizeCompanyName } from './firestoreSync';

export const PE_OWNER_BACKFILL_FLAG = 'pe-owner-blue-owl-2026-06';
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

// Updates every prospect whose normalized company name exactly matches
// a list entry. Deliberately no fuzzy matching on the write path — a
// near-miss name only ever becomes a suggestion in the report, never
// an edit.
export async function runPeOwnerBackfill(prospects, updateProspect) {
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

  for (const name of BLUE_OWL_COMPANIES) {
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
      if ((p.peOwner || '').trim().toLowerCase() === BLUE_OWL_PE_OWNER.toLowerCase()) {
        alreadySet.push(p.company);
        continue;
      }
      try {
        await updateProspect(p.id, { peOwner: BLUE_OWL_PE_OWNER });
        updated.push(p.company);
      } catch (err) {
        failed.push(`${p.company} — ${err?.message || err}`);
      }
    }
  }

  return { updated, alreadySet, failed, notFound };
}

export function formatPeOwnerBackfillReport({ updated, alreadySet, failed, notFound }) {
  const lines = [
    `PE Owner update — set "${BLUE_OWL_PE_OWNER}" on ${updated.length} ` +
    `compan${updated.length === 1 ? 'y' : 'ies'} in Table View.`,
  ];
  if (alreadySet.length) lines.push(`\nAlready set on ${alreadySet.length}: ${alreadySet.join(', ')}`);
  if (failed.length) lines.push(`\nFAILED to save (${failed.length}):\n  ${failed.join('\n  ')}`);
  if (notFound.length) {
    lines.push(`\nNOT FOUND in Table View (${notFound.length}) — update these by hand:`);
    for (const { name, candidates } of notFound) {
      lines.push(`  • ${name}${candidates.length ? ` (close match: ${candidates.join(', ')})` : ''}`);
    }
  }
  if (!failed.length && !notFound.length) lines.push('\nEvery company matched — nothing left to do.');
  return lines.join('\n');
}
