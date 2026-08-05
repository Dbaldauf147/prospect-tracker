// The Master Analysis Summary tab's Interval Data section.
//
// Lives here rather than in SitesView with its caller, the same way the
// compliance sheet builders do: it takes a worksheet and writes to it, with
// nothing of the page in it.

// The Utility Mapping coverage headlines, restated on the Master Analysis
// Summary tab: the share of sites mapped to a known utility, and the share
// with utility interval data.
//
// Same two figures and the same green KPI band as the Utility Mapping tab
// carries — the point of repeating them here is that the savings on this sheet
// are only as good as the interval data behind them, and that read shouldn't
// need a reader to find another tab.
//
// `coverage` is what exportUtilityMappingAnalysis returns in targetWb mode.
// Missing or site-less coverage writes nothing rather than a row of zeros,
// which would read as "none of them" instead of "not measured".
export function appendIntervalDataSummary(ws, coverage) {
  if (!ws || !coverage || !coverage.totalSites) return;
  const SE_GREEN_DARK = 'FF009530';
  const SE_GREEN_LIGHT = 'FFE6F7EC';
  const SE_SLATE = 'FF475569';
  const NCOLS = 8;
  const { totalSites, mapped = 0, intervalYes = 0 } = coverage;

  // Below whatever the Summary already ended on — the sections above vary in
  // length (the top-states table has a row per state), so there is no row
  // number to hard-code.
  let row = ws.rowCount + 2;

  ws.mergeCells(row, 1, row, NCOLS);
  const head = ws.getCell(row, 1);
  head.value = 'Interval Data';
  head.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: SE_GREEN_DARK } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
  head.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 22;
  row++;

  const half = Math.floor(NCOLS / 2);
  const kpis = [
    { from: 1, to: half, label: 'Sites mapped to a known utility', n: mapped },
    { from: half + 1, to: NCOLS, label: 'Sites with utility interval data', n: intervalYes },
  ];
  for (const k of kpis) {
    ws.mergeCells(row, k.from, row, k.to);
    const cell = ws.getCell(row, k.from);
    cell.value = `${k.label}:  ${Math.round((k.n / totalSites) * 100)}%   (${k.n.toLocaleString()} of ${totalSites.toLocaleString()} sites)`;
    cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = {
      bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } },
      right: { style: 'thin', color: { argb: 'FFFFFFFF' } },
    };
  }
  ws.getRow(row).height = 22;
  row++;

  ws.mergeCells(row, 1, row, NCOLS);
  const note = ws.getCell(row, 1);
  note.value = 'A site counts as having interval data when its electric utility is mapped to a known utility whose Status reports interval data available. Full breakdown on the Utility Mapping tabs.';
  note.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(row).height = 18;
}

