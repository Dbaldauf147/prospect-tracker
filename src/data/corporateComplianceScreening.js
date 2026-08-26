// Corporate Compliance screening — the jurisdiction gating questions and
// the regulation thresholds behind them.
//
// Extension spelled out so the plain-Node test scripts can import this file.
import { normalizeCompany } from '../utils/companyNorm.js';

// Canonical key for a company, using the SAME normalization the Corporate
// Compliance page uses to match company names from the uploaded Utility
// Lookup file (companyNorm — lower-cased, corporate suffixes and punctuation
// stripped). Screening answers are saved under this key so a company keeps
// its answers regardless of cosmetic name differences ("Acme Inc" vs
// "ACME, INC."), and name variants collapse onto one company. Hyphenated so
// it is safe as a Firestore dotted field-path segment (no dots).
//
// Lives here rather than on the page because the Compliance Roadmap reads the
// same answers back to work out which mandates are in scope — one definition,
// or the two views disagree about which company they're looking at.
export function companyScreeningKey(name) {
  const norm = normalizeCompany(name);
  return norm ? norm.replace(/\s+/g, '-') : '';
}

//
// The six questions are answered Yes/No per company on the Corporate
// Compliance page and persisted under settings.corporateComplianceScreening
// keyed by company slug, then jurisdiction `key`. When a company answers
// "Yes" for a jurisdiction, the regulations listed here (timeline + plain
// description + the numeric thresholds that gate them) are surfaced so the
// user can judge which reporting regimes may apply.

// One column / question per jurisdiction. `key` is the stable slug stored
// per company (never change it — it's the persistence key); `jurisdiction`
// is the short column label; `question` is the full prompt.
export const JURISDICTION_QUESTIONS = [
  { key: 'california', jurisdiction: 'California', question: 'Operate in or sell products or services in California?' },
  { key: 'eu', jurisdiction: 'EU', question: 'Operate in the EU?' },
  { key: 'uk', jurisdiction: 'UK', question: 'Legally incorporated in the UK?' },
  { key: 'australia', jurisdiction: 'Australia', question: 'Legally incorporated in Australia?' },
  { key: 'mexico', jurisdiction: 'Mexico', question: "Issue securities in Mexico, such as through Mexico's stock exchange? (Banks, Issuers, Publicly Traded)" },
  { key: 'brazil', jurisdiction: 'Brazil', question: "Listed on Brazil's stock exchange?" },
];

// Allowed answers (plus the blank "unanswered" state the UI adds).
// "Unknown" is a real, persisted answer — the research step returns it when
// the public record doesn't settle the question, and it must be
// distinguishable from "nobody has looked yet".
export const SCREENING_ANSWERS = ['Yes', 'No', 'Unknown'];

// The "doing business in California" sales test, from the Franchise Tax
// Board's annually indexed figure. One number so the criterion label, the
// regulation descriptions and the thresholds table can't quote different
// values at each other.
export const CA_SALES_THRESHOLD_USD = 757_070;
const CA_SALES_THRESHOLD_LABEL = `$${CA_SALES_THRESHOLD_USD.toLocaleString('en-US')}`;

// The reporting regulations gated by each jurisdiction question, keyed by
// the same `key` as JURISDICTION_QUESTIONS. `thresholds` are the
// requirement/metric pairs from the source screening matrix (numbers left
// as strings so ranges like ">0 <50,000" survive intact).
//
// `timeline` is the one-line "which year, filed when" summary this page and
// the exports print. The dated version — exact submission deadlines, how firm
// each one is, and a source per date — lives in
// data/corporateComplianceDeadlines.js, which the Compliance Roadmap charts.
// When a regulator moves a date, fix it in both; the deadline tests assert the
// two agree on the first reporting year.
export const REGULATIONS_BY_JURISDICTION = {
  california: [
    {
      regulation: 'SB 253',
      // First cycle covers FY2025. CARB set scope 1 & 2 at 10 Aug 2026, then
      // moved it to 10 Nov 2026 on 24 Jun 2026; scope 3 joins from 2027.
      timeline: '2025 data (scope 1 & 2 due 10 Nov 2026; scope 3 from 2027)',
      description: `Applies to companies with $1 billion+ in annual revenue doing business in California (legally formed or commercially based in California, or California sales exceeding ${CA_SALES_THRESHOLD_LABEL} in the last two years).`,
      // Machine-readable twin of the "1,000 Revenue (Million USD)" row
      // above — `thresholds` is display text, this is what the Applies?
      // derivation compares against. See deriveRegulationVerdict.
      revenueThresholdUsd: 1_000_000_000,
      thresholds: [
        { value: '1,000', metric: 'Revenue (Million USD)' },
        { value: CA_SALES_THRESHOLD_LABEL.replace('$', ''), metric: 'California Sales (USD)' },
      ],
    },
    {
      regulation: 'SB 261',
      // Statutory first report was due 1 Jan 2026, biennially after that. The
      // Ninth Circuit enjoined enforcement on 18 Nov 2025 and CARB's 1 Dec
      // 2025 advisory says it will set a replacement date once the appeal is
      // decided — so this row deliberately does not name a live deadline.
      timeline: '2025 data (was due 1 Jan 2026: enforcement stayed; biennial thereafter)',
      description: `Applies to companies with $500 million+ in annual revenue doing business in California (legally formed or commercially based in California, or California sales exceeding ${CA_SALES_THRESHOLD_LABEL} in the last two years).`,
      revenueThresholdUsd: 500_000_000,
      thresholds: [
        { value: '500', metric: 'Revenue (Million USD)' },
        { value: CA_SALES_THRESHOLD_LABEL.replace('$', ''), metric: 'California Sales (USD)' },
      ],
    },
  ],
  eu: [
    {
      regulation: 'CSRD: Wave 1',
      timeline: '2024 data (reporting starts 2025)',
      description: 'Large entities with securities listed on an EU regulated market meeting the new thresholds: more than 1,000 employees and a net turnover of EUR 450 million or more.',
      thresholds: [
        { value: '1,000', metric: 'Employees' },
        { value: '450', metric: 'Global Net Turnover (Million EUR)' },
      ],
    },
    {
      regulation: 'CSRD: Wave 2',
      timeline: '2027 data (reporting starts 2028)',
      description: 'Large entities present in the EU meeting both criteria: more than 1,000 employees and a net turnover of EUR 450 million or more.',
      thresholds: [
        { value: '1,000', metric: 'Employees' },
        { value: '450', metric: 'Global Net Turnover (Million EUR)' },
      ],
    },
    {
      regulation: 'CSRD: Wave 3',
      timeline: '2028 data (reporting starts 2029)',
      description: 'Large non-EU entities: a net turnover of EUR 450 million or more in the EU and at least one EU subsidiary or branch with over EUR 200 million net turnover.',
      thresholds: [
        { value: '450', metric: 'EU Net Turnover (Million EUR)' },
        { value: '200', metric: 'EU subsidiary net turnover (Million EUR)' },
      ],
    },
    {
      // The odd one out on this page, and worth knowing why: every other row
      // here is a disclosure mandate that turns on how big the company is.
      // CBAM turns on what it imports — a small importer of steel is caught
      // and a giant services group is not — so no revenue or headcount figure
      // on this card can settle it, and its Applies? cell stays a judgement
      // rather than a derivation.
      regulation: 'CBAM',
      timeline: '2026 imports (definitive regime from 1 Jan 2026; first declaration 30 Sep 2027)',
      description: 'Importers bringing covered carbon-intensive goods into the EU — cement, iron and steel, aluminium, fertilisers, hydrogen and electricity. From 1 Jan 2026 an importer must hold authorised CBAM declarant status and surrender certificates against the emissions embedded in what it imports. The Omnibus regulation exempts importers of 50 tonnes or less of covered goods a year outright, which drops most occasional importers while keeping the bulk of embedded emissions in scope; the threshold does not apply to hydrogen or electricity.',
      thresholds: [
        { value: '50', metric: 'Covered goods imported (tonnes/year: at or below this, exempt)' },
      ],
    },
  ],
  uk: [
    {
      regulation: 'UK FCA',
      timeline: 'Yearly, based on company reporting cycle',
      description: 'Listed on a UK regulated market.',
      thresholds: [],
    },
    {
      regulation: 'UK CFD / SRS',
      timeline: 'CFD: yearly, based on company reporting cycle. SRS: phasing out CFD on Jan 1, 2027 (still based on company yearly reporting).',
      description: 'A Public Interest Entity (PIE); a UK company with more than 500 employees AND more than £500 million turnover; a large LLP meeting the same thresholds; an AIM-listed company with more than 500 employees; or listed on a UK regulated market.',
      thresholds: [
        { value: '500', metric: 'Employees' },
        { value: '500', metric: 'Turnover (Million GBP)' },
      ],
    },
  ],
  australia: [
    {
      regulation: 'Australia Group 1',
      timeline: '2025 data (reporting starts 2026)',
      description: 'Files a financial report with ASIC (Part 2M, Corporations Act 2001) AND meets two of three: consolidated revenue ≥ AUD 500M, gross assets ≥ AUD 1B, ≥ 500 employees: OR reports to NGER with ≥ 50,000 tonnes CO2e.',
      thresholds: [
        { value: '500', metric: 'Revenue (Million AUD)' },
        { value: '1,000', metric: 'Consolidated gross assets (Million AUD)' },
        { value: '500', metric: 'Employees' },
        { value: '50,000', metric: 'tonnes CO2e (NGER)' },
      ],
    },
    {
      regulation: 'Australia Group 2',
      timeline: '2026 data (reporting starts 2027)',
      description: 'Files a financial report with ASIC AND is a registered scheme, registrable superannuation entity, or retail CCIV AND meets two of three: consolidated revenue ≥ AUD 200M, gross assets ≥ AUD 500M, ≥ 250 employees (OR reports to NGER), OR is an asset owner with over AUD 5B in AUM.',
      thresholds: [
        { value: '200', metric: 'Revenue (Million AUD)' },
        { value: '500', metric: 'Consolidated gross assets (Million AUD)' },
        { value: '250', metric: 'Employees' },
        { value: '>0 <50,000', metric: 'tonnes CO2e (on the NGER report)' },
      ],
    },
    {
      regulation: 'Australia Group 3',
      timeline: '2027 data (reporting starts 2028)',
      description: 'Files a financial report with ASIC AND is a registered scheme, registrable superannuation entity, or retail CCIV AND meets two of three: consolidated revenue ≥ AUD 50M, gross assets ≥ AUD 25M, ≥ 100 employees.',
      thresholds: [
        { value: '50', metric: 'Revenue (Million AUD)' },
        { value: '25', metric: 'Consolidated gross assets (Million AUD)' },
        { value: '100', metric: 'Employees' },
      ],
    },
  ],
  mexico: [
    {
      regulation: 'Mexico: CNBV',
      timeline: '2025 data (reporting starts 2026)',
      description: 'Security issuer.',
      thresholds: [],
    },
  ],
  brazil: [
    {
      regulation: 'Brazil: CVM',
      // CVM Resolution 244 (published 1 Jun 2026) withdrew the mandatory phase
      // that would have applied to years beginning on/after 1 Jan 2026;
      // comply-or-explain runs from 1 Jan 2027 instead.
      timeline: '2027 data (comply-or-explain from 1 Jan 2027; the mandatory 2026 phase was withdrawn)',
      description: 'Publicly traded companies.',
      thresholds: [],
    },
  ],
};

// ---- California screening detail -------------------------------------------
// SB 253 and SB 261 each turn on two independent tests: a worldwide revenue
// threshold, AND doing business in California. The second is itself a
// one-of-three test. Showing them as separate rows under the California
// question means the user can see which leg is satisfied and which is
// missing, rather than reading one Yes/No and having to remember why.
//
// `source` says where a row's value comes from, which is what the user has
// to know to trust it:
//   'research' — filled by one of the research runs behind the card's button:
//                the revenue run for the California thresholds, the
//                compliance run for the EU's CSRD figures and CBAM imports
//   'sites'    — counted from the uploaded site list
//   'manual'   — nobody can look this up for you; answer it by hand
export const CALIFORNIA_CRITERIA_GROUPS = [
  {
    key: 'revenue',
    label: 'Revenue thresholds',
    note: "Company's total worldwide gross receipts/sales, not just what it sells inside California",
    // Either threshold on its own is enough for the regulation it gates;
    // they aren't a one-of test between them.
    anyOf: false,
    rows: [
      {
        key: 'rev-500m',
        label: '$500 million revenue (SB 261)',
        source: 'research',
        revenueThresholdUsd: 500_000_000,
      },
      {
        key: 'rev-1b',
        label: '$1 billion in revenue (SB 253)',
        source: 'research',
        revenueThresholdUsd: 1_000_000_000,
      },
    ],
  },
  {
    key: 'doing-business',
    label: 'Doing business in CA?',
    note: 'One of these needs to be Yes',
    anyOf: true,
    rows: [
      {
        key: 'ca-operations',
        label: 'CA operations',
        note: 'Number of sites in CA',
        source: 'sites',
        fromSiteCount: true,
      },
      {
        key: 'ca-sales',
        label: `California sales exceeding ${CA_SALES_THRESHOLD_LABEL}`,
        source: 'manual',
      },
      {
        key: 'ca-domicile',
        label: 'Commercially domiciled / organized in California',
        source: 'manual',
      },
    ],
  },
];

// ---- EU screening detail ---------------------------------------------------
// The CSRD waves turn on where the group sits relative to the EU (incorporated
// there, listed on a regulated market) and on four figures: global turnover,
// EU turnover, the largest EU subsidiary's turnover, and headcount. None of
// that is derivable from what the card already holds — turnover is in euros and
// we don't guess conversions — so these are capture fields, giving the numbers
// a home next to the waves they feed instead of living in a side spreadsheet.
export const EU_CRITERIA_GROUPS = [
  {
    key: 'csrd-inputs',
    label: 'CSRD screening',
    note: 'Where the group sits in the EU, and the figures the waves below screen on',
    // Always on, the way California's rows are. These are what CSRD screens
    // on rather than how the EU question itself gets answered, so they used
    // to wait for a Yes — but that hid the figures somebody needs in front of
    // them to answer it, and left the group looking empty for anyone who
    // hadn't realised the question above was the gate.
    // Everything but the "already reported?" question comes from the compliance
    // research run — `fromResearch` names the field on its `csrd` payload. The
    // one exception is genuinely unknowable from the outside: whether the
    // company has filed already is a fact the account team holds, not one a
    // web search settles.
    rows: [
      { key: 'csrd-2025', label: 'Has the company already submitted a CSRD report in 2025?', source: 'manual' },
      { key: 'eu-incorporated', label: 'Is the company incorporated in the EU?', source: 'research', fromResearch: 'euIncorporated' },
      { key: 'eu-listed', label: 'Is the company listed on an EU regulated market?', source: 'research', fromResearch: 'euListed' },
      {
        key: 'global-turnover',
        label: 'Global Net Turnover (Million EUR)',
        kind: 'number', source: 'research', fromResearch: 'globalTurnoverEurM',
      },
      {
        key: 'eu-turnover',
        label: 'EU Net Turnover (Million EUR)',
        kind: 'number', source: 'research', fromResearch: 'euTurnoverEurM',
      },
      {
        key: 'eu-sub-turnover',
        label: 'Highest Net Turnover Among EU Subsidiaries or Branches (Million EUR)',
        kind: 'number', source: 'research', fromResearch: 'topEuSubsidiaryTurnoverEurM',
      },
      {
        key: 'employees',
        label: 'Employee Count',
        kind: 'number', source: 'research', fromResearch: 'employees', fromEmployeeCount: true,
      },
    ],
  },
  // CBAM screens on what the company imports, so no turnover or headcount
  // figure on this card can answer it — the research run searches for it
  // separately and returns its verdicts on a `cbam` payload of their own,
  // which is why these rows name one (`researchPayload`) and the CSRD rows
  // above don't.
  //
  // Import tonnage is rarely public, so the second row often comes back
  // Unknown and stays open for the account team. That's the point of asking:
  // an Unknown is treated as nothing found, so the row reads as unanswered
  // rather than as a No nobody checked.
  //
  // Kept as its own group, after the CSRD one: csrdValues() reads
  // EU_CRITERIA_GROUPS[0].rows, so the CSRD group has to stay first.
  {
    key: 'cbam-inputs',
    label: 'CBAM screening',
    note: 'What the company imports into the EU — the only thing that decides CBAM, and the one thing no figure on this card implies',
    rows: [
      {
        key: 'cbam-goods',
        label: 'Imports cement, iron / steel, aluminium, fertilisers, hydrogen or electricity into the EU?',
        source: 'research', fromResearch: 'importsCoveredGoods', researchPayload: 'cbam',
      },
      {
        key: 'cbam-over-de-minimis',
        label: 'More than 50 tonnes of covered goods a year? (hydrogen and electricity count however small)',
        source: 'research', fromResearch: 'overFiftyTonnes', researchPayload: 'cbam',
      },
    ],
  },
];

// Jurisdictions whose mandate rows show before the question is answered.
//
// Seeing what a Yes would pull in is part of answering the question: the EU's
// waves screen on the very turnover and headcount figures its criteria rows
// collect, California's SB rows sit under the thresholds that decide them, and
// the rest are one or two rows each — cheap to show, and they say what the
// jurisdiction is actually asking about rather than leaving the row a bare
// question. So every jurisdiction shows its mandates.
//
// California still collapses the lot behind one toggle when revenue rules it
// out; that's a different mechanism, and it keeps the longest jurisdiction
// from dominating a card where it can't apply.
export const ALWAYS_SHOW_REGULATIONS = new Set(
  JURISDICTION_QUESTIONS.map(q => q.key),
);

// The criteria detail per jurisdiction. Only these two have one; the rest
// screen on a single question.
export const JURISDICTION_CRITERIA_GROUPS = {
  california: CALIFORNIA_CRITERIA_GROUPS,
  eu: EU_CRITERIA_GROUPS,
};

// Persistence key for one criterion. Same shape as regulationAnswerKey —
// jurisdiction, double underscore, slug — with a `crit-` prefix so a criterion
// can never collide with a regulation slug.
export function criterionKey(jurisdictionKey, rowKey) {
  return `${jurisdictionKey}__crit-${rowKey}`;
}

export function californiaCriterionKey(rowKey) {
  return criterionKey('california', rowKey);
}

// ---- CSRD wave derivation --------------------------------------------------
// Each wave is an AND of conditions read straight from the descriptions above,
// which are the wording this page has always shown. Encoded here so the
// Applies? cell answers itself from the CSRD rows rather than leaving the
// arithmetic to the reader. Every comparison is spelled out because the
// boundaries matter: "more than 1,000 employees" is strict, "EUR 450 million
// or more" is inclusive, "over EUR 200 million" is strict.
export const CSRD_TURNOVER_EUR_M = 450;
export const CSRD_EMPLOYEES = 1000;
export const CSRD_SUBSIDIARY_EUR_M = 200;

// A condition is { label, value } where value is true / false / null, null
// meaning the input it needs hasn't been established yet.
const gt = (n, limit) => (n == null ? null : n > limit);
const gte = (n, limit) => (n == null ? null : n >= limit);
const isYes = (v) => (v === 'Yes' ? true : v === 'No' ? false : null);
const isNo = (v) => (v === 'Yes' ? false : v === 'No' ? true : null);

const CSRD_WAVE_RULES = {
  'CSRD: Wave 1': (v) => [
    { label: 'listed on an EU regulated market', value: isYes(v.euListed) },
    { label: `more than ${CSRD_EMPLOYEES.toLocaleString('en-US')} employees`, value: gt(v.employees, CSRD_EMPLOYEES) },
    { label: `global net turnover of at least EUR ${CSRD_TURNOVER_EUR_M}M`, value: gte(v.globalTurnover, CSRD_TURNOVER_EUR_M) },
  ],
  'CSRD: Wave 2': (v) => [
    // "Large entities present in the EU" — the jurisdiction question asks
    // exactly that, and being incorporated there settles it on its own.
    {
      label: 'present in the EU',
      value: v.euIncorporated === 'Yes' ? true : isYes(v.euPresence),
    },
    { label: `more than ${CSRD_EMPLOYEES.toLocaleString('en-US')} employees`, value: gt(v.employees, CSRD_EMPLOYEES) },
    { label: `global net turnover of at least EUR ${CSRD_TURNOVER_EUR_M}M`, value: gte(v.globalTurnover, CSRD_TURNOVER_EUR_M) },
  ],
  'CSRD: Wave 3': (v) => [
    { label: 'a non-EU entity', value: isNo(v.euIncorporated) },
    { label: `EU net turnover of at least EUR ${CSRD_TURNOVER_EUR_M}M`, value: gte(v.euTurnover, CSRD_TURNOVER_EUR_M) },
    {
      label: `an EU subsidiary or branch over EUR ${CSRD_SUBSIDIARY_EUR_M}M net turnover`,
      value: gt(v.topEuSubsidiaryTurnover, CSRD_SUBSIDIARY_EUR_M),
    },
  ],
};

// The CSRD row values for one company, resolved the way the table resolves
// them: a hand-entered answer beats the researched one.
function csrdValues(answers, context) {
  const rows = EU_CRITERIA_GROUPS[0].rows;
  const read = (rowKey) => {
    const row = rows.find(r => r.key === rowKey);
    const saved = answers?.[criterionKey('eu', rowKey)] || '';
    return saved || deriveCriterion(row, context)?.verdict || '';
  };
  const num = (rowKey) => {
    const raw = String(read(rowKey)).trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    alreadyReported: read('csrd-2025'),
    euIncorporated: read('eu-incorporated'),
    euListed: read('eu-listed'),
    globalTurnover: num('global-turnover'),
    euTurnover: num('eu-turnover'),
    topEuSubsidiaryTurnover: num('eu-sub-turnover'),
    employees: num('employees'),
    euPresence: context?.euAnswer || '',
  };
}

// One CSRD wave's Applies? verdict, or null when it can't be called yet.
//
// A single failed condition is enough for a No — a company that isn't listed
// in the EU is out of Wave 1 whatever its turnover — so a decisive No lands
// without waiting for every figure. A Yes needs all of them, and any missing
// input leaves the row blank rather than guessing.
export function deriveCsrdWaveVerdict(regulation, { answers, context } = {}) {
  const build = CSRD_WAVE_RULES[regulation?.regulation];
  if (!build) return null;
  const values = csrdValues(answers, context);
  // A company that has already filed a CSRD report is in Wave 1 by
  // demonstration — it doesn't need the thresholds argued from figures that
  // may be stale or converted. This beats the conditions rather than joining
  // them, so it stands even where a figure would otherwise fail the test.
  if (regulation.regulation === 'CSRD: Wave 1' && values.alreadyReported === 'Yes') {
    return {
      verdict: 'Yes',
      basis: 'Auto-derived: the company already submitted a CSRD report in 2025, so Wave 1 applies. Pick a value to override.',
    };
  }
  const conditions = build(values);
  const failed = conditions.filter(c => c.value === false);
  if (failed.length) {
    return {
      verdict: 'No',
      basis: `Auto-derived from the CSRD rows: not ${failed.map(c => c.label).join(', not ')}. Pick a value to override.`,
    };
  }
  if (conditions.some(c => c.value == null)) return null;
  return {
    verdict: 'Yes',
    basis: `Auto-derived from the CSRD rows: ${conditions.map(c => c.label).join(', ')}. Pick a value to override.`,
  };
}

// ---- Applies? derivation ---------------------------------------------------
// Some regulations are pure threshold tests we already hold the inputs for:
// California's SB 253 / SB 261 turn on annual revenue plus "doing business in
// California". Rather than leave those dropdowns for a human to fill from
// numbers already on the card, derive the verdict and let the user override.
//
// Only regulations carrying `revenueThresholdUsd` are derivable. The rest
// (CSRD's employees + EUR turnover, the UK's GBP tests, Australia's AUD
// two-of-three) need data this page doesn't have, and currency conversion we
// shouldn't guess at — they stay blank rather than assert something wrong.

// Parse a human revenue string into US dollars: "$2.4B" → 2_400_000_000,
// "$500M" → 500_000_000, "2,400,000,000" → 2_400_000_000. Returns null when
// there's no number to read, so callers can tell "no figure" from "zero".
export function parseRevenueUsd(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  // Leading non-numerics are currency symbols / stray words; take the first
  // number and whatever unit word immediately follows it.
  const m = s.match(/(-?[\d,]*\.?\d+)\s*([a-zA-Z]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith('t') ? 1e12
    : unit.startsWith('b') ? 1e9
    : unit.startsWith('m') ? 1e6
    : unit.startsWith('k') ? 1e3
    : 1;
  return n * mult;
}

/**
 * Which revenue figure the thresholds are tested against, and whose it is.
 *
 * Every regime on this page measures the CONSOLIDATED group, so a small
 * subsidiary is caught by a large parent. The reverse is just as true: a
 * company big enough in its own right is caught whatever its owner turns
 * over — a $1.2B manufacturer owned by a private-equity firm whose own
 * management-company revenue is $35M is squarely inside SB 253, and
 * screening it on the owner's $35M rules out a mandate that plainly applies.
 *
 * Either figure can trigger a mandate, so the test subject is whichever is
 * LARGER. `entity` names the parent only when the parent's figure is the one
 * under test, so a basis string says whose number cleared the bar; it stays
 * blank when the company's own figure wins, because the number really is
 * this company's.
 *
 * `source` says which way it went — 'parent', 'own', or 'none' when there is
 * no figure at all — so a card can show what it screened on rather than
 * leaving the reader to compare two numbers themselves.
 *
 * A parent nobody has researched yet falls back to the company's own figure
 * rather than screening on nothing: an unresearched parent is a gap in the
 * working, not a reason to stop deriving. Where neither figure carries a
 * readable number the parent's wording still wins, since the consolidated
 * group is the entity the regimes name.
 */
export function pickThresholdRevenue({ own = '', parent = '', parentName = '' } = {}) {
  const ownLabel = String(own || '').trim();
  const parentLabel = String(parent || '').trim();
  const name = String(parentName || '').trim();
  if (!name || !parentLabel) {
    return { label: ownLabel, entity: '', source: ownLabel ? 'own' : 'none' };
  }
  const ownUsd = parseRevenueUsd(ownLabel);
  const parentUsd = parseRevenueUsd(parentLabel);
  const ownWins = Number.isFinite(ownUsd)
    && (!Number.isFinite(parentUsd) || ownUsd >= parentUsd);
  return ownWins
    ? { label: ownLabel, entity: '', source: 'own' }
    : { label: parentLabel, entity: name, source: 'parent' };
}

function fmtUsd(n) {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

// The revenue figure a basis string quotes, and whose it is.
//
// Every regime here tests its thresholds at the CONSOLIDATED group, so when
// a company has a parent recorded the number under test is the parent's.
// That has to be visible wherever the verdict is explained: a basis reading
// "revenue $23.7B >= the $1B threshold" against a subsidiary that turns over
// a fraction of that is not a wrong verdict, it is an unsupportable one —
// the reader cannot tell the figure was never the subsidiary's.
function revenueShown(revenueLabel, revenueUsd, revenueEntity) {
  const figure = revenueLabel || fmtUsd(revenueUsd);
  const entity = String(revenueEntity || '').trim();
  return entity ? `${figure} (parent: ${entity})` : figure;
}

// Derive one regulation's Applies? verdict. Returns { verdict, basis } — the
// basis explains the call in the tooltip — or null when it isn't derivable:
// no revenue threshold on this regulation, no revenue figure researched yet,
// or the jurisdiction gate itself isn't a firm Yes. A "Yes" jurisdiction is
// required because the revenue test alone doesn't create the obligation; the
// company also has to do business there.
export function deriveRegulationVerdict(regulation, {
  revenueUsd, revenueLabel, revenueEntity, jurisdictionAnswer, jurisdictionLabel, doingBusiness,
} = {}) {
  const threshold = regulation?.revenueThresholdUsd;
  if (threshold == null) return null;
  if (!Number.isFinite(revenueUsd)) return null;
  // California's detail rows settle "doing business" properly (operations,
  // sales, domicile — any one of them). When they've been answered, that
  // beats the jurisdiction question, which only asks whether the company
  // operates or sells there at all. Otherwise fall back to that question.
  const business = doingBusiness ?? (jurisdictionAnswer === 'Yes' ? 'Yes' : null);
  const overThreshold = revenueUsd >= threshold;
  const shown = revenueShown(revenueLabel, revenueUsd, revenueEntity);
  // Both legs have to hold, so a revenue figure under the threshold settles
  // it on its own — no point waiting on the doing-business tests to answer a
  // question their outcome can't change.
  if (!overThreshold) {
    return {
      verdict: 'No',
      basis: `Auto-derived: revenue ${shown} < the ${fmtUsd(threshold)} threshold, so this can't apply however the doing-business tests land. Pick a value to override.`,
    };
  }
  if (business !== 'Yes' && business !== 'No') return null;
  const verdict = business === 'Yes' ? 'Yes' : 'No';
  const revenuePart = `revenue ${shown} ≥ the ${fmtUsd(threshold)} threshold`;
  const businessPart = doingBusiness
    ? `doing business in California = ${business}`
    : `${jurisdictionLabel || 'the jurisdiction'} screened ${business === 'Yes' ? 'Yes' : 'No'}`;
  const basis = `Auto-derived: ${revenuePart}, and ${businessPart}. Both have to hold. Pick a value to override.`;
  return { verdict, basis };
}

// One criterion row's derived value, or null when nothing can be worked out
// and the user has to answer it. Mirrors the shape above: { verdict, basis }.
//   - revenue rows compare the researched revenue against their threshold
//   - the CA-operations row reads the uploaded site count
//   - the employee-count row reads the researched headcount
//   - manual rows always return null
// For a numeric row `verdict` is the figure as a string, which is what the
// input renders and what gets persisted if the user leaves it alone.
export function deriveCriterion(row, {
  revenueUsd, revenueLabel, revenueEntity, caSiteCount, employees,
  csrd, csrdNotes, cbam, cbamNotes,
} = {}) {
  // The compliance research run is the first source for a row that names a
  // field on its payload. A researched "Unknown" is treated as nothing found,
  // so the row stays open rather than parroting a non-answer.
  if (row?.fromResearch) {
    // Which of the run's payloads holds it. CSRD is the default because it
    // came first and its rows don't name one; CBAM's rows do, since the two
    // are researched from different evidence and a company can have one
    // established and the other not.
    const fromCbam = row.researchPayload === 'cbam';
    const value = (fromCbam ? cbam : csrd)?.[row.fromResearch];
    const note = String((fromCbam ? cbamNotes : csrdNotes)?.[row.fromResearch] || '').trim();
    const ok = row.kind === 'number'
      ? Number.isFinite(Number(value)) && value !== null && value !== ''
      : value === 'Yes' || value === 'No';
    if (ok) {
      const shown = row.kind === 'number' ? String(value) : value;
      const how = row.kind === 'number' ? 'Type over it' : 'Pick a value';
      return {
        verdict: shown,
        basis: `From compliance research${note ? `: ${note}` : '.'} ${how} to override.`,
      };
    }
  }
  // Headcount has a second source — the revenue research already on the card
  // reports it too, so a company researched for revenue but not yet for
  // compliance still fills this in.
  if (row?.fromEmployeeCount) {
    if (!Number.isFinite(employees)) return null;
    return {
      verdict: String(employees),
      basis: `From revenue research: ${employees.toLocaleString('en-US')} employees reported. Type over it to override.`,
    };
  }
  return deriveCaliforniaCriterion(row, { revenueUsd, revenueLabel, revenueEntity, caSiteCount });
}

export function deriveCaliforniaCriterion(row, { revenueUsd, revenueLabel, revenueEntity, caSiteCount } = {}) {
  if (row?.revenueThresholdUsd != null) {
    if (!Number.isFinite(revenueUsd)) return null;
    const verdict = revenueUsd >= row.revenueThresholdUsd ? 'Yes' : 'No';
    const shown = revenueShown(revenueLabel, revenueUsd, revenueEntity);
    return {
      verdict,
      basis: `From revenue research: ${shown} ${verdict === 'Yes' ? '≥' : '<'} ${fmtUsd(row.revenueThresholdUsd)}. Pick a value to override.`,
    };
  }
  if (row?.fromSiteCount) {
    if (!Number.isFinite(caSiteCount)) return null;
    const verdict = caSiteCount > 0 ? 'Yes' : 'No';
    return {
      verdict,
      basis: `From the uploaded site list: ${caSiteCount} site${caSiteCount === 1 ? '' : 's'} in California. Pick a value to override.`,
    };
  }
  return null;
}

// Is California ruled out on revenue alone?
//
// Every California mandate turns on two legs — a worldwide revenue threshold
// AND doing business in the state — so failing either settles it. The lowest
// threshold on the books is SB 261's $500M, so a company under that can't be
// caught by any of them, and the doing-business questions stop mattering: no
// answer to them changes the outcome. Returns the resolved revenue rows and
// the floor they were measured against, so the UI can say why.
//
// `screenedOut` needs every revenue row resolved to No — a hand-entered Yes on
// either one, or a revenue figure nobody has researched yet, leaves the
// question open rather than asserting a negative.
export function californiaRevenueScreen(answers, context) {
  const group = CALIFORNIA_CRITERIA_GROUPS.find(g => g.key === 'revenue');
  const rows = group.rows.map((row) => {
    const saved = answers?.[californiaCriterionKey(row.key)] || '';
    return saved || deriveCaliforniaCriterion(row, context)?.verdict || '';
  });
  const floor = Math.min(...group.rows.map(r => r.revenueThresholdUsd));
  return {
    screenedOut: rows.length > 0 && rows.every(v => v === 'No'),
    floor,
    floorLabel: fmtUsd(floor),
  };
}

// Does the company do business in California? "Yes" as soon as any one of
// the doing-business rows resolves Yes (hand-entered or derived); "No" only
// once every row has resolved and none of them said Yes; null while any is
// still unanswered, so a half-filled group never asserts a negative.
export function deriveDoingBusinessInCA(answers, context) {
  const group = CALIFORNIA_CRITERIA_GROUPS.find(g => g.key === 'doing-business');
  let anyUnresolved = false;
  for (const row of group.rows) {
    const saved = answers?.[californiaCriterionKey(row.key)] || '';
    const value = saved || deriveCaliforniaCriterion(row, context)?.verdict || '';
    if (value === 'Yes') return 'Yes';
    if (value !== 'No') anyUnresolved = true;
  }
  return anyUnresolved ? null : 'No';
}
