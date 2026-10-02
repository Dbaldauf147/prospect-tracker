// The SE "Margin Request Template" email Dan sends Keith for margin
// approval: who it goes to, and the green-bannered table in the body.
// Shared by the Fee Builder's Draft email (filled in from the option as
// built) and the Margin Approval template on Dan's Drafts (left blank to
// fill in by hand).
//
// Cell values are HTML: callers escape anything that came from a user.

export const KEITH = { name: 'Keith McHugh', email: 'keith.mchugh@se.com' };
export const GABE = { name: 'Gabe Smith', email: 'gabe.smith@se.com' };
// The HubSpot BCC drop-box address that logs the sent mail against the deal.
export const HUBSPOT_BCC = { name: 'HubSpot logging', email: '244957983@bcc.na2.hubspot.com' };

export const MARGIN_APPROVAL_RECIPIENTS = { to: [KEITH], cc: [GABE], bcc: [HUBSPOT_BCC] };

// Five option blocks, as the template has.
export const MARGIN_REQUEST_OPTION_SLOTS = 5;

const FONT = 'font-family:Calibri,sans-serif;font-size:10pt;';
const BORDER = 'border:1px solid #000000;';
const CELL = `${BORDER}padding:1px 5px;vertical-align:top;color:#000000;${FONT}`;
const LABEL = `${CELL}font-weight:bold;white-space:nowrap;`;
const BANNER = `${BORDER}padding:1px 5px;background:#00B050;color:#FFFFFF;font-weight:bold;${FONT}`;
const OPTION = `${BORDER}padding:1px 5px;background:#E7E6E6;${FONT}`;
// The grey italic prompts (Yes/No, Services, Fee Structure, ...).
const HINT = `${BORDER}padding:1px 5px;text-align:center;vertical-align:middle;color:#A5A5A5;font-style:italic;${FONT}`;

const W = [40, 175, 60, 305, 60, 40];
const v = (s) => (s === undefined || s === null || s === '' ? '&nbsp;' : s);

// One "Option N" block: the grey strip, then Services / Fee Structure /
// Margin and Term / Escalator, with Fee Structure spanning both rows.
function optionBlock(n, { services, feeStructure, margin, term, escalator } = {}) {
  return `
  <tr>
    <td width="${W[0]}" style="${OPTION}text-align:center;font-weight:bold;">Option<br>${n}</td>
    <td colspan="5" style="${OPTION}">&nbsp;</td>
  </tr>
  <tr>
    <td width="${W[0]}" style="${HINT}">Services</td>
    <td width="${W[1]}" style="${CELL}">${v(services)}</td>
    <td width="${W[2]}" rowspan="2" style="${HINT}">Fee Structure</td>
    <td width="${W[3]}" rowspan="2" style="${CELL}">${v(feeStructure)}</td>
    <td width="${W[4]}" style="${HINT}">Margin</td>
    <td width="${W[5]}" style="${CELL}">${v(margin)}</td>
  </tr>
  <tr>
    <td width="${W[0]}" style="${HINT}">Term</td>
    <td width="${W[1]}" style="${CELL}">${v(term)}</td>
    <td width="${W[4]}" style="${HINT}">Escalator</td>
    <td width="${W[5]}" style="${CELL}">${v(escalator)}</td>
  </tr>`;
}

// options: up to five { services, feeStructure, margin, term, escalator },
// index 0 is Option 1. Missing entries stay blank.
export function marginRequestTableHtml({ customerName = '', siaLink = '', rfp = '', dueDate = 'N/A', options = [] } = {}) {
  const blocks = Array.from({ length: MARGIN_REQUEST_OPTION_SLOTS }, (_, i) => optionBlock(i + 1, options[i] || {})).join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:680px;${FONT}">
  <tr><td colspan="6" style="${BANNER}">Margin Request Template</td></tr>
  <tr>
    <td colspan="2" style="${LABEL}">Customer Name</td>
    <td colspan="4" style="${CELL}">${v(customerName)}</td>
  </tr>
  <tr>
    <td colspan="2" style="${LABEL}">Sales Investment Analyzer (SIA) Link</td>
    <td colspan="4" style="${CELL}">${v(siaLink)}</td>
  </tr>
  <tr>
    <td colspan="2" style="${LABEL}">Is this an RFP?</td>
    <td width="${W[2]}" style="${HINT}">Yes/No</td>
    <td width="${W[3]}" style="${CELL}">${v(rfp)}</td>
    <td width="${W[4]}" style="${HINT}">Due Date</td>
    <td width="${W[5]}" style="${CELL}">${v(dueDate)}</td>
  </tr>
  <tr><td colspan="6" style="${BANNER}">SIA Options Seeking Approval</td></tr>${blocks}
</table>`;
}

// The body around the table, word for word from the template.
export function marginApprovalBodyHtml(table) {
  return [
    '<p>Hi Keith,</p>',
    '<p>&nbsp;</p>',
    '<p>Please let me know if you need any additional information on this opportunity.</p>',
    '<p>&nbsp;</p>',
    table,
    '<p>&nbsp;</p>',
    '<p>Thanks,</p>',
  ].join('\n');
}
