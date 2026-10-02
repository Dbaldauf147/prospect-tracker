// The Fee Builder's "Draft email": the Margin Approval email Dan sends
// Keith (MARGIN APPROVAL: Client Name Scope, the Margin Request Template
// table), as an Outlook draft (an X-Unsent .eml, see draftEmail.js), with
// the option as built filled into its Option block (services, fee
// structure, margin, term and escalator) and the workbook's other options
// into theirs.
//
// Pure: takes the plan FeeBuilderTab already has and returns the subject
// and body HTML; feeBuilderEmailEml wraps them in the .eml.

import { escapeHtml, buildStyledBodyHtml } from './draftEmail.js';
import { fmtFeePerUnit } from './siaUsageCounts.js';
import { condenseFeeRows } from './feeSummarySheets.js';
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

// A summary line: "Per account monthly: $3.00 Per Account", with
// " (pass-through)" on a fee billed at cost.
function feeLine(r) {
  const fee = fmtFeePerUnit(r.feePerUnit, r.unit);
  const unit = String(r.unit || '').trim();
  const main = [r.name, fee ? `${fee}${unit ? ` ${unit}` : ''}` : ''].filter(Boolean).join(': ');
  return r.passThrough ? `${main} (pass-through)` : main;
}

// One Option block's figures from an option's services, fee rows and
// margin. The fee structure is the Fee Summary (like fee lines combined,
// see condenseFeeRows), not every row.
// The DATA bucket is named by its primary service instead: how the bills
// come in. The first of these the option has, in this order.
const DATA_BUCKET = 'data';
const PRIMARY_DATA_SERVICES = [
  /^bill payment$/i,
  /^ap upload\b/i,
  /^invoice collection\b/i,
  /^client sends invoices$/i,
];

// bucketOf(name) names the service bucket a service is filed under (the
// Scope picker's boxes), '' for none: services are summarized as their
// buckets, a service no bucket claims as itself, and DATA as its primary
// service (DATA itself when the option has none of them).
export function summarizeServices(services = [], bucketOf = null) {
  const names = [...new Set((services || []).map(sv => String(sv || '').trim()).filter(Boolean))];
  const bucket = (sv) => String((bucketOf && bucketOf(sv)) || '').trim();
  let primary = null;
  for (const re of PRIMARY_DATA_SERVICES) {
    primary = names.find(sv => re.test(sv));
    if (primary) break;
  }
  const out = names.map(sv => {
    const b = bucket(sv);
    if (b.toLowerCase() === DATA_BUCKET || (primary && sv === primary)) return primary || b;
    return b || sv;
  });
  return [...new Set(out)];
}

export function marginOptionFigures({ services = [], rows = [], margin = null, termMonths = 12, annualEscalator, bucketOf = null } = {}) {
  const named = (rows || []).filter(r => String(r?.name || '').trim());
  return {
    services: summarizeServices(services, bucketOf),
    feeLines: condenseFeeRows(named).map(feeLine),
    margin: wholePct(margin),
    term: termText(named, termMonths),
    escalator: typeof annualEscalator === 'number' && annualEscalator > 0 ? wholePct(annualEscalator) : 'N/A',
  };
}

// The Option block the plan fills, filled in.
export function feeEmailOption(plan, { termMonths, annualEscalator, bucketOf } = {}) {
  const f = feeEmailFigures(plan, { termMonths });
  return marginOptionFigures({
    bucketOf,
    services: f.services.map(sv => sv.name),
    rows: f.rows,
    margin: f.dealMargin ?? f.feeMargin,
    termMonths: f.termMonths,
    annualEscalator,
  });
}

const validSlot = (n) => Number.isInteger(n) && n >= 1 && n <= MARGIN_REQUEST_OPTION_SLOTS;

// optionSlot: which of the template's five Option blocks the plan fills
// (1-based, its place among the workbook's options). otherOptions fills
// the rest: [{ slot, services, rows, margin }], rows as the plan's
// ({ name, type, feePerUnit, unit, unitCount, startMonth, passThrough }).
export function buildFeeEmail(plan, { dealLabel = '', termMonths, annualEscalator, optionSlot = 1, otherOptions = [], bucketOf = null } = {}) {
  const f = feeEmailFigures(plan, { termMonths });
  const deal = String(dealLabel || '').trim();
  const slot = validSlot(optionSlot) ? optionSlot : 1;
  const filled = [];
  for (const other of otherOptions || []) {
    if (!validSlot(other?.slot) || other.slot === slot) continue;
    filled[other.slot - 1] = marginOptionFigures({ ...other, termMonths: f.termMonths, annualEscalator, bucketOf });
  }
  filled[slot - 1] = feeEmailOption(plan, { termMonths, annualEscalator, bucketOf });
  // The scope is left as "(Scope)" to word by hand.
  const subject = `MARGIN APPROVAL: ${deal || 'Client Name'} (Scope)`;
  const options = filled.map(o => (o ? {
    services: escapeHtml(o.services.join(', ')),
    feeStructure: o.feeLines.map(escapeHtml).join('<br>'),
    margin: escapeHtml(o.margin),
    term: escapeHtml(o.term),
    escalator: escapeHtml(o.escalator),
  } : undefined));
  const table = marginRequestTableHtml({ customerName: escapeHtml(deal), options });
  return { subject, html: marginApprovalBodyHtml(table), figures: f };
}

const header = (name, list) => (list.length
  ? `${name}: ${list.map(r => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ')}`
  : null);

// The draft as an .eml Outlook opens unsent: To Keith, Cc Gabe, Bcc the
// HubSpot logging address, as the template is addressed.
export function feeBuilderEmailEml(plan, { dealLabel, termMonths, annualEscalator, optionSlot, otherOptions, bucketOf, signature = '' } = {}) {
  const { subject, html } = buildFeeEmail(plan, { dealLabel, termMonths, annualEscalator, optionSlot, otherOptions, bucketOf });
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
