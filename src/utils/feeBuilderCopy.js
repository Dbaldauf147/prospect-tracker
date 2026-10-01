// The Fee Builder's "Copy selected": the fee rows ticked in the as-built
// table, as a table that pastes straight into Excel.
//
// Two flavours go on the clipboard (see clipboardCopy.js): tab-separated
// text, which is what Excel reads for a plain paste, and an HTML table so a
// paste into Word or Outlook lands as a real table too. Both carry the same
// header row and the same cells.
//
// The Fee goes out as "$1,234.56", which Excel reads as a number; Units and
// Start Month go out as bare numbers.

export const FEE_COPY_HEADERS = ['Fee line item', 'Type', 'Fee', 'Unit', 'Units', 'Start Month'];

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
// A tab or line break inside a cell would split it across columns or rows.
const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** One fee row (a plan row from the Fee Builder) as its six copied cells. */
export function feeCopyCells(r) {
  return [
    clean(r?.name),
    clean(r?.type),
    fmtMoney(r?.feePerUnit),
    clean(r?.unit),
    r?.unitCount == null || r.unitCount === '' ? '' : clean(r.unitCount),
    r?.startMonth == null || r.startMonth === '' ? '' : clean(r.startMonth),
  ];
}

/** Tab-separated text: the header row, then one line per row. */
export function feeCopyTsv(rows) {
  return [FEE_COPY_HEADERS, ...(rows || []).map(feeCopyCells)].map(cells => cells.join('\t')).join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same table as HTML, for destinations that take a rich paste. */
export function feeCopyHtml(rows) {
  const tr = (cells, tag) => `<tr>${cells.map(c => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
  return `<table><thead>${tr(FEE_COPY_HEADERS, 'th')}</thead><tbody>${(rows || []).map(r => tr(feeCopyCells(r), 'td')).join('')}</tbody></table>`;
}
