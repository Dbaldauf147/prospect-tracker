// The Fee Builder's "Draft email": the Margin Approval email Dan sends
// Keith (MARGIN APPROVAL: Client Name Scope, the Margin Request Template
// table), as an Outlook draft (an X-Unsent .eml, see draftEmail.js), with
// the option as built filled into its Option block: services, fee
// structure, margin, term and escalator.
//
// Pure: takes the plan FeeBuilderTab already has and returns the subject
// and body HTML; feeBuilderEmailEml wraps them in the .eml.

import { escapeHtml, buildStyledBodyHtml } from './draftEmail.js';
import { fmtFeePerUnit } from './siaUsageCounts.js';
import { MARGIN_APPROVAL_RECIPIENTS, MARGIN_REQUEST_OPTION_SLOTS, marginRequestTableHtml, marginApprovalBodyHtml } from './marginRequestEmail.js';

const sum = (arr) => (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);

// The figures the email states, worked out once so the subject, body and
// tests read the same numbers.
export function feeEmailFigures(plan, { termMonths } = {}) {
  const rows = (plan?.rows || []).filter(r => String(r?.name || '').trim());
  const numYears = plan?.numYears || 1;
  const termFees = sum(plan?.after?.feeByYear);
  const termCost = sum(plan?.after?.costByYear);
  const dealMargin = plan?.after?.margin?.finalMargin;
  // The fee margin: fees against the cost lines they price, pass-through
  // fees left out (the Total row's Margin on the Fee Builder).
  const kept = rows.filter(r => !r.passThrough);
  const keptTerm = sum(kept.map(r => r.term));
  const feeMargin = keptTerm > 0 ? (keptTerm - sum(kept.map(r => r.cost))) / keptTerm : null;
  // A service once, in the order its fees were built.
  const services = [];
  for (const ps of plan?.perService || []) {
    if (ps?.service && !services.some(s => s.name === ps.service)) {
      services.push({ name: ps.service, structure: ps.structureName || '' });
    }
  }
  return {
    rows,
    numYears,
    termMonths: typeof termMonths === 'number' && termMonths > 0 ? termMonths : numYears * 12,
    feeByYear: Array.from({ length: numYears }, (_, i) => Number(plan?.after?.feeByYear?.[i]) || 0),
    termFees,
    termCost,
    dealMargin: typeof dealMargin === 'number' ? dealMargin : null,
    feeMargin,
    services,
  };
}

const wholePct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '');

// "Recurring 3 year term", the way the template words it.
function termText(rows, termMonths) {
  const span = termMonths % 12 === 0 ? `${termMonths / 12} year` : `${termMonths} month`;
  const recurring = rows.some(r => /^recurring/i.test(String(r.type || '')));
  return `${recurring ? 'Recurring ' : ''}${span} term`;
}

// A fee line as "Name: $0.00152 Per kWh (Recurring (monthly))".
function feeLine(r) {
  const fee = fmtFeePerUnit(r.feePerUnit, r.unit);
  const unit = String(r.unit || '').trim();
  const main = [r.name, fee ? `${fee}${unit ? ` ${unit}` : ''}` : ''].filter(Boolean).join(': ');
  const tags = [r.type, r.passThrough ? 'pass-through' : ''].filter(Boolean).join(', ');
  return tags ? `${main} (${tags})` : main;
}

// The Option block the plan fills, filled in.
export function feeEmailOption(plan, { termMonths, annualEscalator } = {}) {
  const f = feeEmailFigures(plan, { termMonths });
  const esc = typeof annualEscalator === 'number' && annualEscalator > 0 ? wholePct(annualEscalator) : 'N/A';
  return {
    services: f.services.map(s => s.name),
    feeLines: f.rows.map(feeLine),
    margin: wholePct(f.dealMargin ?? f.feeMargin),
    term: termText(f.rows, f.termMonths),
    escalator: esc,
  };
}

// optionSlot: which of the template's five Option blocks this option
// fills (1-based, its place among the workbook's options).
export function buildFeeEmail(plan, { dealLabel = '', termMonths, annualEscalator, optionSlot = 1 } = {}) {
  const f = feeEmailFigures(plan, { termMonths });
  const o = feeEmailOption(plan, { termMonths, annualEscalator });
  const deal = String(dealLabel || '').trim();
  const scope = o.services.join(', ');
  const subject = `MARGIN APPROVAL: ${deal || 'Client Name'} ${scope || 'Scope'}`;
  const slot = Number.isInteger(optionSlot) && optionSlot >= 1 && optionSlot <= MARGIN_REQUEST_OPTION_SLOTS ? optionSlot : 1;
  const options = [];
  options[slot - 1] = {
    services: o.services.map(escapeHtml).join('<br>'),
    feeStructure: o.feeLines.map(escapeHtml).join('<br>'),
    margin: escapeHtml(o.margin),
    term: escapeHtml(o.term),
    escalator: escapeHtml(o.escalator),
  };
  const table = marginRequestTableHtml({ customerName: escapeHtml(deal), options });
  return { subject, html: marginApprovalBodyHtml(table), figures: f };
}

const header = (name, list) => (list.length
  ? `${name}: ${list.map(r => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ')}`
  : null);

// The draft as an .eml Outlook opens unsent: To Keith, Cc Gabe, Bcc the
// HubSpot logging address, as the template is addressed.
export function feeBuilderEmailEml(plan, { dealLabel, termMonths, annualEscalator, optionSlot, signature = '' } = {}) {
  const { subject, html } = buildFeeEmail(plan, { dealLabel, termMonths, annualEscalator, optionSlot });
  const { to, cc, bcc } = MARGIN_APPROVAL_RECIPIENTS;
  return [
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
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
