// The HTML half of the Scope picker's Copy button.
//
// scopeCopyText.js builds the plain text, which is what most pastes land.
// This builds the same content as markup, so the two go on the clipboard
// together and a paste into Outlook or Word arrives as real bulleted
// lists under bold headings, laid out across the page the way the board
// lays its category cards out, rather than as one long column of lines
// that happen to start with a hyphen. Anywhere that will not take markup
// falls back to the text and nothing is lost.
//
// The columns are a <table>. CSS column-count is the obvious tool and is
// no use here: Outlook renders with Word's engine, which ignores it, and
// Outlook is most of why this flavour exists.
//
// Same content, deliberately: the two flavours are one copy in two
// spellings, so the format pinned by scopeCopyText.test.mjs stays the
// single answer to "what does Copy put on the clipboard".
//
// Styles are inline because Outlook drops <style> blocks, and the font
// stack matches the KTM mapping popup's payload so two pastes into the
// same email look like one document.

const FONT = 'font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;color:#1F2937';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// How many categories go side by side.
//
// The board itself lays its categories out as a grid of cards, and a scope
// with a dozen of them reads as a page of headings when it is poured into
// one column. This puts them back across the page.
//
// Capped at three: the cells divide whatever width the paste lands in, and
// a Word page split four ways leaves about 150px a column, which is less
// than a service name. Two up to four categories rather than three, so
// four lands as a tidy 2x2 instead of a row of three and a straggler.
function columnCount(n) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}

// Percentages rather than pixels: the table is told to fill its container,
// so the same paste sizes itself to a Word page, an Outlook reading pane
// or a Google Doc instead of carrying one document's width into all of
// them.
function cell(block, columns) {
  const width = Math.round(100 / columns);
  return `<td width="${width}%" valign="top" style="width:${width}%;vertical-align:top;padding:0 14px 14px 0">${block}</td>`;
}

/**
 * @param {Array<{category: string, items: Array<{label: string}>}>} groups
 *   The picker's `selectedGroups` - the same argument scopeCopyText takes.
 * @param {string[]} [commodities] What this scope is about, if anything.
 * @returns {string} The clipboard markup, or '' when there is nothing to
 *          copy. Empty for exactly the cases scopeCopyText is empty for,
 *          so the button can never offer one flavour without the other.
 */
export function scopeCopyHtml(groups, commodities) {
  const picks = (commodities || []).map(c => String(c || '').trim()).filter(Boolean);

  const blocks = [];
  for (const group of groups || []) {
    const names = (group?.items || [])
      .map(it => String(it?.label ?? '').trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    const heading = String(group?.category || '').trim();
    blocks.push(
      (heading ? `<div style="font-weight:700;margin:0 0 2px">${escapeHtml(heading)}</div>` : '')
      + '<ul style="margin:0;padding-left:22px">'
      + names.map(n => `<li style="margin:0 0 2px">${escapeHtml(n)}</li>`).join('')
      + '</ul>',
    );
  }
  if (blocks.length === 0) return '';

  const lead = picks.length > 0
    ? `<div style="margin:0 0 10px">Commodities: ${escapeHtml(picks.join(', '))}</div>`
    : '';

  // One category is a list, not a layout. Skip the table so a small scope
  // pastes as ordinary prose that reflows with the document around it.
  const columns = columnCount(blocks.length);
  if (columns === 1) return `<div style="${FONT}">${lead}${blocks[0]}</div>`;

  // Categories run across and then wrap, the way they do on the board, so
  // the paste is in the order the person ticking them was reading. The last
  // row is padded with empty cells, or its one filled cell would stretch to
  // the full width and sit under columns it is not part of.
  const rows = [];
  for (let i = 0; i < blocks.length; i += columns) {
    const row = blocks.slice(i, i + columns).map(b => cell(b, columns));
    while (row.length < columns) row.push(cell('', columns));
    rows.push(`<tr>${row.join('')}</tr>`);
  }

  return `<div style="${FONT}">${lead}`
    + '<table cellpadding="0" cellspacing="0" border="0" width="100%"'
    + ' style="width:100%;border-collapse:collapse;border:0">'
    + rows.join('')
    + '</table></div>';
}
