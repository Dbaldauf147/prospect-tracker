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
export const SCREENING_ANSWERS = ['Yes', 'No'];

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
      thresholds: [
        { value: '1,000', metric: 'Revenue (Million USD)' },
        { value: '735,019', metric: 'California Sales (USD)' },
      ],
    },
    {
      regulation: 'SB 261',
      timeline: '2027 data (reporting starts 2028)',
      description: 'Applies to companies with $500 million+ in annual revenue doing business in California (legally formed or commercially based in California, or California sales exceeding $735,019 in the last two years).',
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
