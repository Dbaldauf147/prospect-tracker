import { SALES_COVERAGE } from '../data/salesCoverage.js';

// Opps > Coverage is edited in the app and saved to settings.salesCoverage.
// Until somebody saves an edit, the list shipped in data/salesCoverage.js
// is what shows.

// The list to show: the saved copy when there is one, else the default.
// A saved empty list is kept - it means somebody cleared it on purpose.
export function coverageFromSettings(settings) {
  const saved = settings?.salesCoverage;
  return Array.isArray(saved) ? saved : SALES_COVERAGE;
}

// Split a typed "Sara Rahme, Candace Becker" into names.
export function splitSalespeople(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Tidy an edited list before it is saved: trim every field, drop rows with
// no vertical and no salesperson, and drop teams left with no name and no
// rows. A named team with no rows stays, so a new team can be saved before
// its verticals are filled in.
export function cleanCoverage(groups) {
  return (groups || [])
    .map(g => ({
      team: String(g?.team || '').trim(),
      rows: (g?.rows || [])
        .map(r => ({
          vertical: String(r?.vertical || '').trim(),
          salespeople: (Array.isArray(r?.salespeople) ? r.salespeople : splitSalespeople(r?.salespeople))
            .map(s => String(s).trim()).filter(Boolean),
        }))
        .filter(r => r.vertical || r.salespeople.length),
    }))
    .filter(g => g.team || g.rows.length);
}

// Who covers a vertical: every salesperson listed against it, once each,
// with the team(s) they are listed under. A vertical can sit under several
// teams (Grocery is under two), so this can name more than one person.
// Matched on the vertical with case and spacing dropped, so "real estate"
// on an opp finds "Real Estate" on the Coverage tab.
export function salespeopleForVertical(coverage, vertical) {
  const key = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const want = key(vertical);
  if (!want) return [];
  const byName = new Map();
  for (const group of coverage || []) {
    for (const row of group?.rows || []) {
      if (key(row?.vertical) !== want) continue;
      for (const name of row.salespeople || []) {
        const n = String(name || '').trim();
        if (!n) continue;
        if (!byName.has(n)) byName.set(n, { name: n, teams: [] });
        const team = String(group.team || '').trim();
        if (team && !byName.get(n).teams.includes(team)) byName.get(n).teams.push(team);
      }
    }
  }
  return [...byName.values()];
}

// Is this vertical on the Coverage tab at all, under any team? Matched the
// same way as salespeopleForVertical. A card whose Vertical is not on the
// list (a team name like "Retail Team", a typo) can't be checked against
// anybody's coverage, so the card says so rather than staying quiet.
export function isCoverageVertical(coverage, vertical) {
  const key = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const want = key(vertical);
  if (!want) return false;
  return (coverage || []).some(g => (g?.rows || []).some(r => key(r?.vertical) === want));
}

// One inline edit on the Coverage table, applied to the list as shown and
// tidied the way a full Edit-mode save is. `gi` / `ri` index the unfiltered
// list; `field` is 'team' (ri ignored), 'vertical' or 'salespeople' (typed
// "A, B"). Returns a new list; the one passed in is left alone.
export function withCoverageEdit(coverage, { gi, ri, field, value }) {
  const next = (coverage || []).map((g, i) => {
    if (i !== gi) return g;
    if (field === 'team') return { ...g, team: value };
    return {
      ...g,
      rows: (g.rows || []).map((r, j) => (j !== ri ? r : { ...r, [field]: field === 'salespeople' ? splitSalespeople(value) : value })),
    };
  });
  return cleanCoverage(next);
}
