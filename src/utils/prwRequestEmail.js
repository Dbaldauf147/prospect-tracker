// The PRW ("Pricing Request Workbook") email Dan sends the SB Price and
// Tendering Support desk to ask for an SIA: the green-bannered Requested
// Data / CDM Answer table, laid out as the Outlook template has it. Drafted
// from the Scope board as an X-Unsent .eml (see draftEmail.js) so it opens
// in Outlook ready to finish and send.
//
// Only what the board knows is filled in (the customer and today's date);
// every other answer is left blank to complete by hand, as in the template.

import { escapeHtml, buildStyledBodyHtml } from './draftEmail.js';
import { KEITH, HUBSPOT_BCC } from './marginRequestEmail.js';

export const PRICE_TENDER = { name: 'SM SB Price and Tendering Support', email: 'SB.PriceTender@support.se.com' };
export const PRW_RECIPIENTS = { to: [PRICE_TENDER], cc: [KEITH], bcc: [HUBSPOT_BCC] };

export const S2C_TICKET_URL = 'https://servicedesk.ems.schneider-electric.com/projects/STC/queues/custom/4199';

export const PRW_OPTION_SLOTS = 5;

const FONT = 'font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt;';
const BORDER = 'border:1px solid #000000;';
const CELL = `${BORDER}padding:1px 6px;vertical-align:top;color:#000000;${FONT}`;
const LABEL = `${CELL}font-weight:bold;white-space:nowrap;`;
const INDENT = `${LABEL}padding-left:24px;`;
const BANNER = `${BORDER}padding:2px 6px;background:#00B050;color:#FFFFFF;font-weight:bold;${FONT}`;
const SECTION = `${BORDER}padding:1px 6px;background:#D9D9D9;color:#000000;font-weight:bold;${FONT}`;
const v = (s) => (s === undefined || s === null || s === '' ? '&nbsp;' : s);

// 10/5/2026, the way the subject line is usually dated by hand.
export function prwDate(d = new Date()) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function prwSubject(customerName = '', date = new Date()) {
  const name = String(customerName || '').trim() || '[Customer Name]';
  return `PRICING REQUEST WORKBOOK - ${name} - ${prwDate(date)}`;
}

// Cell values are HTML: callers escape anything a user typed.
export function prwTableHtml({ customerName = '', returnDate = '', rfp = '', currency = 'USD', pricingLink = '', options = [], paymentTerms = '', escalator = '', expiration = '' } = {}) {
  const row = (label, value, style = LABEL) => `
  <tr>
    <td width="54%" style="${style}">${label}</td>
    <td width="46%" style="${CELL}">${v(value)}</td>
  </tr>`;
  const section = (label) => `
  <tr><td colspan="2" style="${SECTION}">${label}</td></tr>`;
  const optionRows = Array.from({ length: PRW_OPTION_SLOTS }, (_, i) => row(`Option ${i + 1}`, options[i], INDENT)).join('');
  return `<table width="505" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:505px;${FONT}">
  <tr>
    <td width="54%" style="${BANNER}">Requested Data</td>
    <td width="46%" style="${BANNER}">CDM Answer</td>
  </tr>${row('Customer Name', customerName)}${row('Requested SIA Return Date', returnDate)}${row('Is this an RFP?', rfp)}${row('Currency', currency)}${row('Pricing Request Link', pricingLink)}${section('SIA Requested Breakout')}${optionRows}${section('If Client is Existing Customer')}${row('Current Payment Terms', paymentTerms, INDENT)}${row('Current Escalator %', escalator, INDENT)}${row('Expiration Term of Current Contract', expiration, INDENT)}
</table>`;
}

// The body around the table, word for word from the template.
export function prwBodyHtml(table) {
  return [
    `<p>If EU sites are in scope, complete the S2C ticket here for those:&nbsp; <a href="${S2C_TICKET_URL}">${S2C_TICKET_URL}</a></p>`,
    '<p>&nbsp;</p>',
    '<p>CC the CM.</p>',
    '<p>&nbsp;</p>',
    '<p>Team,</p>',
    '<p>&nbsp;</p>',
    '<p>Please see the pricing request information below for your review.&nbsp; Let me know if you need anything else from me on this opportunity.</p>',
    '<p>&nbsp;</p>',
    table,
    '<p>&nbsp;</p>',
    '<p>Thank you very much!</p>',
  ].join('\n');
}

export function buildPrwEmail({ customerName = '', date = new Date() } = {}) {
  const name = String(customerName || '').trim();
  const table = prwTableHtml({ customerName: escapeHtml(name) });
  return { subject: prwSubject(name, date), html: prwBodyHtml(table) };
}

const header = (label, list) => (list.length
  ? `${label}: ${list.map(r => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(', ')}`
  : null);

// The draft as an .eml Outlook opens unsent: To the Price and Tendering
// desk, Cc Keith, Bcc the HubSpot logging address, as the template is
// addressed.
export function prwEmailEml({ customerName, date, signature = '' } = {}) {
  const { subject, html } = buildPrwEmail({ customerName, date });
  const { to, cc, bcc } = PRW_RECIPIENTS;
  return [
    'MIME-Version: 1.0',
    `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
    header('To', to),
    header('Cc', cc),
    header('Bcc', bcc),
    'X-Unsent: 1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    buildStyledBodyHtml(html, { signature }),
  ].filter(line => line !== null).join('\r\n');
}
