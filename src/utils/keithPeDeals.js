// The deals behind the "PE overlap deals" line on the Keith agenda: every
// Private Equity or Portfolio Company opp that has reached Stage 3 (Lead) or
// later and is still open.
//
// "PE or Portfolio Company" is read off the opp first: its Type, or a PE
// Owner filled in (which is only ever set on a portfolio company's deal).
// Failing those, the matched company's Type / PE Owner, or a "(a SVP co.)"
// note in the account name, count too (isPeOpp).
// Sold and Not Sold are past the numbered stages, so they drop out; so do
// Not Started and anything that never reached Lead.
//
// Each deal also says who owns it and what vertical it is in, since those
// are what decide whether another pod is already in the door:
//
//   PE Owner  the opp's own PE Owner, else the matched company's PE Owner,
//             else the PE firm whose portfolio list names it, else the
//             "(a SVP co.)" in the account name. An opp at a PE firm itself
//             is its own owner.
//   Vertical  the opp's Vertical, else the Vertical set on the matched
//             company's popup, else the Sector on the owning firm's
//             portfolio list. `verticalFrom` says which ('opp' | 'company' |
//             'portfolio' | ''), and `verticalFromOpp` is kept for the save
//             check, so the page can show a borrowed sector as a suggestion
//             rather than a fact. The company popup's Vertical used to be
//             skipped, so setting one there never reached this list.
//
//   Tier      the account's tier, read the way My Accounts reads it: the
//             matched company's own Tier, with the Target Accounts list
//             winning over a tier an import wrote (see tierSource.js). An
//             account with no company record can still be tiered by the
//             Targets list. The caller passes that list's resolver as
//             `targetTierFor`; without one, the company's Tier alone.
//   CDM       who the Target Accounts list names as the account's CDM
//             (`targetCdmFor`, targetTier.js's CDM resolver), or ''.
//
// Pure, so the rule can be asserted without a browser:
// scripts/keithPeDeals.test.mjs.

import { STAGE_BANDS } from './stageBands.js';
import { splitPeOwners, joinPeOwners } from './peOwners.js';
import { companiesMatch } from './listFlags.js';
import { tierPreferringTargetsList } from './tierSource.js';

const PE_TYPES = new Set(['private equity', 'portfolio company']);

// Stage name → { number, label } for Stage 3 and up, e.g. 'Quoted' → 5.
const STAGE_NUMBER = new Map(
  STAGE_BANDS
    .filter(b => /^Stage \d+$/.test(b.label))
    .flatMap(b => b.stages.map(s => [s, Number(b.label.slice(6))])),
);

// Whether an opp is a PE or portfolio company deal. The opp's own Type or
// PE Owner decide first; failing those, the company behind it can (its
// popup's Type or PE Owner, when `prospects` is passed), and so can a
// "(a Platinum Equity Co.)" note in the account name. Before the company
// and the name counted, "Rehlko (a Platinum Equity Co.)" never reached
// PE Monthly unless its opp was tagged by hand, though the PE Owner column
// already read Platinum Equity off that same name.
export function isPeOpp(row, prospects = []) {
  const type = String(row?.['Type'] || '').trim().toLowerCase();
  if (PE_TYPES.has(type)) return true;
  if (splitPeOwners(row?.['PE Owner']).length > 0) return true;
  const account = text(row?.['Account']);
  if (ownerFromAccountName(account)) return true;
  const company = findCompany(account, Array.isArray(prospects) ? prospects : []);
  if (!company) return false;
  return PE_TYPES.has(text(company.type).toLowerCase()) || splitPeOwners(company.peOwner).length > 0;
}

// Whether the firm(s) owning an opp's company are all known NOT to be PE: each
// owner named in the PE Owner column matches a company in the app whose Type
// is set to something other than Private Equity or Portfolio Company (e.g.
// Brookfield Asset Management, an Asset Management Firm, owning "Brookfield
// (NAM Multifamily)"). Such a deal isn't a PE deal however its Type reads.
// An owner with no company record, or one whose Type is blank, is given the
// benefit of the doubt; so is an opp at a PE firm itself.
export function ownedByNonPeFirm(row, prospects = []) {
  const list = Array.isArray(prospects) ? prospects : [];
  const account = text(row?.['Account']);
  const company = findCompany(account, list);
  if (text(row?.['Type']).toLowerCase() === 'private equity' || text(company?.type).toLowerCase() === 'private equity') return false;
  const owners = splitPeOwners(peOwnerAndVertical(row, list).peOwner);
  if (owners.length === 0) return false;
  return owners.every(owner => {
    const firm = findCompany(text(owner), list);
    const type = text(firm?.type).toLowerCase();
    return !!firm && firm !== company && type !== '' && !PE_TYPES.has(type);
  });
}

// The numbered stage (3-6) an opp is at, or null before Stage 3 / once closed.
export function oppStageNumber(row) {
  return STAGE_NUMBER.get(String(row?.['Stage'] || '').trim()) ?? null;
}

const text = (v) => String(v ?? '').trim();

// The Table View company an opp's Account names: exact first, so a longer
// exact name is never beaten by a fuzzy shorter neighbour.
function findCompany(account, prospects) {
  const key = account.toLowerCase();
  if (!key) return null;
  return prospects.find(p => text(p?.company).toLowerCase() === key)
    || prospects.find(p => companiesMatch(p?.company, account))
    || null;
}

// PE firms whose own portfolio list names this account, with the row.
function portfolioEntries(account, prospects) {
  const out = [];
  if (!account) return out;
  for (const firm of prospects) {
    const list = Array.isArray(firm?.portfolioCompanies) ? firm.portfolioCompanies : null;
    if (!list) continue;
    const row = list.find(r => companiesMatch(r?.companyName, account));
    if (row) out.push({ firm: text(firm.company), row });
  }
  return out;
}

// "Oxea (a SVP co.)", "Solenis (a Platinum Equity Co.)" → the firm named.
export function ownerFromAccountName(account) {
  const m = /\(\s*an?\s+(.+?)\s+(co|company|portfolio\s+co(mpany)?)\.?\s*\)/i.exec(text(account));
  return m ? m[1].trim() : '';
}

/**
 * Who owns the company behind an opp, and its vertical.
 *
 *   { peOwner, vertical, verticalFrom, verticalFromOpp }
 */
export function peOwnerAndVertical(row, prospects = []) {
  const list = Array.isArray(prospects) ? prospects : [];
  const account = text(row?.['Account']);
  const company = findCompany(account, list);
  const entries = portfolioEntries(account, list);
  const isFirm = text(row?.['Type']).toLowerCase() === 'private equity'
    || text(company?.type).toLowerCase() === 'private equity';

  const peOwner = joinPeOwners(splitPeOwners(row?.['PE Owner']))
    || joinPeOwners(splitPeOwners(company?.peOwner))
    || entries.map(e => e.firm).filter(Boolean).join(', ')
    || ownerFromAccountName(account)
    || (isFirm ? account : '');

  const own = text(row?.['Vertical']);
  const onCompany = text(company?.vertical);
  const sector = entries.map(e => text(e.row?.sector)).find(Boolean) || '';
  const verticalFrom = own ? 'opp' : onCompany ? 'company' : sector ? 'portfolio' : '';
  return { peOwner, vertical: own || onCompany || sector, verticalFrom, verticalFromOpp: !!own };
}

/**
 * The tier of the account behind an opp, 'Tier N' or ''.
 *
 *   targetTierFor  (prospect-like { id?, company }) => { tier } from the
 *                  Target Accounts list (targetTier.js's resolver), or null.
 */
export function accountTier(row, prospects = [], targetTierFor = null) {
  const list = Array.isArray(prospects) ? prospects : [];
  const account = text(row?.['Account']);
  const company = findCompany(account, list);
  const own = text(company?.tier);
  const tier = own && own !== '-' ? own : '';
  const targetTier = typeof targetTierFor === 'function'
    ? text(targetTierFor(company || { company: account })?.tier)
    : '';
  return tierPreferringTargetsList({ tier, targetTier, tierSource: company?.tierSource }) || targetTier || '';
}

// Where a tier sorts: Tier 1 first, then Tier 2, Tier 3 and any higher
// number, then everything not on the tier list (blank, "-", "Not on tier
// list") last.
export function tierRank(tier) {
  const m = String(tier || '').trim().match(/^(?:tier\s*)?(\d+)$/i);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * The CDMs aligned cell: 'N/A' for an account not on the tier list (blank,
 * "-" or "Not on tier list", the ones that sort last) or when you are the
 * Vertical CDM (nobody else to align with), else 'Yes' when the company
 * popup's "aligned w/other CDM" box is ticked and 'No' when not.
 */
export function cdmsAlignedLabel(tier, aligned, { ownVertical = false } = {}) {
  if (!Number.isFinite(tierRank(tier))) return 'N/A';
  if (ownVertical) return 'N/A';
  return aligned === true ? 'Yes' : 'No';
}

/** Whether the company popup's "aligned w/other CDM" box is ticked for the account behind an opp. */
export function accountCdmAligned(row, prospects = []) {
  const company = findCompany(text(row?.['Account']), Array.isArray(prospects) ? prospects : []);
  return company?.cdmAligned === true;
}

/** The CDM the Target Accounts list names for the account behind an opp, or ''. */
export function accountTargetCdm(row, prospects = [], targetCdmFor = null) {
  if (typeof targetCdmFor !== 'function') return '';
  const account = text(row?.['Account']);
  const company = findCompany(account, Array.isArray(prospects) ? prospects : []);
  return text(targetCdmFor(company || { company: account }));
}

/**
 * PE / Portfolio Company opps at Stage 3+, less those owned by a firm the app
 * types as something other than PE (ownedByNonPeFirm), furthest along first, then
 * biggest, then by account so the order is stable.
 *
 *   parseAmount  (raw) => number | null
 *   fmtAmount    (number) => string
 *
 *   [{ id, name, companyId, amount, amountLabel, stage, stageLabel, peOwner, vertical, verticalFromOpp, tier, targetCdm, cdmAligned }]
 *
 * `companyId` is the Table View company the Tier and CDM were read from
 * (null when the account has none), so a page can open THAT company to map
 * it to its Targets list row - another name matcher could pick a different
 * record and the mapping would never reach this row.
 */
export function buildPeOverlapDeals(records, { parseAmount = () => null, fmtAmount = String, prospects = [], targetTierFor = null, targetCdmFor = null } = {}) {
  return (Array.isArray(records) ? records : [])
    .filter(row => oppStageNumber(row) != null && isPeOpp(row, prospects) && !ownedByNonPeFirm(row, prospects))
    .map(row => {
      const stage = oppStageNumber(row);
      const amount = parseAmount(row?.['Quoted Amount']);
      const company = findCompany(text(row?.['Account']), Array.isArray(prospects) ? prospects : []);
      return {
        id: String(row._id),
        name: String(row?.['Account'] || '').trim() || '(no account)',
        companyId: company?.id ?? null,
        amount,
        amountLabel: amount == null ? '' : fmtAmount(amount),
        stage,
        stageLabel: `Stage ${stage} · ${String(row.Stage).trim()}`,
        ...peOwnerAndVertical(row, prospects),
        tier: accountTier(row, prospects, targetTierFor),
        targetCdm: accountTargetCdm(row, prospects, targetCdmFor),
        // The company popup's "aligned w/other CDM" checkbox.
        cdmAligned: company?.cdmAligned === true,
      };
    })
    .sort((a, b) => b.stage - a.stage
      || (b.amount ?? -Infinity) - (a.amount ?? -Infinity)
      || a.name.localeCompare(b.name));
}
