// Client-side mirror of the New Opps digest email markup in
// api/_lib/newOpps.js (buildNewOppsTableHtml + the sendNewOppsEmail body
// wrapper). The Opps 2 "Email table" export — driven off the Mass Edit
// selection — produces the exact same SE-branded HTML table the scheduled
// New Opps email uses, so a pasted selection reads identically to the
// digest. Keep the columns + inline styles in sync with api/_lib/newOpps.js.

// Same column set + order the New Opps report/email uses. Account is always
// kept. `align: 'right'` mirrors the numeric columns.
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
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Sites', label: 'Sites', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Link', label: 'BFO Opportunity Name' },
  { key: 'BFO Address', label: 'BFO Address' },
];

export const NEW_OPPS_EMAIL_COLUMN_KEYS = NEW_OPPS_EMAIL_COLUMNS.map((c) => c.key);

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Steps inside a single Next Steps box are stored with U+2028 line
// separators (and steps with "\n"); render both as <br> so a multi-line
// note reads as stacked lines in the email rather than one run-on string.
function escapeHtmlMultiline(s) {
  return escapeHtml(s).replace(/\u2028|\r?\n/g, "<br>");
}

// Build the SE-branded HTML table for the given records. `columnKeys`
// selects + orders columns the same way the workbook/email does; Account
// is always kept. Mirrors buildNewOppsTableHtml in api/_lib/newOpps.js.
export function buildNewOppsTableHtml(records, columnKeys) {
  const keys = Array.isArray(columnKeys) && columnKeys.length ? columnKeys : NEW_OPPS_EMAIL_COLUMN_KEYS;
  const selected = new Set([...keys, 'Account']);
  const columns = NEW_OPPS_EMAIL_COLUMNS.filter((c) => selected.has(c.key));

  if (!Array.isArray(records) || records.length === 0) {
    return '<p style="color:#5A6B7E;font-size:13px;margin:0">No opportunities selected.</p>';
  }

  const thAlign = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = columns.map((c) =>
    `<th style="text-align:${thAlign(c)};padding:8px 10px;font:600 12px Arial,sans-serif;color:#009530;border-bottom:2px solid #009530;white-space:nowrap">${escapeHtml(c.label)}</th>`
  ).join('');

  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const isBlankish = (v) => {
    const s = String(v ?? '').trim();
    return !s || s === '-' || s.toLowerCase() === '#n/a' || s.toLowerCase() === 'n/a';
  };
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#009530;text-decoration:underline">${escapeHtml(text)}</a>`;

  const rows = records.map((r, idx) => {
    const bg = idx % 2 === 1 ? '#F6FCF8' : '#FFFFFF';
    const cells = columns.map((c) => {
      const v = r[c.key] ?? '';
      const url = (c.key === 'BFO Link' || c.key === 'BFO Address') ? bfoUrl(r) : '';
      let inner;
      if (c.key === 'BFO Link' && url && !isBlankish(v)) {
        inner = link(url, v);
      } else if (c.key === 'BFO Address' && url) {
        inner = link(url, url);
      } else if (c.key === 'Next Steps') {
        inner = escapeHtmlMultiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${thAlign(c)};padding:7px 10px;font:13px Arial,sans-serif;color:#334155;border-bottom:1px solid #E6F2EA;vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr style="background:${bg}">${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4px 0 8px">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Full email-body markup (heading + count line + table), mirroring the
// wrapper sendNewOppsEmail uses so the pasted block matches the digest.
export function buildNewOppsEmailHtml(records, { heading = 'Opportunities', intro = '', columnKeys } = {}) {
  const count = Array.isArray(records) ? records.length : 0;
  const introHtml = intro
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 16px">${escapeHtml(intro)}</p>`
    : '';
  const table = buildNewOppsTableHtml(records, columnKeys);
  return `
    <div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto">
      <h2 style="color:#009530;margin:0 0 8px">${escapeHtml(heading)}</h2>
      ${introHtml}
      <p style="color:#5A6B7E;font-size:13px;margin:0 0 12px">${count} opportunit${count === 1 ? 'y' : 'ies'}.</p>
      ${table}
    </div>
  `.trim();
}
