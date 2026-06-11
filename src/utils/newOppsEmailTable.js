// Client-side builder for the Opps 2 "Email table" export (Mass Edit →
// Email table). Renders the selected opps as a plain black-and-white HTML
// table — borders only, no fill colors, zebra striping, or brand styling —
// so it pastes into an email as a clean grid. Which columns appear (and
// their order) is chosen by the caller in the export modal.

// Columns available to the export, in their default order. Mirrors the New
// Opps report column set; `align: 'right'` for the numeric columns.
export const NEW_OPPS_EMAIL_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Open Year', label: 'Open Year' },
  { key: 'Contact', label: 'Contact' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Type', label: 'Type' },
  { key: 'Sales Partner', label: 'Sales Partner' },
  { key: 'Start Date', label: 'Start Date' },
  { key: 'Status', label: 'Status' },
  { key: 'Quoted Amount', label: 'Deal Size', align: 'right' },
  { key: 'Sites', label: 'Sites', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Link', label: 'BFO Opportunity Name' },
  { key: 'BFO Address', label: 'BFO Address' },
];

export const NEW_OPPS_EMAIL_COLUMN_KEYS = NEW_OPPS_EMAIL_COLUMNS.map((c) => c.key);

// Columns checked by default when the export modal opens. The rest stay
// available to toggle on. BFO Address is included; its cells render the
// text "BFO Link" hyperlinked to the BFO Address URL (see buildNewOppsTableHtml).
export const NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS = [
  'Account', 'Stage', 'Scope', 'Source', 'Start Date', 'Quoted Amount', 'Next Steps', 'BFO Address',
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Steps inside a single Next Steps box are stored with U+2028 line
// separators (and steps with "\n"); render both as <br> so a multi-line
// note reads as stacked lines in the table rather than one run-on string.
function escapeHtmlMultiline(s) {
  return escapeHtml(s).replace(/\u2028|\r?\n/g, "<br>");
}

// Build a plain bordered table for the given records. `columnKeys` selects
// and orders the columns (any subset of NEW_OPPS_EMAIL_COLUMNS); when
// omitted, all columns in default order are used. Black text on white with
// 1px solid black cell borders — no other styling.
export function buildNewOppsTableHtml(records, columnKeys) {
  const byKey = new Map(NEW_OPPS_EMAIL_COLUMNS.map((c) => [c.key, c]));
  const keys = Array.isArray(columnKeys) ? columnKeys : NEW_OPPS_EMAIL_COLUMN_KEYS;
  const columns = keys.map((k) => byKey.get(k)).filter(Boolean);

  if (!Array.isArray(records) || records.length === 0 || columns.length === 0) {
    return '<p style="font:13px Arial,sans-serif;color:#000;margin:0">Nothing to export — select at least one opp and one column.</p>';
  }

  const cellBorder = 'border:1px solid #000';
  const align = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = columns.map((c) =>
    `<th style="text-align:${align(c)};padding:6px 9px;font:bold 13px Arial,sans-serif;color:#000;${cellBorder}">${escapeHtml(c.label)}</th>`
  ).join('');

  // The row's BFO Address, but only when it actually looks like a web URL —
  // blanks and sentinel values ('-', '#N/A') never become hrefs.
  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const isBlankish = (v) => {
    const s = String(v ?? '').trim();
    return !s || s === '-' || s.toLowerCase() === '#n/a' || s.toLowerCase() === 'n/a';
  };
  // Links stay black (no color) so the table is strictly black-and-white;
  // they remain clickable when pasted into an email.
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#000">${escapeHtml(text)}</a>`;

  const rows = records.map((r) => {
    const cells = columns.map((c) => {
      const v = r[c.key] ?? '';
      const url = (c.key === 'BFO Link' || c.key === 'BFO Address') ? bfoUrl(r) : '';
      let inner;
      if (c.key === 'BFO Link' && url && !isBlankish(v)) {
        inner = link(url, v);
      } else if (c.key === 'BFO Address' && url) {
        // Show the words "BFO Link" as the anchor text, hyperlinked to the
        // BFO Address URL, rather than printing the raw URL.
        inner = link(url, 'BFO Link');
      } else if (c.key === 'Next Steps') {
        inner = escapeHtmlMultiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${align(c)};padding:6px 9px;font:13px Arial,sans-serif;color:#000;${cellBorder};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #000;font-family:Arial,sans-serif">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}
