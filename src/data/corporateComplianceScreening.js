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

// The reporting regulations gated by each jurisdiction question, keyed by
// the same `key` as JURISDICTION_QUESTIONS. `thresholds` are the
// requirement/metric pairs from the source screening matrix (numbers left
// as strings so ranges like ">0 <50,000" survive intact).
export const REGULATIONS_BY_JURISDICTION = {
  california: [
    {
      regulation: 'SB 253',
      timeline: '2026 data (reporting starts 2027)',
      description: 'Applies to companies with $1 billion+ in annual revenue doing business in California (legally formed or commercially based in California, or California sales exceeding $735,019 in the last two years).',
      // Machine-readable twin of the "1,000 Revenue (Million USD)" row
      // above — `thresholds` is display text, this is what the Applies?
      // derivation compares against. See deriveRegulationVerdict.
      revenueThresholdUsd: 1_000_000_000,
      thresholds: [
        { value: '1,000', metric: 'Revenue (Million USD)' },
        { value: '735,019', metric: 'California Sales (USD)' },
      ],
    },
    {
      regulation: 'SB 261',
      timeline: '2027 data (reporting starts 2028)',
      description: 'Applies to companies with $500 million+ in annual revenue doing business in California (legally formed or commercially based in California, or California sales exceeding $735,019 in the last two years).',
      revenueThresholdUsd: 500_000_000,
      thresholds: [
        { value: '500', metric: 'Revenue (Million USD)' },
        { value: '735,019', metric: 'California Sales (USD)' },
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
  revenueUsd, revenueLabel, jurisdictionAnswer, jurisdictionLabel,
} = {}) {
  const threshold = regulation?.revenueThresholdUsd;
  if (threshold == null) return null;
  if (jurisdictionAnswer !== 'Yes') return null;
  if (!Number.isFinite(revenueUsd)) return null;
  const verdict = revenueUsd >= threshold ? 'Yes' : 'No';
  const shown = revenueLabel || fmtUsd(revenueUsd);
  const basis = `Auto-derived: revenue ${shown} ${verdict === 'Yes' ? '≥' : '<'} the ${fmtUsd(threshold)} threshold, and ${jurisdictionLabel || 'the jurisdiction'} screened Yes. Pick a value to override.`;
  return { verdict, basis };
}
