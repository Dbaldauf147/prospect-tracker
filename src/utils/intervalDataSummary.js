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
  const { totalSites, mapped = 0, intervalYes = 0, mappedInterval = null } = coverage;

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
  // sharing a row read as one split of a whole — which these are not: they are
  // two independent shares of the same site count, and the second is a subset
  // of the first. One full-width band each, in the order they narrow.
  const kpis = [
    { label: 'Sites mapped to a known utility', n: mapped },
    { label: 'Sites with utility interval data', n: intervalYes },
  ];

  // The intersection — sites that are BOTH. It cannot be read off the two
  // figures above by multiplying them: each is already a share of ALL sites,
  // so 93% of 97% would apply the mapped filter twice. Nor are the two nested,
  // which is the less obvious half: a site's interval answer comes from its
  // row in the mapping table, and that row exists for any utility found there
  // — including one whose mapped value is not a known utility, which counts as
  // unmapped. So this is counted at source and passed in.
  //
  // Null (an older caller that doesn't supply it) omits the line rather than
  // showing a figure derived the wrong way.
  if (mappedInterval != null) {
    kpis.push({
      label: 'Sites both mapped and with interval data',
      n: mappedInterval,
      // The share of MAPPED sites, alongside the share of all sites. This is
      // the "of the ones we could map, how many can we actually meter" read,
      // and it is the number that says whether the mapping work paid off.
      ofMapped: mapped > 0 ? Math.round((mappedInterval / mapped) * 100) : null,
    });
  }

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
    cell.value = `${k.label}:  ${pct}%   (${k.n.toLocaleString()} of ${totalSites.toLocaleString()} sites`
      + `${k.ofMapped != null ? ` · ${k.ofMapped}% of mapped sites` : ''})`;
    cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    ws.getRow(row).height = 22;
    row++;
  }

  ws.mergeCells(row, 1, row, NCOLS);
  const note = ws.getCell(row, 1);
  // The caption asked for, with the definition kept after it: without saying
  // what counts as interval data, "93%" is a number nobody can check.
  // The old wording said interval data required being mapped to a known
  // utility. It doesn't: the Status is read off the utility's row in the
  // mapping table, and that row exists whether or not the mapped value is a
  // known utility. Saying otherwise made the first two figures look nested
  // when they are not, which is exactly what the third line now settles.
  note.value = 'How many sites % are mapped and have interval data. A site counts as having interval data when '
    + 'its electric utility is found in the Utility Name Mapping table and that row\'s Status reports interval '
    + 'data available — which can be true of a utility that has not been mapped to a known utility, so the first '
    + 'two figures are separate shares of all sites rather than one inside the other. The third counts the sites '
    + 'that are both. Full breakdown on the Utility Mapping tabs.';
  note.font = { name: 'Nunito Sans', italic: true, size: 9.5, color: { argb: SE_SLATE } };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(row).height = 18;
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

