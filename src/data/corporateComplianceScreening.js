// Corporate Compliance screening — the jurisdiction gating questions and
// the regulation thresholds behind them.
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
export const REGULATIONS_BY_JURISDICTION = {
  california: [
    {
      regulation: 'SB 253',
      timeline: '2026 data (reporting starts 2027)',
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
      timeline: '2027 data (reporting starts 2028)',
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
      regulation: 'CSRD — Wave 1',
      timeline: '2024 data (reporting starts 2025)',
      description: 'Large entities with securities listed on an EU regulated market meeting the new thresholds: more than 1,000 employees and a net turnover of EUR 450 million or more.',
      thresholds: [
        { value: '1,000', metric: 'Employees' },
        { value: '450', metric: 'Global Net Turnover (Million EUR)' },
      ],
    },
    {
      regulation: 'CSRD — Wave 2',
      timeline: '2027 data (reporting starts 2028)',
      description: 'Large entities present in the EU meeting both criteria: more than 1,000 employees and a net turnover of EUR 450 million or more.',
      thresholds: [
        { value: '1,000', metric: 'Employees' },
        { value: '450', metric: 'Global Net Turnover (Million EUR)' },
      ],
    },
    {
      regulation: 'CSRD — Wave 3',
      timeline: '2028 data (reporting starts 2029)',
      description: 'Large non-EU entities: a net turnover of EUR 450 million or more in the EU and at least one EU subsidiary or branch with over EUR 200 million net turnover.',
      thresholds: [
        { value: '450', metric: 'EU Net Turnover (Million EUR)' },
        { value: '200', metric: 'EU subsidiary net turnover (Million EUR)' },
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
      description: 'Files a financial report with ASIC (Part 2M, Corporations Act 2001) AND meets two of three: consolidated revenue ≥ AUD 500M, gross assets ≥ AUD 1B, ≥ 500 employees — OR reports to NGER with ≥ 50,000 tonnes CO2e.',
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
      description: 'Files a financial report with ASIC AND is a registered scheme, registrable superannuation entity, or retail CCIV AND meets two of three: consolidated revenue ≥ AUD 200M, gross assets ≥ AUD 500M, ≥ 250 employees — OR reports to NGER — OR is an asset owner with over AUD 5B in AUM.',
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
      regulation: 'Mexico — CNBV',
      timeline: '2025 data (reporting starts 2026)',
      description: 'Security issuer.',
      thresholds: [],
    },
  ],
  brazil: [
    {
      regulation: 'Brazil — CVM',
      timeline: '2026 data (reporting starts 2027)',
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
//   'research' — derived from the revenue research already on the card
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
    // Only asked once the company is actually in the EU — unlike California's
    // rows, these aren't how you answer the jurisdiction question, they're
    // what CSRD screens on after it's answered Yes.
    showWhenTriggered: true,
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
];

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

function fmtUsd(n) {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

// Derive one regulation's Applies? verdict. Returns { verdict, basis } — the
// basis explains the call in the tooltip — or null when it isn't derivable:
// no revenue threshold on this regulation, no revenue figure researched yet,
// or the jurisdiction gate itself isn't a firm Yes. A "Yes" jurisdiction is
// required because the revenue test alone doesn't create the obligation; the
// company also has to do business there.
export function deriveRegulationVerdict(regulation, {
  revenueUsd, revenueLabel, jurisdictionAnswer, jurisdictionLabel, doingBusiness,
} = {}) {
  const threshold = regulation?.revenueThresholdUsd;
  if (threshold == null) return null;
  if (!Number.isFinite(revenueUsd)) return null;
  // California's detail rows settle "doing business" properly (operations,
  // sales, domicile — any one of them). When they've been answered, that
  // beats the jurisdiction question, which only asks whether the company
  // operates or sells there at all. Otherwise fall back to that question.
  const business = doingBusiness ?? (jurisdictionAnswer === 'Yes' ? 'Yes' : null);
  if (business !== 'Yes' && business !== 'No') return null;
  const overThreshold = revenueUsd >= threshold;
  const verdict = overThreshold && business === 'Yes' ? 'Yes' : 'No';
  const shown = revenueLabel || fmtUsd(revenueUsd);
  const revenuePart = `revenue ${shown} ${overThreshold ? '≥' : '<'} the ${fmtUsd(threshold)} threshold`;
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
  revenueUsd, revenueLabel, caSiteCount, employees, csrd, csrdNotes,
} = {}) {
  // The compliance research run is the first source for a row that names a
  // field on its payload. A researched "Unknown" is treated as nothing found,
  // so the row stays open rather than parroting a non-answer.
  if (row?.fromResearch) {
    const value = csrd?.[row.fromResearch];
    const note = String(csrdNotes?.[row.fromResearch] || '').trim();
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
  return deriveCaliforniaCriterion(row, { revenueUsd, revenueLabel, caSiteCount });
}

export function deriveCaliforniaCriterion(row, { revenueUsd, revenueLabel, caSiteCount } = {}) {
  if (row?.revenueThresholdUsd != null) {
    if (!Number.isFinite(revenueUsd)) return null;
    const verdict = revenueUsd >= row.revenueThresholdUsd ? 'Yes' : 'No';
    const shown = revenueLabel || fmtUsd(revenueUsd);
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
