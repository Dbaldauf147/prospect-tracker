// Turning a block pasted out of Excel into picklist options, for the
// Dropdowns page's "Add option" box.
//
// A column copied from Excel arrives as one value per line; a row arrives
// tab-separated; a selection of both is both. Every non-empty cell becomes
// an option. Excel wraps a cell that holds a line break or a quote in double
// quotes, so those are read as one cell rather than split.

/** The cells of a pasted block, trimmed, in reading order, blanks dropped. */
export function splitPastedCells(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === '\t' || ch === '\n') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * The options to append to `existing` from a pasted block: new values only,
 * each once, compared case-insensitively the way a typed add is. Returns
 * { added, skipped } so the page can say what it did.
 */
export function newOptionsFromPaste(existing, text) {
  const seen = new Set((existing || []).map(o => String(o).toLowerCase()));
  const added = [];
  let skipped = 0;
  for (const cell of splitPastedCells(text)) {
    const key = cell.toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    added.push(cell);
  }
  return { added, skipped };
}
