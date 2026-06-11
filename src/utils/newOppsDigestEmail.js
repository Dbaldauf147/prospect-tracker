// Build a downloadable Outlook draft (.eml) of the New Opps digest email.
//
// This mirrors the *scheduled* New Opps email exactly — the fixed
// 8-column black-and-white table from api/_lib/newOpps.js
// (NEW_OPPS_EMAIL_COLUMNS + buildNewOppsTableHtml + the sendNewOppsEmail
// body wrapper) — so a downloaded draft reads identically to what the
// cron would send, just authored in the user's own Outlook instead of
// going out from the Gmail account. Keep this in lock-step with
// api/_lib/newOpps.js.
//
// The .eml carries an `X-Unsent: 1` header, which Outlook (desktop)
// honors by opening the file as an editable, unsent draft rather than a
// received message — so the user can review, tweak, and send it themselves.

// Fixed digest columns, in order. Mirrors NEW_OPPS_EMAIL_COLUMNS in
// api/_lib/newOpps.js. The "BFO Address" column renders the literal text
// "BFO Link" hyperlinked to the row's BFO Address.
const DIGEST_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Start Date', label: 'Start Date', value: (r) => formatShortDate(r['Start Date']) },
  { key: 'Quoted Amount', label: 'Quoted Amount', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Address', label: 'BFO Link' },
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Steps inside a single Next Steps box are stored with U+2028 separators
// (and "\n"); render both as <br> so the note stacks instead of running on.
function escapeHtmlMultiline(s) {
  return escapeHtml(s).replace(/\u2028|\r?\n/g, '<br>');
}

// Short date (M/D/YYYY), falling back to the raw value when unparseable.
function formatShortDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// The SE-free, black-and-white bordered digest table. Mirrors
// buildNewOppsTableHtml in api/_lib/newOpps.js.
export function buildNewOppsDigestTableHtml(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return '<p style="color:#000000;font-size:13px;margin:0">No new opportunities to report.</p>';
  }

  const BORDER = '1px solid #000000';
  const thAlign = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = DIGEST_COLUMNS.map((c) =>
    `<th style="text-align:${thAlign(c)};padding:6px 10px;font:700 13px Arial,sans-serif;color:#000000;border:${BORDER};white-space:nowrap">${escapeHtml(c.label)}</th>`
  ).join('');

  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#000000;text-decoration:underline">${escapeHtml(text)}</a>`;

  const rows = records.map((r) => {
    const cells = DIGEST_COLUMNS.map((c) => {
      const v = cellValue(r, c);
      let inner;
      if (c.key === 'BFO Address') {
        const url = bfoUrl(r);
        inner = url ? link(url, 'BFO Link') : '';
      } else if (c.key === 'Next Steps') {
        inner = escapeHtmlMultiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${thAlign(c)};padding:6px 10px;font:13px Arial,sans-serif;color:#000000;border:${BORDER};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4px 0 8px;border:${BORDER}">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Full email body (optional intro + table), matching sendNewOppsEmail.
export function buildNewOppsDigestEmailHtml(records, { message = '' } = {}) {
  const intro = message
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 16px">${escapeHtml(message)}</p>`
    : '';
  const table = buildNewOppsDigestTableHtml(records);
  return `<div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto">${intro}${table}</div>`;
}

// Base64 of a UTF-8 string, wrapped at 76 chars per MIME conventions.
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/.{76}/g, '$&\r\n');
}

// Assemble a minimal RFC 822 message whose body is the HTML email. The
// `X-Unsent: 1` header tells Outlook to open it as an editable draft.
export function buildNewOppsEml({ to = '', subject = 'New Opportunities', html = '' } = {}) {
  const headers = [
    'X-Unsent: 1',
    to ? `To: ${to}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${base64Utf8(html)}\r\n`;
}

// Build + download an Outlook draft (.eml) of the New Opps digest for the
// given records. Returns the number of opps included.
export function downloadNewOppsOutlookDraft(records, { to = '', subject = 'New Opportunities', message = '' } = {}) {
  const html = buildNewOppsDigestEmailHtml(records, { message });
  const eml = buildNewOppsEml({ to, subject, html });
  const blob = new Blob([eml], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `new-opps-${new Date().toISOString().slice(0, 10)}.eml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return Array.isArray(records) ? records.length : 0;
}
