// The Follow Up notes table, as something a spreadsheet will take.
//
// The table in the popup is already the shape people want the notes in:
// one row a step, the note beside who it is waiting on. Getting it into a
// spreadsheet meant selecting eight textareas by hand, which pastes as
// one run-on blob, or retyping it. So the table copies itself.
//
// Two flavours, written together (see utils/clipboardCopy):
//
//   - Markup, which is what Excel and Google Sheets actually read. A note
//     with four lines in it lands as four lines in ONE cell, and nothing
//     has to be un-mangled afterwards.
//   - Tab-separated text for everywhere else, quoted the way a spreadsheet
//     expects so a multi-line note still holds together as one cell.
//
// Same rows, same columns, same order in both: one copy in two spellings.

import { isStepDoneToday } from './nextSteps.js';

// The columns, in the order the popup shows them.
const HEADERS = ['Note', 'Waiting On', 'Done today'];

/**
 * The rows worth copying: a note or a Waiting On, trimmed.
 *
 * The editor always keeps one empty row on screen so there is somewhere
 * to type, and an opp with no steps is all empty rows. Neither is content,
 * and the same test decides what gets saved to the record.
 *
 * @param {Array<{note: string, waitingOn: string, doneOn: string}>} rows
 * @param {string} today ISO day, so every row answers "done today" about
 *        the same day, and a caller can ask about a different one.
 */
export function nextStepsCopyRows(rows, today) {
  const out = [];
  for (const row of rows || []) {
    const note = String(row?.note ?? '').trim();
    const waitingOn = String(row?.waitingOn ?? '').trim();
    if (!note && !waitingOn) continue;
    out.push({ note, waitingOn, done: isStepDoneToday(row?.doneOn, today) ? 'Yes' : '' });
  }
  return out;
}

// A field a spreadsheet will read back as one cell.
//
// A note with a line break in it is the whole reason this is here: pasted
// raw, the second line becomes a row of its own and every column after it
// is out by one. Quotes are the format Excel, Sheets and Numbers all parse,
// and are only spent where one of the three characters that need them
// appears, so an ordinary note stays readable in a plain-text paste.
function tsvField(value) {
  const text = String(value ?? '');
  if (!/[\t\n\r"]/.test(text)) return text;
  return `"${text.replace(/\r\n?/g, '\n').replace(/"/g, '""')}"`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The tab-separated flavour, header row first.
 *
 * @returns {string} '' when there is nothing worth copying, so the button
 *          can tell an empty table from a full one.
 */
export function nextStepsCopyText(rows, today) {
  const items = nextStepsCopyRows(rows, today);
  if (items.length === 0) return '';
  const lines = [HEADERS.join('\t')];
  for (const item of items) {
    lines.push([item.note, item.waitingOn, item.done].map(tsvField).join('\t'));
  }
  return lines.join('\n');
}

/**
 * The same table as markup.
 *
 * `mso-number-format` is the one piece of spreadsheet trivia in here: it
 * tells Excel to take a cell as text. Without it a note that happens to
 * start "9/15 call Brian" arrives as a date, which is the kind of quiet
 * mangling nobody checks for. Ignored everywhere that is not Excel.
 *
 * @returns {string} '' for exactly the cases the text flavour is empty for,
 *          so the button can never offer one flavour without the other.
 */
export function nextStepsCopyHtml(rows, today) {
  const items = nextStepsCopyRows(rows, today);
  if (items.length === 0) return '';
  const cell = (value, tag) => {
    const body = escapeHtml(value).replace(/\n/g, '<br>');
    const style = tag === 'th'
      ? 'border:1px solid #CBD5E1;padding:4px 6px;text-align:left;font-weight:700;background:#F1F5F9'
      : 'border:1px solid #CBD5E1;padding:4px 6px;vertical-align:top;mso-number-format:\'\\@\'';
    return `<${tag} style="${style}">${body}</${tag}>`;
  };
  const head = `<tr>${HEADERS.map(h => cell(h, 'th')).join('')}</tr>`;
  const body = items
    .map(item => `<tr>${[item.note, item.waitingOn, item.done].map(v => cell(v, 'td')).join('')}</tr>`)
    .join('');
  return '<table style="border-collapse:collapse;font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;color:#1F2937">'
    + `<thead>${head}</thead><tbody>${body}</tbody></table>`;
}
