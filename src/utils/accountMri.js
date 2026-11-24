// The Account MRI intake template (src/assets/account-mri-intake-template.xlsx):
// what the tracker knows for one company, and writing it into the template.
//
//   tab 1 "Profile & Background"  the tracker field behind each row, into
//                                 the "Your entry" column
//   tab 3 "Buying Committee"      the company's decision makers, one a row
//   tab 5 "Sites & Utilities"     the site list saved on the company popup
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
import { isActiveSiteStatus, pickSiteStatusColumn } from './siteStatus.js';

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
  { row: 13, key: 'assignedSince', label: 'Assigned since', source: '', kind: 'date' },
  { row: 14, key: 'hq', label: 'HQ', source: 'HQ Region' },
  { row: 15, key: 'revenueB', label: 'Revenue ($B)', source: 'Revenue', kind: 'number' },
  { row: 16, key: 'sites', label: '# Sites', source: 'Sites', kind: 'number' },
  { row: 17, key: 'energySpend', label: 'Energy spend ($M/yr)', source: '', kind: 'number' },
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
  { row: 31, key: 'upsell', label: 'Potential upsell opportunities', source: 'Services (Qualifying) and CDM' },
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

// A service's bucket on the template: Sold and Not Sold go in the "Services
// in scope" cell, and every status still in flight (Exploring, Qualifying,
// Quoting, Quoted, Verbal ...) is an open opportunity, which goes in the
// "Potential upsell opportunities" cell. N/A and never-explored services
// are in neither. Each list is A to Z.
function serviceBuckets(servicesExplored) {
  const names = { sold: [], inProgress: [], notSold: [] };
  for (const [name, status] of Object.entries(servicesExplored || {})) {
    const list = names[serviceStatusBucket(status)];
    if (list && text(name)) list.push(text(name));
  }
  for (const list of Object.values(names)) list.sort((x, y) => x.localeCompare(y));
  return names;
}

/**
 * The "Services in scope" cell: a "Sold:" line and a "Not Sold:" line, each
 * listing its services ("None" when it has none). '' when no service is
 * either.
 */
export function servicesInScope(servicesExplored) {
  const { sold, notSold } = serviceBuckets(servicesExplored);
  if (!sold.length && !notSold.length) return '';
  return `Sold: ${sold.join(', ') || 'None'}\nNot Sold: ${notSold.join(', ') || 'None'}`;
}

/**
 * The "Potential upsell opportunities & who is responsible" cell: the
 * services being qualified, then the account's salesperson as the one
 * responsible (the tracker keeps no owner per service). '' when nothing is
 * being qualified.
 */
export function upsellOpportunities(servicesExplored, responsible = '') {
  const { inProgress } = serviceBuckets(servicesExplored);
  if (!inProgress.length) return '';
  const who = text(responsible);
  return `Qualifying: ${inProgress.join(', ')}${who ? `\nResponsible: ${who}` : ''}`;
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
    upsell: upsellOpportunities(p.servicesExplored, p.cdm),
  };
}

const xmlEscape = s => String(s)
  // Control characters XML 1.0 cannot carry (a pasted note can hold them).
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function isoDateSerial(value) {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 + 25569 : null;
}

// `xml` (a whole sheet, or one row of it) with cell `ref` holding `value`,
// keeping the cell's own style. Throws when the cell is not there, which
// means the template was replaced by one laid out differently.
function setCell(xml, ref, value, asNumber = false) {
  const cell = new RegExp(`<c r="${ref}"((?:\\s[^>]*?)?)(?:/>|>[\\s\\S]*?</c>)`);
  const hit = xml.match(cell);
  if (!hit) throw new Error(`The Account MRI template has no cell ${ref}.`);
  const style = (hit[1].match(/\ss="\d+"/) || [''])[0];
  const next = asNumber && Number.isFinite(Number(value))
    ? `<c r="${ref}"${style}><v>${Number(value)}</v></c>`
    : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  return xml.replace(cell, () => next);
}

/**
 * `sheetXml` with the "Your entry" cell of each row in `profile` written.
 * A value of '' / null / undefined leaves the template's cell as it is.
 * Returns { xml, written } where `written` is the cells changed.
 */
export function fillProfileSheet(sheetXml, profile, { column = 'C' } = {}) {
  let xml = sheetXml;
  const written = [];
  for (const f of MRI_PROFILE_FIELDS) {
    const value = profile?.[f.key];
    if (value == null || value === '') continue;
    const ref = `${column}${f.row}`;
    // A date the popup took ("2026-11-23") is stored as the day number the
    // cell's date format reads; anything else in that row goes across as text.
    const day = f.kind === 'date' ? isoDateSerial(value) : null;
    const numeric = f.kind === 'number' || day != null;
    xml = setCell(xml, ref, day ?? value, numeric);
    if (!numeric) xml = fitRowHeight(xml, f.row, value);
    written.push(ref);
  }
  return { xml, written };
}

// The "Your entry" column is 48 wide, which is about this many characters
// of its font to a line, each line about this many points tall.
const ENTRY_CHARS_PER_LINE = 50;
const ENTRY_LINE_POINTS = 15;

// A row the template gives a fixed height does not grow to its text when
// the file is opened, so one holding more lines than fit is made taller
// here. Rows with no fixed height size themselves and are left alone.
function fitRowHeight(xml, row, value) {
  const lines = String(value).split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / ENTRY_CHARS_PER_LINE)), 0);
  const need = lines * ENTRY_LINE_POINTS + 4;
  return xml.replace(new RegExp(`(<row r="${row}"[^>]*?\\sht=")([\\d.]+)(")`), (m, a, ht, z) => (
    Number(ht) >= need ? m : `${a}${need}${z}`
  ));
}

// The template's two list tabs: where the entry rows sit and which column
// takes which value. Row 5 of tab 3 and row 2 of tab 5 are the template's
// grey example rows, which stay; tab 5's totals are written to skip its.
export const MRI_COMMITTEE_TABLE = {
  path: 'xl/worksheets/sheet3.xml',
  startRow: 6,
  endRow: 30,
  // E to J are the popup's own dropdowns; the tracker has nothing for them.
  columns: [
    { col: 'A', key: 'name' }, { col: 'B', key: 'title' }, { col: 'C', key: 'email' }, { col: 'D', key: 'phone' },
    { col: 'E', key: 'bodySystem' }, { col: 'F', key: 'buyingRole' }, { col: 'G', key: 'support' },
    { col: 'H', key: 'decisionRole' }, { col: 'I', key: 'relationship' }, { col: 'J', key: 'relOwner' },
  ],
};
export const MRI_SITES_TABLE = {
  path: 'xl/worksheets/sheet5.xml',
  startRow: 3,
  endRow: 202,
  columns: [
    { col: 'A', key: 'name' }, { col: 'B', key: 'country' }, { col: 'C', key: 'location' }, { col: 'D', key: 'function' },
    { col: 'E', key: 'elec', number: true }, { col: 'F', key: 'elecUnits' },
    { col: 'G', key: 'fuel', number: true }, { col: 'H', key: 'fuelUnits' },
  ],
};

const ROW_RE = /<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const renumberRow = (attrs, body, from, to) => (body == null
  ? `<row r="${to}"${attrs}/>`
  : `<row r="${to}"${attrs}>${body.replace(new RegExp(`(<c r="[A-Z]+)${from}"`, 'g'), `$1${to}"`)}</row>`);

// `count` more entry rows after `endRow`, each a blank copy of it (same
// styles). Rows below move down, and every range on the sheet that stopped
// at `endRow` (the totals' formulas, the dropdowns) now stops at the new
// last entry row.
function addEntryRows(sheetXml, endRow, count) {
  let template = null;
  let xml = sheetXml.replace(ROW_RE, (m, r, attrs, body) => {
    const n = Number(r);
    if (n === endRow) template = { attrs, body: (body || '').replace(/<c r="([A-Z]+)\d+"((?:\s[^>]*?)?)(?:\/>|>[\s\S]*?<\/c>)/g, (c, col, a) => `<c r="${col}${endRow}"${(a.match(/\ss="\d+"/) || [''])[0]}/>`) };
    return n > endRow ? renumberRow(attrs, body, n, n + count) : m;
  });
  if (!template) throw new Error(`The Account MRI template has no row ${endRow}.`);
  let added = '';
  for (let i = 1; i <= count; i++) added += renumberRow(template.attrs, template.body, endRow, endRow + i);
  const close = new RegExp(`(<row r="${endRow}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/row>))`);
  xml = xml.replace(close, (m) => m + added);
  const stretch = (t) => t.replace(new RegExp(`(:\\$?[A-Z]+\\$?)${endRow}(?!\\d)`, 'g'), `$1${endRow + count}`);
  xml = xml.replace(/<f>([^<]*)<\/f>/g, (m, f) => `<f>${stretch(f)}</f>`);
  xml = xml.replace(/<xm:sqref>([^<]*)<\/xm:sqref>/g, (m, f) => `<xm:sqref>${stretch(f)}</xm:sqref>`);
  xml = xml.replace(/<dimension ref="([A-Z]+\d+:[A-Z]+)(\d+)"/, (m, a, last) => `<dimension ref="${a}${Number(last) + count}"`);
  return xml;
}

/**
 * `sheetXml` with `rows` (objects keyed as `table.columns`) written one per
 * entry row from `table.startRow`. A list longer than the template's entry
 * rows gets more rows added rather than being cut off. Blank values leave
 * their cells alone. Returns { xml, written, added }: rows written, and
 * rows added to make room.
 */
export function fillTableSheet(sheetXml, table, rows) {
  const list = rows || [];
  if (!list.length) return { xml: sheetXml, written: 0, added: 0 };
  const capacity = table.endRow - table.startRow + 1;
  const added = Math.max(0, list.length - capacity);
  let xml = added ? addEntryRows(sheetXml, table.endRow, added) : sheetXml;
  let written = 0;
  xml = xml.replace(ROW_RE, (m, r) => {
    const item = list[Number(r) - table.startRow];
    if (!item || Number(r) < table.startRow) return m;
    let row = m;
    for (const c of table.columns) {
      const value = item[c.key];
      if (value == null || value === '') continue;
      row = setCell(row, `${c.col}${r}`, value, !!c.number);
    }
    written += 1;
    return row;
  });
  if (written !== list.length) throw new Error('The Account MRI template is missing entry rows.');
  return { xml, written, added };
}

/** The decision makers as tab 3 rows, A to Z: name, title, email, phone. */
export function buyingCommitteeRows(contacts) {
  const out = [];
  for (const c of contacts || []) {
    const email = text(c?.email);
    const name = contactName(c) || email;
    if (!name) continue;
    out.push({ name, title: text(c.jobtitle), email, phone: text(c.phone || c.mobilephone) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function findHeader(headers, patterns, skip = null) {
  for (const pattern of patterns) {
    const hit = headers.find(h => pattern.test(h) && !(skip && skip.test(h)));
    if (hit) return hit;
  }
  return '';
}
// A consumption cell as a number: "182,000", "182000 kWh". No digits, no answer.
function quantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const m = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
const UNIT_NAMES = [[/\bmwh\b/i, 'MWh'], [/\bkwh\b/i, 'kWh'], [/\bgwh\b/i, 'GWh'], [/\bmmbtu\b/i, 'MMBtu'], [/\bdth\b|dekatherm/i, 'Dth'], [/\btherms?\b/i, 'therms'], [/\bmcf\b/i, 'Mcf'], [/\bccf\b/i, 'Ccf']];
const unitIn = (s) => (UNIT_NAMES.find(([re]) => re.test(String(s || ''))) || [null, ''])[1];
// A column that prices or rates energy is not a consumption column.
const NOT_CONSUMPTION = /rate|cost|spend|price|\$|supplier|utility|market|uom|unit/i;

/**
 * The site list saved on the company popup (settings.companySiteLists) as
 * tab 5 rows: one per site still open, in the list's own order.
 *
 * A saved list keeps whatever columns its source had, so the columns are
 * found by name, the ones the Utility Lookup save writes first. A unit comes
 * from the consumption column's own name ("Annual Electric (kWh)"), else
 * from a units column beside it.
 */
export function siteUtilityRows(entry) {
  const headers = (entry?.headers || []).filter(h => typeof h === 'string');
  const listed = (entry?.rows || []).filter(r => r && typeof r === 'object');
  const statusCol = pickSiteStatusColumn(headers);
  const rows = statusCol ? listed.filter(r => isActiveSiteStatus(r[statusCol])) : listed;
  if (!rows.length) return [];

  const nameCol = findHeader(headers, [/^site\s*name$/i, /^site$/i, /^facility(\s*name)?$/i, /^property\s*name$/i, /^building\s*name$/i, /^name$/i, /site\s*name|facility|property\s*name|building\s*name/i]);
  const addressCol = findHeader(headers, [/^address$/i, /^street(\s*address)?$/i, /address/i]);
  const cityCol = findHeader(headers, [/^city\s*\(analysis/i, /^city$/i, /\bcity\b/i, /^town$/i, /municipality/i]);
  const stateCol = findHeader(headers, [/^st\s*\/\s*prov/i, /^state\s*\(analysis/i, /^state$/i, /^province$/i, /state\s*\/\s*prov/i, /\bstate\b/i, /\bprovince\b/i]);
  const countryCol = findHeader(headers, [/^country\s*\(analysis/i, /^country$/i, /\bcountry\b/i]);
  const typeCol = findHeader(headers, [/^property\s*type\s*\(analysis\)$/i, /^property\s*type$/i, /property\s*type/i, /building\s*type/i, /asset\s*type/i, /^function$/i]);
  const elecCol = findHeader(headers, [/^annual\s*electric\s*\(kwh\)/i, /electric(ity)?.*(consumption|usage)/i, /\b[kmg]wh\b/i], NOT_CONSUMPTION);
  const fuelCol = findHeader(headers, [/^annual\s*gas\s*\(dth\)/i, /(gas|fuel).*(consumption|usage)/i, /\bdth\b|\btherms?\b|\bmmbtu\b/i], NOT_CONSUMPTION);
  const elecUnitCol = findHeader(headers, [/electric.*(uom|units?)\b/i]);
  const fuelUnitCol = findHeader(headers, [/(gas|fuel).*(uom|units?)\b/i]);

  const cell = (row, col) => (col ? text(row[col]) : '');
  return rows.map((row, i) => {
    const location = [cell(row, cityCol), cell(row, stateCol)].filter(Boolean).join(', ');
    const elec = elecCol ? quantity(row[elecCol]) : null;
    const fuel = fuelCol ? quantity(row[fuelCol]) : null;
    return {
      // Never blank: the tab counts its sites by this column.
      name: cell(row, nameCol) || cell(row, addressCol) || location || `Site ${i + 1}`,
      country: cell(row, countryCol),
      location,
      function: cell(row, typeCol),
      elec,
      elecUnits: elec == null ? '' : (unitIn(elecCol) || unitIn(cell(row, elecUnitCol)) || cell(row, elecUnitCol)),
      fuel,
      fuelUnits: fuel == null ? '' : (unitIn(fuelCol) || unitIn(cell(row, fuelUnitCol)) || cell(row, fuelUnitCol)),
    };
  });
}

/**
 * The template (a JSZip of it) filled for one company: tab 1 from
 * `profile`, tab 3 from `committee`, tab 5 from `sites`. Edits `zip` in
 * place and returns what was written. The workbook is marked to recalculate
 * when opened, so tab 5's totals read the sites just written.
 *
 * `extra` is what the Account MRI popup holds for the other tabs
 * (accountMriForm.mriFormExport): `cells` as { sheet path: [{ ref, value,
 * number }] } and `tables` as fillTableSheet tables each with its `rows`.
 * They are written first, so the committee growing past its entry rows
 * does not move a cell still to be written.
 */
export async function fillAccountMriWorkbook(zip, { profile = {}, committee = [], sites = [], extra = null } = {}) {
  const edit = async (path, fn) => {
    const file = zip.file(path);
    if (!file) throw new Error(`The Account MRI template has no ${path}.`);
    const result = fn(await file.async('string'));
    zip.file(path, result.xml);
    return result;
  };
  let extraCells = 0;
  for (const [path, cells] of Object.entries(extra?.cells || {})) {
    await edit(path, (xml) => {
      let next = xml;
      for (const c of cells) next = setCell(next, c.ref, c.value, !!c.number);
      extraCells += cells.length;
      return { xml: next };
    });
  }
  let extraRows = 0;
  for (const table of extra?.tables || []) {
    const t = await edit(table.path, xml => fillTableSheet(xml, table, table.rows));
    extraRows += t.written;
  }
  const p = await edit(MRI_PROFILE_SHEET_PATH, xml => fillProfileSheet(xml, profile));
  const c = await edit(MRI_COMMITTEE_TABLE.path, xml => fillTableSheet(xml, MRI_COMMITTEE_TABLE, committee));
  const s = await edit(MRI_SITES_TABLE.path, xml => {
    const filled = fillTableSheet(xml, MRI_SITES_TABLE, sites);
    // The totals' stored results, for anything that reads the file without
    // recalculating it (a preview, an import).
    const sum = key => sites.reduce((t, r) => t + (Number.isFinite(Number(r[key])) ? Number(r[key]) : 0), 0);
    const stored = { 'SUM\\(E': sum('elec'), 'SUM\\(G': sum('fuel'), 'COUNTA\\(A': sites.length };
    for (const [fn, value] of Object.entries(stored)) {
      filled.xml = filled.xml.replace(new RegExp(`(<f>${fn}[^<]*</f>)<v>[^<]*</v>`), `$1<v>${value}</v>`);
    }
    return filled;
  });
  await edit('xl/workbook.xml', xml => ({
    xml: /fullCalcOnLoad/.test(xml) ? xml : xml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'),
  }));
  return { profileCells: p.written.length, committeeRows: c.written, siteRows: s.written, ...(extra ? { extraCells, extraRows } : {}) };
}

// The tab's own part of the workbook.
export const MRI_PROFILE_SHEET_PATH = 'xl/worksheets/sheet1.xml';

/** A file name Windows will take: "Account MRI - Northwind.xlsx". */
export function mriFileName(company) {
  const name = text(company).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Account MRI - ${name || 'Account'}.xlsx`;
}
