// The PE Monthly email: the "PE overlap deals" off the Keith agenda (every
// PE or Portfolio Company opp at Stage 3 or later, utils/keithPeDeals.js)
// written up the way the New Opps digest is - same black-and-white bordered
// table, same greeting / intro / signature body, same Outlook draft (.eml)
// opened unsent so it can be read over and sent by hand. Only the columns
// and the default wording differ, so the two emails look like a set.
//
// The columns are the ones that answer "is another pod already in here":
// who owns the company, what vertical it is, who on Coverage sells that
// vertical, and where the deal stands.
//
// Pure apart from the download, so the rows and columns can be asserted
// without a browser: scripts/peMonthlyEmail.test.mjs.

import { buildDigestTableHtml, buildDigestEmailHtml, downloadEml } from './newOppsDigestEmail.js';

export const PE_MONTHLY_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Tier', label: 'Tier' },
  { key: 'CDM', label: 'CDM' },
  { key: 'PE Owner', label: 'PE Owner' },
  { key: 'Vertical', label: 'Vertical' },
  { key: 'Salesperson', label: 'Salesperson' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Deal Size', label: 'Deal Size', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Address', label: 'BFO Link' },
];

/**
 * One flat row per deal, keyed by PE_MONTHLY_COLUMNS, for the table on the
 * tab and the email alike.
 *
 *   deals           buildPeOverlapDeals output (already in agenda order)
 *   records         the opp rows, to fill Scope / Next Steps / BFO Address
 *   salespeopleFor  (vertical) => [{ name }] - Opps > Coverage's lookup
 */
export function peMonthlyRows(deals, records = [], salespeopleFor = () => []) {
  const byId = new Map((Array.isArray(records) ? records : []).map(r => [String(r?._id), r]));
  return (Array.isArray(deals) ? deals : []).map((d) => {
    const opp = byId.get(String(d.id)) || {};
    const people = d.vertical ? (salespeopleFor(d.vertical) || []) : [];
    return {
      id: d.id,
      Account: d.name,
      Tier: d.tier || '',
      CDM: d.targetCdm || '',
      'PE Owner': d.peOwner || '',
      Vertical: d.vertical || '',
      Salesperson: people.map(p => p?.name).filter(Boolean).join(', '),
      Stage: d.stageLabel || '',
      Scope: String(opp.Scope ?? '').trim(),
      'Deal Size': d.amountLabel || '',
      'Next Steps': String(opp['Next Steps'] ?? '').trim(),
      'BFO Address': String(opp['BFO Address'] ?? '').trim(),
    };
  });
}

// The wording a draft starts with until the user saves their own (Edit email
// text, stored in userSettings.peMonthlyDraftEmail).
export const PE_MONTHLY_DRAFT_DEFAULTS = {
  to: 'keith.mchugh@se.com',
  subject: 'Dan B PE Monthly - Overlap Deals',
  greeting: 'Hey Keith,',
  message: 'Here are the PE and portfolio company deals at Stage 3 or later this month, with who owns each company and who covers its vertical.',
};

export function resolvePeMonthlyDraftTemplate(saved) {
  const out = { ...PE_MONTHLY_DRAFT_DEFAULTS };
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(PE_MONTHLY_DRAFT_DEFAULTS)) {
      if (typeof saved[key] === 'string') out[key] = saved[key];
    }
  }
  return out;
}

export function buildPeMonthlyTableHtml(rows) {
  return buildDigestTableHtml(rows, PE_MONTHLY_COLUMNS, 'No PE or portfolio company deals at Stage 3 or later right now.');
}

export function buildPeMonthlyEmailHtml(rows, { message = '', greeting = '', signature = '' } = {}) {
  return buildDigestEmailHtml(buildPeMonthlyTableHtml(rows), { message, greeting, signature });
}

export function downloadPeMonthlyOutlookDraft(rows, {
  to = PE_MONTHLY_DRAFT_DEFAULTS.to,
  subject = PE_MONTHLY_DRAFT_DEFAULTS.subject,
  message = PE_MONTHLY_DRAFT_DEFAULTS.message,
  greeting = PE_MONTHLY_DRAFT_DEFAULTS.greeting,
  signature = '',
} = {}) {
  const html = buildPeMonthlyEmailHtml(rows, { message, greeting, signature });
  downloadEml({ to, subject, html, filePrefix: 'pe-monthly' });
  return Array.isArray(rows) ? rows.length : 0;
}
