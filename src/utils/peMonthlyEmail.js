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
import { buildPeOverlapDeals } from './keithPeDeals.js';
import { buildTargetTierResolver, buildTargetCdmResolver } from './targetTier.js';
import { coverageFromSettings, salespeopleForVertical } from './salesCoverage.js';
import { parseMoney } from './oppsMetrics.js';
import { fmtMoneyWhole } from './pricingOptionCalc.js';

export const PE_MONTHLY_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Tier', label: 'Tier' },
  { key: 'CDM', label: 'CDM' },
  { key: 'PE Owner', label: 'PE Owner' },
  { key: 'Vertical', label: 'Vertical' },
  // Labelled Other CDM: on this table the person Coverage names is the
  // other pod's CDM. The key stays Salesperson so saved rows still read.
  { key: 'Salesperson', label: 'Other CDM' },
  // Yes / No off the company popup's "aligned w/other CDM" checkbox; N/A
  // when the account is not on the tier list (peMonthlyCdmsAligned).
  { key: 'CDMs Aligned', label: 'CDMs aligned' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Deal Size', label: 'Deal Size', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Address', label: 'BFO Link' },
];

// The email leaves three of the tab's columns out: CDM, Scope and Next
// Steps. The user asked for a leaner email; the tab keeps all three.
const PE_MONTHLY_EMAIL_HIDDEN = new Set(['CDM', 'Scope', 'Next Steps']);
export const PE_MONTHLY_EMAIL_COLUMNS = PE_MONTHLY_COLUMNS.filter(c => !PE_MONTHLY_EMAIL_HIDDEN.has(c.key));

/**
 * The CDMs aligned cell: 'N/A' for an account not on the tier list (blank,
 * "-" or "Not on tier list", the ones that sort last), else 'Yes' when the
 * company popup's "aligned w/other CDM" box is ticked and 'No' when not.
 */
export function peMonthlyCdmsAligned(tier, aligned) {
  if (!Number.isFinite(peMonthlyTierRank(tier))) return 'N/A';
  return aligned === true ? 'Yes' : 'No';
}

// Where a tier sorts: Tier 1 first, then Tier 2, Tier 3 and any higher
// number, then everything not on the tier list (blank, "-", "Not on tier
// list") last.
export function peMonthlyTierRank(tier) {
  const m = String(tier || '').trim().match(/^(?:tier\s*)?(\d+)$/i);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * One flat row per deal, keyed by PE_MONTHLY_COLUMNS, for the table on the
 * tab and the email alike.
 *
 *   deals           buildPeOverlapDeals output (agenda order; re-sorted by tier)
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
      // Not a column: the company the CDM was read from, for the tab's links.
      companyId: d.companyId ?? null,
      Account: d.name,
      Tier: d.tier || '',
      CDM: d.targetCdm || '',
      'PE Owner': d.peOwner || '',
      Vertical: d.vertical || '',
      Salesperson: people.map(p => p?.name).filter(Boolean).join(', '),
      'CDMs Aligned': peMonthlyCdmsAligned(d.tier, d.cdmAligned),
      Stage: d.stageLabel || '',
      Scope: String(opp.Scope ?? '').trim(),
      'Deal Size': d.amountLabel || '',
      'Next Steps': String(opp['Next Steps'] ?? '').trim(),
      'BFO Address': String(opp['BFO Address'] ?? '').trim(),
    };
  })
    // Tier 1 at the top, not on the tier list at the bottom. The sort is
    // stable, so deals within a tier keep the agenda's order.
    .map((row, i) => ({ row, i, rank: peMonthlyTierRank(row.Tier) }))
    .sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank < b.rank ? -1 : 1))
    .map(x => x.row);
}

/**
 * The whole list from the raw inputs, built the way the Opps page builds it
 * (buildPeOverlapDeals with the Target Accounts tier / CDM resolvers, then
 * peMonthlyRows with Opps > Coverage). The scheduled email runs on the
 * server with no page open, so it calls this with what it reads from
 * Firestore and gets the same rows the tab shows.
 */
export function buildPeMonthlyRows({ records = [], prospects = [], settings = null, targetAccountsData = null, cdmName = '' } = {}) {
  const targetTierFor = targetAccountsData
    ? buildTargetTierResolver({ targetAccountsData, cdmName, settings, includeAllReps: true })
    : null;
  const targetCdmFor = targetAccountsData
    ? buildTargetCdmResolver({ targetAccountsData, settings })
    : null;
  const deals = buildPeOverlapDeals(records, {
    parseAmount: parseMoney, fmtAmount: fmtMoneyWhole, prospects, targetTierFor, targetCdmFor,
  });
  const coverage = coverageFromSettings(settings);
  return peMonthlyRows(deals, records, v => salespeopleForVertical(coverage, v));
}

/**
 * Rows the page posts for "Send now", cut down to the email's columns as
 * plain strings - the server sends exactly what is on screen, and nothing
 * else rides along.
 */
export function sanitizePeMonthlyRows(rows, max = 1000) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && typeof r === 'object')
    .slice(0, max)
    .map((r) => {
      const out = {};
      for (const c of PE_MONTHLY_EMAIL_COLUMNS) out[c.key] = String(r[c.key] ?? '').slice(0, 5000);
      return out;
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
  return buildDigestTableHtml(rows, PE_MONTHLY_EMAIL_COLUMNS, 'No PE or portfolio company deals at Stage 3 or later right now.');
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
