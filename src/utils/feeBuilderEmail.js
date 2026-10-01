// The Fee Builder's "Draft email": the option as built, written up as an
// Outlook draft (an X-Unsent .eml, see draftEmail.js) for the deal team.
// The services in it, the fee schedule, the term and the margin, so the
// pricing can be sent round without retyping it.
//
// Pure: takes the plan FeeBuilderTab already has and returns the subject
// and body HTML; feeBuilderEmailEml wraps them in the .eml.

import { escapeHtml, buildStyledBodyHtml } from './draftEmail.js';
import { fmtFeePerUnit } from './siaUsageCounts.js';

const money = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '-');
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

const TD = 'border:1px solid #cbd5e1;padding:4px 8px;font-size:10.5pt;';
const TH = `${TD}background:#f1f5f9;font-weight:bold;text-align:left;`;
const NUM = 'text-align:right;white-space:nowrap;';

export function buildFeeEmail(plan, { dealLabel = '', termMonths } = {}) {
  const f = feeEmailFigures(plan, { termMonths });
  const option = plan?.optionName || 'Option';
  const deal = String(dealLabel || '').trim();
  const subject = `Pricing: ${deal ? `${deal}, ` : ''}${option}`;
  const years = Array.from({ length: f.numYears }, (_, i) => i);

  const head = ['Fee', 'Service', 'Type', 'Fee / Unit', 'Unit', 'Units', 'Start Month', ...years.map(i => `Y${i + 1}`), 'Term', 'Margin'];
  const numCols = new Set([3, 5, 6, ...years.map(i => 7 + i), 7 + f.numYears, 8 + f.numYears]);
  const cell = (v, i, bold = false) => `<td style="${TD}${numCols.has(i) ? NUM : ''}${bold ? 'font-weight:bold;' : ''}">${escapeHtml(v)}</td>`;
  const rowHtml = f.rows.map(r => `<tr>${[
    r.name,
    r.service || '',
    r.type || '',
    fmtFeePerUnit(r.feePerUnit, r.unit),
    r.unit || '',
    r.unitCount == null || r.unitCount === '' ? '' : Number(r.unitCount).toLocaleString('en-US'),
    r.startMonth ?? '',
    ...years.map(i => (r.years?.[i] ? money(r.years[i]) : '')),
    r.term ? money(r.term) : '',
    r.passThrough ? 'Pass-through' : pct(r.margin),
  ].map((v, i) => cell(v, i)).join('')}</tr>`).join('\n');
  const totalHtml = `<tr>${[
    'Total', '', '', '', '', '', '',
    ...years.map(i => money(f.feeByYear[i])),
    money(f.termFees),
    pct(f.feeMargin),
  ].map((v, i) => cell(v, i, true)).join('')}</tr>`;
  const table = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Aptos,Calibri,Arial,sans-serif;">
<tr>${head.map((h, i) => `<th style="${TH}${numCols.has(i) ? NUM : ''}">${escapeHtml(h)}</th>`).join('')}</tr>
${rowHtml}
${totalHtml}
</table>`;

  const services = f.services.length
    ? `<ul>${f.services.map(s => `<li>${escapeHtml(s.name)}${s.structure ? ` <span style="color:#64748b;">(${escapeHtml(s.structure)})</span>` : ''}</li>`).join('')}</ul>`
    : '<p>No services picked yet.</p>';

  const summary = [
    ['Term', `${f.termMonths} months`],
    ['Term fees', money(f.termFees)],
    ['Term cost', money(f.termCost)],
    ['Deal margin', pct(f.dealMargin)],
    ['Fee margin (excl. pass-through)', pct(f.feeMargin)],
  ].map(([k, v]) => `<tr><td style="${TD}font-weight:bold;">${escapeHtml(k)}</td><td style="${TD}${NUM}">${escapeHtml(v)}</td></tr>`).join('');

  const html = [
    '<p>Hi team,</p>',
    '<p>&nbsp;</p>',
    `<p>Here is the pricing for ${escapeHtml(deal || 'this deal')} (${escapeHtml(option)}) over a ${f.termMonths}-month term.</p>`,
    '<p>&nbsp;</p>',
    '<p><b>Summary</b></p>',
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Aptos,Calibri,Arial,sans-serif;">${summary}</table>`,
    '<p>&nbsp;</p>',
    '<p><b>Services in scope</b></p>',
    services,
    '<p>&nbsp;</p>',
    '<p><b>Fees</b></p>',
    table,
    '<p>&nbsp;</p>',
    '<p>Let me know if you have any questions.</p>',
    '<p>&nbsp;</p>',
    '<p>Thanks,</p>',
  ].join('\n');
  return { subject, html, figures: f };
}

// The draft as an .eml Outlook opens unsent, with no recipient filled in.
export function feeBuilderEmailEml(plan, { dealLabel, termMonths, signature = '' } = {}) {
  const { subject, html } = buildFeeEmail(plan, { dealLabel, termMonths });
  return [
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    'X-Unsent: 1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    buildStyledBodyHtml(html, { signature }),
  ].join('\r\n');
}
