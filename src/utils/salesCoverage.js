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
