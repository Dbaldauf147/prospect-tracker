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

  // Stacked rather than side by side, each under its own bar. Two figures
  // sharing a row read as one split of a whole, and these are not that: they
  // are two separate shares of the same site count. Nor is the second nested
  // inside the first — a site's interval answer comes from its row in the
  // mapping table, which exists for any utility found there, including one
  // whose mapped value is not a known utility. One full-width band each.
  const kpis = [
    { label: 'Sites mapped to a known utility', n: mapped },
    { label: 'Sites with utility interval data', n: intervalYes },
  ];

  for (const k of kpis) {
    const pct = Math.round((k.n / totalSites) * 100);

    // The bar sits ABOVE its label. It is a real Excel data bar over a real
    // number rather than a drawn shape, so it stays proportional if a reader
    // edits the figure, and it survives the round-trip through Sheets and
    // LibreOffice that a picture would not.
    //
    // Scaled 0..100 explicitly. Left to itself Excel scales a data bar to the
    // min and max of the range, which for a single cell fills the whole width
    // whatever the number is — 60% and 97% would both read as "all of it".
    ws.mergeCells(row, 1, row, NCOLS);
    const bar = ws.getCell(row, 1);
    bar.value = pct / 100;
    bar.numFmt = '0%';
    bar.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: SE_GREEN_DARK } };
    bar.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.addConditionalFormatting({
      ref: `${colLetter(1)}${row}:${colLetter(NCOLS)}${row}`,
      rules: [{
        type: 'dataBar',
        gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }],
        color: { argb: SE_GREEN_DARK },
      }],
    });
    ws.getRow(row).height = 14;
    row++;

    ws.mergeCells(row, 1, row, NCOLS);
    const cell = ws.getCell(row, 1);
    cell.value = `${k.label}:  ${pct}%   (${k.n.toLocaleString()} of ${totalSites.toLocaleString()} sites)`;
    cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    ws.getRow(row).height = 22;
    row++;
  }
}

// 1 -> 'A'. Data-bar refs are A1-style, and the section is written by column
// number everywhere else.
function colLetter(n) {
  let out = '';
  let i = n;
  while (i > 0) {
    const rem = (i - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

