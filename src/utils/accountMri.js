// The Account MRI intake template (src/assets/account-mri-intake-template.xlsx),
// tab 1 "Profile & Background": which tracker field answers each row, the
// values for one company, and writing them into the template's "Your entry"
// column.
//
// The workbook is filled by editing the sheet's XML in place rather than by
// reading and re-writing it through a spreadsheet library: the template's
// dropdowns are x14 data validations pointing at its Lists tab, and both
// libraries the app carries drop those on a round trip. Everything not
// written here (the other six tabs, styles, dropdowns) is left byte for byte.
//
// Imported with extensions so this loads under plain Node for the tests.
import { isPrimaryPoc } from './attendeeRoles.js';
import { serviceStatusBucket } from './serviceStatusColors.js';

// The service the template's UBM row reads.
export const UBM_SERVICE = 'Bill payment';

// One entry per row of the tab that has a "Your entry" cell, top to bottom.
// `source` is the tracker field Dan tied the row to in the template's
// column B; '' is a row with no tracker field, which the export leaves as
// the template has it. `kind` is how the cell is written.
export const MRI_PROFILE_FIELDS = [
  { row: 5, key: 'accountName', label: 'Account name', source: 'Company' },
  { row: 6, key: 'vertical', label: 'Vertical', source: 'Vertical' },
  { row: 7, key: 'salesperson', label: 'Salesperson', source: 'CDM' },
  { row: 8, key: 'team', label: 'Team (director)', source: '' },
  { row: 9, key: 'subTeam', label: 'Sub-team', source: '' },
  { row: 10, key: 'tier', label: 'Tier', source: 'Tier' },
  { row: 11, key: 'existingClient', label: 'Existing client', source: 'Client?' },
  { row: 12, key: 'stage', label: 'Stage', source: 'Status' },
  { row: 13, key: 'assignedSince', label: 'Assigned since', source: '' },
  { row: 14, key: 'hq', label: 'HQ', source: 'HQ Region' },
  { row: 15, key: 'revenueB', label: 'Revenue ($B)', source: 'Revenue', kind: 'number' },
  { row: 16, key: 'sites', label: '# Sites', source: 'Sites', kind: 'number' },
  { row: 17, key: 'energySpend', label: 'Energy spend ($M/yr)', source: '' },
  { row: 19, key: 'mainContact', label: 'Main point of contact', source: 'Primary Point of Contact' },
  { row: 20, key: 'revenueText', label: 'Annual revenue / profit', source: 'Revenue' },
  { row: 21, key: 'currentProvider', label: 'Current provider', source: '' },
  { row: 22, key: 'competitors', label: 'Key competitors', source: 'Competitors' },
  { row: 23, key: 'background', label: 'Other context / background', source: 'Company Notes' },
  { row: 25, key: 'services', label: 'Services in scope', source: 'Services' },
  { row: 26, key: 'fee', label: 'Fee', source: 'Annual' },
  { row: 27, key: 'setup', label: 'Set-up', source: 'Setup' },
  { row: 28, key: 'ubm', label: 'UBM', source: 'Bill payment (service)' },
  { row: 29, key: 'contractTerm', label: 'Contract term', source: 'Soonest Expiration' },
  { row: 30, key: 'earlyOut', label: 'Early out', source: '' },
  { row: 31, key: 'upsell', label: 'Potential upsell opportunities', source: '' },
];

// The rows the tool fills: those with a tracker field behind them.
export const MRI_FILLED_FIELDS = MRI_PROFILE_FIELDS.filter(f => f.source);

const text = v => String(v ?? '').trim();

// The template's Tier dropdown (Lists!A): Not set, Tier I, Tier II, Tier III.
const TIER_TO_LIST = { 'Tier 1': 'Tier I', 'Tier 2': 'Tier II', 'Tier 3': 'Tier III' };
export function mriTier(tier) {
  return TIER_TO_LIST[text(tier)] || 'Not set';
}

// The template's Stage dropdown (Lists!C) is the MRI tool's own sales
// stages, which the tracker's Status only partly lines up with. The two
// that plainly correspond are translated; anything else goes across as the
// tracker has it, so nothing is guessed. The dash in the first is the
// template's own en dash.
const STATUS_TO_STAGE = { client: 'Customer – Expand', qualifying: 'Qualify' };
export function mriStage(status) {
  const s = text(status);
  return STATUS_TO_STAGE[s.toLowerCase()] || s;
}

/**
 * The tracker's Revenue text ("$1.5B", "850M", "$4,200,000,000") in
 * billions of dollars, or null when it carries no scale to read it by: a
 * bare "4.2" could be billions or millions, and a wrong number in a cell
 * that drives sizing is worse than an empty one.
 */
export function revenueInBillions(raw) {
  const s = text(raw).toLowerCase().replace(/,/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(billion|bn|b|million|mm|mn|m|thousand|k)?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || '';
  let dollars;
  if (/^b/.test(unit)) dollars = n * 1e9;
  else if (/^m/.test(unit)) dollars = n * 1e6;
  else if (unit) dollars = n * 1e3;
  else if (n >= 1e6) dollars = n;
  else return null;
  return Math.round(dollars / 1e6) / 1e3;
}

// "@[Service]" and "@![Competitor]" are how the Competitors box stores its
// tag chips; on a spreadsheet they read as the bare name.
export function plainMentions(raw) {
  return text(raw).replace(/@!?\[([^\]]*)\]/g, '$1').replace(/\s*\n+\s*/g, '; ');
}

function contactName(c) {
  return `${text(c?.firstname)} ${text(c?.lastname)}`.trim();
}

/** "Name · email · phone" for each contact tagged Primary Point of Contact. */
export function mainContactText(contacts) {
  const out = [];
  for (const c of contacts || []) {
    if (!isPrimaryPoc(c)) continue;
    const parts = [contactName(c), text(c.email), text(c.phone || c.mobilephone)].filter(Boolean);
    if (parts.length) out.push(parts.join(' · '));
  }
  return out.join('; ');
}

/** The services board as one cell: what is sold, then what is in progress. */
export function servicesInScope(servicesExplored) {
  const sold = [];
  const open = [];
  for (const [name, status] of Object.entries(servicesExplored || {})) {
    const bucket = serviceStatusBucket(status);
    if (bucket === 'sold') sold.push(name);
    else if (bucket === 'inProgress') open.push(name);
  }
  sold.sort((a, b) => a.localeCompare(b));
  open.sort((a, b) => a.localeCompare(b));
  if (sold.length && open.length) return `Sold: ${sold.join(', ')}. In progress: ${open.join(', ')}`;
  if (open.length) return `In progress: ${open.join(', ')}`;
  return sold.join(', ');
}

const money = n => (n == null || !Number.isFinite(Number(n)) ? '' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
const dateText = d => (d instanceof Date && !Number.isNaN(d.getTime())
  ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  : '');

/**
 * One company's tab 1 values, keyed as MRI_PROFILE_FIELDS. '' (null for a
 * number) means the tracker has nothing, and the export then leaves the
 * template's own cell alone.
 *
 *   record     the tracker record (or just { company } when there is none)
 *   tier       the Tier the Strategic Accounts subtab shows for it
 *   contacts   the company's contacts (only the tagged ones are read)
 *   contracts  contractsSummary() of the company's agreements, or null
 */
export function accountMriProfile({ record, tier = '', contacts = [], contracts = null } = {}) {
  const p = record || {};
  const status = text(p.status);
  const sites = Number(String(p.numberOfSites ?? '').replace(/,/g, ''));
  const competitors = [plainMentions(p.competitorsNotes)];
  for (const c of Array.isArray(p.competitorConsultants) ? p.competitorConsultants : []) {
    const firm = text(c?.firm);
    if (firm && !competitors.some(x => x.toLowerCase().includes(firm.toLowerCase()))) competitors.push(firm);
  }
  const recurring = money(contracts?.recurring);
  const setup = money(contracts?.setup);
  return {
    accountName: text(p.company),
    vertical: text(p.vertical),
    salesperson: text(p.cdm),
    tier: mriTier(tier || p.tier),
    existingClient: status ? (status.toLowerCase() === 'client' ? 'Yes' : 'No') : '',
    stage: mriStage(status),
    hq: text(p.hqRegion),
    revenueB: revenueInBillions(p.revenue),
    sites: Number.isFinite(sites) && sites > 0 ? sites : null,
    mainContact: mainContactText(contacts),
    revenueText: text(p.revenue),
    competitors: competitors.filter(Boolean).join('; '),
    background: text(p.notes),
    services: servicesInScope(p.servicesExplored),
    fee: recurring ? `${recurring} / yr` : '',
    setup: setup ? `${setup} one-time` : '',
    ubm: text((p.servicesExplored || {})[UBM_SERVICE]).replace(/^-$/, ''),
    contractTerm: contracts?.soonestEnd ? `Expires ${dateText(contracts.soonestEnd)}` : '',
  };
}

const xmlEscape = s => String(s)
  // Control characters XML 1.0 cannot carry (a pasted note can hold them).
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `sheetXml` with the "Your entry" cell of each row in `profile` written.
 * A value of '' / null / undefined leaves the template's cell as it is.
 * Returns { xml, written } where `written` is the cells changed. Throws
 * when a cell the template should have is missing, which means the
 * template was replaced by one laid out differently.
 */
export function fillProfileSheet(sheetXml, profile, { column = 'C' } = {}) {
  let xml = sheetXml;
  const written = [];
  for (const f of MRI_PROFILE_FIELDS) {
    const value = profile?.[f.key];
    if (value == null || value === '') continue;
    const ref = `${column}${f.row}`;
    const cell = new RegExp(`<c r="${ref}"((?:\\s[^>]*?)?)(?:/>|>[\\s\\S]*?</c>)`);
    const hit = xml.match(cell);
    if (!hit) throw new Error(`The Account MRI template has no cell ${ref}.`);
    const style = (hit[1].match(/\ss="\d+"/) || [''])[0];
    const asNumber = f.kind === 'number' && Number.isFinite(Number(value));
    const next = asNumber
      ? `<c r="${ref}"${style}><v>${Number(value)}</v></c>`
      : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    xml = xml.replace(cell, () => next);
    written.push(ref);
  }
  return { xml, written };
}

// The tab's own part of the workbook.
export const MRI_PROFILE_SHEET_PATH = 'xl/worksheets/sheet1.xml';

/** A file name Windows will take: "Account MRI - Northwind.xlsx". */
export function mriFileName(company) {
  const name = text(company).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Account MRI - ${name || 'Account'}.xlsx`;
}
