// Figures read back out of a company's saved Master Analysis workbook.
//
// The Utility Lookup page works out a headline Indicative Annual Savings and
// writes it into the workbook twice - once on the Summary sheet and once in
// the Savings Summary band at the top of the Indicative Savings sheet - and,
// since the Scale fields were added, also stamps it onto the company record
// on its way past. Companies analysed before that stamp existed have the
// figure in their saved workbook and an empty box on their card, and there
// was no way to get it from one to the other short of re-running the whole
// analysis.
//
// So the card reads it back. The workbook is already stored against the
// company - it is what the Download button fetches - and the figure in it is
// the same number the save would have stamped.
//
// Deliberately NOT a re-derivation. Nothing here recomputes savings: the
// savings model is a month-by-month ramp gated by each site's supplier
// contract dates, it lives on the Utility Lookup page, and a second
// implementation of it that agreed with the first only most of the time
// would be worse than no implementation at all. This finds a number
// somebody else already worked out and hands it over unchanged.
//
// Pure, and reads a plain { SheetNames, Sheets } workbook, so the rule for
// finding the figure can be tested against a real workbook without a
// browser.

// The label the workbook writes beside the figure, in both places it writes
// it: "Total Indicative Annual Savings (Electric + Natural Gas)".
//
// Anchored on ANNUAL because the row under it is "Total Indicative
// Cumulative Savings over the Term", which is the same figure multiplied by
// the term and is emphatically not what the company's annual box holds.
const ANNUAL_SAVINGS_LABEL = /total\s+indicative\s+annual\s+savings/i;

// Where to look first. Summary is a small fixed sheet built for reading;
// Indicative Savings is the big scenario sheet that carries the same band.
// Any other sheet is searched last rather than not at all, so a workbook
// whose sheets were renamed still answers.
const PREFERRED_SHEETS = ['Summary', 'Indicative Savings'];

// Column letters to and from an index, for walking a row. SheetJS addresses
// cells as "F5", and the figure sits an unknown number of columns right of
// its label - merged cells mean the label is in A and the value in F on one
// sheet and in J on the other.
function colName(n) {
  let s = '';
  let i = n;
  while (i >= 0) {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// The sheet's used range as { minCol, maxCol, minRow, maxRow }, 0-based.
// A sheet with no !ref has nothing on it.
function usedRange(sheet) {
  const ref = String(sheet?.['!ref'] || '');
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  return {
    minCol: colIndex(m[1]), minRow: Number(m[2]) - 1,
    maxCol: colIndex(m[3]), maxRow: Number(m[4]) - 1,
  };
}

// A cell's value. SheetJS puts a formula's CACHED result in `v` and the
// formula itself in `f`, which is the whole reason this works offline: the
// workbook's headline is a formula summing the two commodity sections, and
// nothing here evaluates formulas.
function cellAt(sheet, row, col) {
  return sheet?.[`${colName(col)}${row + 1}`] || null;
}

function numberOf(cell) {
  if (!cell) return null;
  const v = cell.t === 'n' ? cell.v : Number(cell.v);
  return Number.isFinite(v) ? v : null;
}

function textOf(cell) {
  if (!cell) return '';
  return String(cell.w ?? cell.v ?? '').trim();
}

/**
 * The headline Indicative Annual Savings in one saved analysis workbook, or
 * null when it does not carry one.
 *
 * Found by its label rather than by a cell address: the band moves down the
 * Indicative Savings sheet as the tables above it grow, and pinning a row
 * number would read whatever happened to land there instead. The value is
 * the first number to the RIGHT of the label on the same row, which is where
 * both sheets put it.
 *
 * Zero and below come back null. The save itself only ever stamps a positive
 * figure - "a run that priced nothing must not blank a figure somebody
 * typed" - and reading the workbook back has to honour the same rule or the
 * refresh button would undo what the save was careful not to do.
 */
export function annualSavingsFromWorkbook(wb) {
  const names = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  if (names.length === 0) return null;
  const order = [
    ...PREFERRED_SHEETS.filter(n => names.includes(n)),
    ...names.filter(n => !PREFERRED_SHEETS.includes(n)),
  ];
  for (const name of order) {
    const found = annualSavingsInSheet(wb.Sheets?.[name]);
    if (found != null) return found;
  }
  return null;
}

/** The same search over one sheet. Exported for the tests to pin. */
export function annualSavingsInSheet(sheet) {
  const range = usedRange(sheet);
  if (!range) return null;
  for (let row = range.minRow; row <= range.maxRow; row++) {
    let labelCol = -1;
    for (let col = range.minCol; col <= range.maxCol; col++) {
      if (ANNUAL_SAVINGS_LABEL.test(textOf(cellAt(sheet, row, col)))) { labelCol = col; break; }
    }
    if (labelCol < 0) continue;
    for (let col = labelCol + 1; col <= range.maxCol; col++) {
      const n = numberOf(cellAt(sheet, row, col));
      if (n != null) return n > 0 ? Math.round(n) : null;
    }
  }
  return null;
}
