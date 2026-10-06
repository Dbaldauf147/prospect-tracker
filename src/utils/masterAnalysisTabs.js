// The tabs a Master Analysis workbook can carry, grouped the way the
// download's tab picker shows them, plus the pruning that drops the ones
// the user unticked.
//
// The catalog is static rather than read off a built workbook because the
// picker opens before anything is built - building first would make the
// user wait through the whole export just to see a list of names. A tab in
// the catalog that a given portfolio doesn't produce (no European sites, so
// no Europe tab) simply never appears in the file, ticked or not.
//
// Names must match the addWorksheet calls in SitesView's Master Analysis
// pipeline and the builders it calls (complianceReportXlsx, divisionsSummary).
// A sheet whose name is NOT in the catalog is never pruned, so a tab added
// later without updating this list still ships rather than vanishing.
//
// `hidden: true` marks a tab the export writes as a hidden sheet (the
// reader has to right-click > Unhide to see it). The picker styles those
// differently; ticking still decides whether they ship at all.

export const MASTER_ANALYSIS_TAB_GROUPS = [
  {
    label: 'Indicative Savings',
    tabs: [
      { name: 'Summary', hint: 'Headline savings, compliance exposure and interval data coverage' },
      { name: 'Global', hint: 'Map of every site worldwide' },
      { name: 'NAM', hint: 'North America map and state roll-up' },
      { name: 'ISO', hint: 'Sites and spend by ISO / RTO' },
      { name: 'Europe', hint: 'Map of European sites' },
      { name: 'Contract Coverage', hint: 'Every deregulated site and when its supply agreement ends; feeds the Indicative Savings tab' },
      { name: 'Indicative Savings', hint: 'Savings scenario, term and the per-state tables' },
      { name: 'Site Detail', hint: 'One row per site with its consumption, rates and savings' },
      { name: 'Monthly Savings', hidden: true, hint: 'Savings spread across the months of the year' },
      { name: 'Contract Overview', hint: 'Current supply contracts and their end dates' },
      { name: 'Hedging Analysis', hidden: true, hint: 'Index vs fixed price and hedge % over time' },
      { name: 'Gas Market Timing', hidden: true, hint: 'Forward gas prices and the favorable buy windows' },
      { name: 'Floating vs Hedging Example', hidden: true, hint: 'Worked example of floating vs hedged pricing' },
      { name: 'Methodology', hidden: true, hint: 'How the savings figures are derived' },
      { name: 'Alerts Catalog', hidden: true, hint: 'The market alerts the service sends' },
    ],
  },
  {
    label: 'Building Compliance',
    tabs: [
      { name: 'Compliance Report', hint: 'Benchmarking, audit and performance standard exposure' },
      { name: 'Compliance Site Detail', hint: 'One row per screened site with its mandates' },
      { name: 'Compliance Report Methodology', hint: 'How the estimated fines were worked out' },
    ],
  },
  {
    label: 'Corporate Compliance',
    tabs: [
      { name: 'Corporate Compliance', hint: 'Company-level disclosure obligations and California operations' },
    ],
  },
  {
    label: 'Utility Mapping',
    tabs: [
      { name: 'Utility Mapping', hint: 'Coverage map: sites mapped to a known utility, with interval data' },
      { name: 'Utility Mapping by State', hint: 'Mapping and interval data coverage per state' },
      { name: 'Utility Mapping Site Detail', hint: 'One row per site with its utility and status' },
    ],
  },
  {
    label: 'Portfolio',
    tabs: [
      { name: 'Divisions', hint: 'Savings, compliance and coverage per division' },
      { name: 'Site List', hint: 'The uploaded sites, needed to import the file back onto this page' },
    ],
  },
];

export const MASTER_ANALYSIS_TAB_NAMES = MASTER_ANALYSIS_TAB_GROUPS.flatMap(g => g.tabs.map(t => t.name));

// Keep only names the catalog knows about, in catalog order. Used to clean
// a remembered selection so a tab renamed or retired since doesn't linger.
export function normalizeTabSelection(names) {
  if (!Array.isArray(names)) return [...MASTER_ANALYSIS_TAB_NAMES];
  const want = new Set(names);
  return MASTER_ANALYSIS_TAB_NAMES.filter(n => want.has(n));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Does this formula point at a sheet called `name`? Excel writes the
// reference quoted ('Site Detail'!A1) whenever the name needs it and bare
// (NAM!A1) when it doesn't, so both spellings count.
function referencesSheet(formula, name) {
  if (typeof formula !== 'string' || !formula) return false;
  const quoted = `'${name.replace(/'/g, "''")}'!`;
  if (formula.toLowerCase().includes(quoted.toLowerCase())) return true;
  return new RegExp(`(^|[^A-Za-z0-9_.'])${escapeRegex(name)}!`, 'i').test(formula);
}

// Remove every catalogued tab not in `keep` from an ExcelJS workbook.
// Returns the names actually removed.
//
// A formula left pointing at a removed tab would open as #REF! (the Summary
// tab's savings headline reads the Indicative Savings tab, for one), so any
// such cell is frozen to the value it was written with. Same for an
// in-workbook hyperlink: it becomes plain text rather than a link to
// nowhere. Hidden catalogued tabs (Methodology, Monthly Savings...) are
// pruned like any other: unticked means not in the file, hidden or not.
// The round-trip state sheet isn't catalogued, so it always stays.
export function pruneMasterAnalysisTabs(wb, keep) {
  const keepSet = new Set(keep || []);
  const catalog = new Set(MASTER_ANALYSIS_TAB_NAMES);
  const removed = [];
  for (const ws of [...wb.worksheets]) {
    if (!catalog.has(ws.name) || keepSet.has(ws.name)) continue;
    removed.push(ws.name);
    wb.removeWorksheet(ws.id);
  }
  if (removed.length === 0) return removed;

  const pointsAtRemoved = (formula) => removed.some(n => referencesSheet(formula, n));
  for (const ws of wb.worksheets) {
    const toFreeze = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (!v || typeof v !== 'object') return;
        let formula = v.formula;
        if (!formula && v.sharedFormula) formula = ws.getCell(v.sharedFormula).value?.formula;
        if (formula && pointsAtRemoved(formula)) {
          toFreeze.push([cell, v.result ?? null]);
          return;
        }
        if (typeof v.hyperlink === 'string' && v.hyperlink.startsWith('#') && pointsAtRemoved(v.hyperlink.slice(1))) {
          toFreeze.push([cell, v.text ?? '']);
        }
      });
    });
    // Frozen after the walk, not during it: a shared-formula master
    // rewritten mid-walk would hide the formula its dependents read.
    for (const [cell, value] of toFreeze) {
      cell.value = (value && typeof value === 'object' && 'error' in value) ? null : value;
    }
  }

  // The workbook may have opened on a tab that is gone now.
  if (Array.isArray(wb.views) && wb.views.length) {
    wb.views = wb.views.map(v => ({ ...v, activeTab: 0, firstSheet: 0 }));
  }
  return removed;
}
