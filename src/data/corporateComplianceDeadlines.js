// Corporate disclosure mandates — the key submission deadlines behind the
// six jurisdiction questions on the Corporate Compliance page.
//
// The Corporate Compliance page answers "does this mandate apply?".  This
// file answers the next question — "by when?" — so the Compliance Roadmap can
// put the corporate reporting dates on a timeline next to the building
// (BBS / Audits / BPS) ones.
//
// `jurisdictionKey` matches JURISDICTION_QUESTIONS[].key in
// corporateComplianceScreening.js and `regulation` matches the `regulation`
// field of the REGULATIONS_BY_JURISDICTION entry it belongs to, so a milestone
// can be traced back to the screening row that decides whether it applies.
//
// Two date fields, deliberately:
//   `due`      — an ISO date used ONLY to place the milestone on the timeline
//                axis. When `precision` is not 'exact' this is an anchor, not
//                a claim: it is the middle of the stated window, or the date
//                the linked filing is itself due.
//   `dueLabel` — what we actually assert, in words. This is what the table
//                and the chart label show. Never widen it into a hard date
//                the source doesn't support.
//
// `status` says how firm the date is, which for climate disclosure is half the
// answer — several of these have moved in the last year:
//   'fixed'    — the regulator has set this date
//   'cycle'    — no fixed calendar date; it rides the company's own annual
//                report, so it lands with that filing
//   'proposed' — consultation or rulemaking still open; date is the proposal
//   'paused'   — enforcement stayed, or the mandatory phase withdrawn
//
// Every entry carries its `source`. Re-check them before a client-facing
// deliverable: this is the most volatile reference table in the app.
// Last reviewed: 31 July 2026.

export const DEADLINE_STATUS = ['fixed', 'cycle', 'proposed', 'paused'];

export const STATUS_LABEL = {
  fixed: 'Date set',
  cycle: 'With annual report',
  proposed: 'Proposed',
  paused: 'Paused / optional',
};

// Status, not series, colours — the jurisdiction is carried by the lane a
// milestone sits in and by its label, never by colour alone, so colour is free
// to say how firm the date is. 'cycle' takes a neutral slate rather than a
// status hue: "follows the annual report" is a shape, not a warning.
export const STATUS_COLOR = {
  fixed: '#0CA30C',
  cycle: '#64748B',
  proposed: '#FAB219',
  paused: '#EC835A',
};

export const STATUS_NOTE = {
  fixed: 'The regulator has set this date.',
  cycle: 'No fixed calendar date — it lands with the company’s own annual report.',
  proposed: 'Consultation or rulemaking still open; the date is the proposal.',
  paused: 'Enforcement stayed, or the mandatory phase withdrawn.',
};

// Ordered the same way the Corporate Compliance columns are, so the roadmap
// lanes read in the same order as the screening questions.
export const DEADLINE_JURISDICTIONS = [
  { key: 'california', label: 'California', short: 'SB 253 / SB 261' },
  { key: 'eu', label: 'EU', short: 'CSRD' },
  { key: 'uk', label: 'UK', short: 'FCA / CFD / SRS' },
  { key: 'australia', label: 'Australia', short: 'ASRS' },
  { key: 'mexico', label: 'Mexico', short: 'CNBV' },
  { key: 'brazil', label: 'Brazil', short: 'CVM' },
];

export const CORPORATE_MANDATE_DEADLINES = [
  // ---- California ---------------------------------------------------------
  {
    key: 'ca-sb261-fy25',
    jurisdictionKey: 'california',
    regulation: 'SB 261',
    mandate: 'SB 261',
    chip: 'SB 261',
    shortDue: '1 Jan 2026',
    reportingOn: 'FY2025',
    due: '2026-01-01',
    dueLabel: '1 Jan 2026 — not being enforced',
    precision: 'exact',
    status: 'paused',
    requirement: 'Climate-related financial risk report (TCFD / IFRS S2) posted publicly, with the link filed to CARB’s docket.',
    note: 'The Ninth Circuit enjoined enforcement on 18 Nov 2025; CARB’s 1 Dec 2025 advisory says it will not enforce the 1 Jan 2026 statutory date and will set a replacement once the appeal is decided. The voluntary docket stayed open to 1 Jul 2026.',
    source: 'https://ww2.arb.ca.gov/sites/default/files/2025-12/Dec%201%20SB%20261%20Enforcement%20Advisory.pdf',
  },
  {
    key: 'ca-sb253-fy25',
    jurisdictionKey: 'california',
    regulation: 'SB 253',
    mandate: 'SB 253',
    chip: 'SB 253',
    shortDue: '10 Nov 2026',
    reportingOn: 'FY2025',
    due: '2026-11-10',
    dueLabel: '10 Nov 2026',
    precision: 'exact',
    status: 'fixed',
    requirement: 'Scope 1 and scope 2 emissions reported to CARB (own report, an existing voluntary/regulatory submission, or CARB’s template).',
    note: 'Originally 10 Aug 2026; CARB moved it to 10 Nov 2026 on 24 Jun 2026. Assurance is limited-level for this first cycle.',
    source: 'https://www.davispolk.com/insights/client-update/sb-253-261-update-carb-workshop-august-2026-reporting-proposed-rules-2027',
  },
  {
    key: 'ca-sb253-fy26',
    jurisdictionKey: 'california',
    regulation: 'SB 253',
    mandate: 'SB 253 — first scope 3',
    chip: 'SB 253 S3',
    shortDue: 'during 2027',
    reportingOn: 'FY2026',
    due: '2027-08-01',
    dueLabel: 'During 2027 — date set by CARB’s 2027 rulemaking',
    precision: 'window',
    status: 'proposed',
    requirement: 'Scope 1 and 2 again, plus the first scope 3 disclosure.',
    note: 'CARB’s proposed rules for the 2027 cycle were still out for comment as of mid-2026; the anchor here is the middle of that year, not a set date.',
    source: 'https://www.davispolk.com/insights/client-update/sb-253-261-update-carb-workshop-august-2026-reporting-proposed-rules-2027',
  },
  {
    key: 'ca-sb261-fy27',
    jurisdictionKey: 'california',
    regulation: 'SB 261',
    mandate: 'SB 261 — second report',
    chip: 'SB 261 #2',
    shortDue: '1 Jan 2028',
    reportingOn: 'FY2027',
    due: '2028-01-01',
    dueLabel: '1 Jan 2028 (biennial)',
    precision: 'exact',
    status: 'proposed',
    requirement: 'Second biennial climate-related financial risk report.',
    note: 'The statute is biennial from 1 Jan 2026. If the litigation shifts the first deadline, expect this one to move with it.',
    source: 'https://www.wsgr.com/en/insights/preparing-for-sb-261-climate-related-financial-risk-disclosure-reports-due-by-january-1-2026-for-covered-companies.html',
  },

  // ---- EU / CSRD ----------------------------------------------------------
  {
    key: 'eu-csrd-w1-fy25',
    jurisdictionKey: 'eu',
    regulation: 'CSRD — Wave 1',
    mandate: 'CSRD Wave 1',
    chip: 'Wave 1',
    shortDue: 'Apr 2026',
    reportingOn: 'FY2025',
    due: '2026-04-30',
    dueLabel: 'With the FY2025 annual report — 30 Apr 2026 for a 31 Dec year-end',
    precision: 'filing',
    status: 'cycle',
    requirement: 'ESRS sustainability statement inside the management report, limited assurance.',
    note: 'Wave 1 was not delayed by Omnibus I. EU-regulated-market issuers publish the annual financial report within four months of year-end.',
    source: 'https://www.sidley.com/en/insights/newsupdates/2025/04/eu-omnibus-package-eu-adopts-stop-the-clock-directive-and-begins-esrs-simplification-process',
  },
  {
    key: 'eu-csrd-w2-fy27',
    jurisdictionKey: 'eu',
    regulation: 'CSRD — Wave 2',
    mandate: 'CSRD Wave 2',
    chip: 'Wave 2',
    shortDue: '2028',
    reportingOn: 'FY2027',
    due: '2028-04-30',
    dueLabel: 'With the FY2027 annual report — first statements in 2028',
    precision: 'filing',
    status: 'fixed',
    requirement: 'First ESRS sustainability statement for large EU undertakings.',
    note: 'Omnibus I "stop the clock" pushed Wave 2 back two years (was FY2025 / 2026). Member states have until 26 Jul 2027 to transpose, so national filing mechanics may still shift.',
    source: 'https://www.simmons-simmons.com/en/publications/cm9libsoy006kulzkyxok9r04/eu-stop-the-clock-directive-enters-into-force-under-omnibus-i',
  },
  {
    key: 'eu-csrd-w3-fy28',
    jurisdictionKey: 'eu',
    regulation: 'CSRD — Wave 3',
    mandate: 'CSRD Wave 3 (non-EU groups)',
    chip: 'Wave 3',
    shortDue: '2029',
    reportingOn: 'FY2028',
    due: '2029-04-30',
    dueLabel: 'With the FY2028 reporting cycle — first statements in 2029',
    precision: 'filing',
    status: 'fixed',
    requirement: 'Group-level sustainability report for large non-EU parents, published by the EU subsidiary or branch.',
    note: 'The non-EU wave was not moved by Omnibus I.',
    source: 'https://www.simmons-simmons.com/en/publications/cm9libsoy006kulzkyxok9r04/eu-stop-the-clock-directive-enters-into-force-under-omnibus-i',
  },

  // ---- UK -----------------------------------------------------------------
  {
    key: 'uk-fca-fy25',
    jurisdictionKey: 'uk',
    regulation: 'UK FCA',
    mandate: 'UK FCA (UKLR, TCFD-aligned)',
    chip: 'FCA',
    shortDue: 'Apr 2026',
    reportingOn: 'FY2025',
    due: '2026-04-30',
    dueLabel: 'With the FY2025 annual financial report — within 4 months of year-end',
    precision: 'filing',
    status: 'cycle',
    requirement: 'TCFD-aligned statement in the annual financial report on a comply-or-explain basis.',
    note: 'Recurs every year until the UK SRS regime replaces it.',
    source: 'https://www.globalfinregblog.com/2026/01/fca-consults-on-uk-srs-aligned-disclosure-rules-for-uk-listings/',
  },
  {
    key: 'uk-cfd-fy25',
    jurisdictionKey: 'uk',
    regulation: 'UK CFD / SRS',
    mandate: 'UK CFD (SI 2022/31)',
    chip: 'CFD',
    shortDue: 'Jun 2026',
    reportingOn: 'FY2025',
    due: '2026-06-30',
    dueLabel: 'With the FY2025 strategic report — filed at Companies House within 6 months of year-end',
    precision: 'filing',
    status: 'cycle',
    requirement: 'Climate-related financial disclosures in the strategic report (or the directors’ report for LLPs).',
    note: 'Runs annually on the company’s own reporting cycle until UK SRS phases it out.',
    source: 'https://watershed.com/blog/uk-srs-guide',
  },
  {
    key: 'uk-srs-fy27',
    jurisdictionKey: 'uk',
    regulation: 'UK CFD / SRS',
    mandate: 'UK SRS',
    chip: 'SRS',
    shortDue: '2028',
    reportingOn: 'FY2027',
    due: '2028-04-30',
    dueLabel: 'Accounting periods from 1 Jan 2027 — first reports in 2028',
    precision: 'filing',
    status: 'proposed',
    requirement: 'UK SRS S1/S2 climate disclosures in the annual report; scope 3 comply-or-explain from periods beginning 1 Jan 2028.',
    note: 'Government adopted UK SRS on 25 Feb 2026; the FCA consulted (CP closed 20 Mar 2026) on making it mandatory for listed companies. Final rules were still pending at the time of writing.',
    source: 'https://sustainablefutures.linklaters.com/post/102mfet/uk-srs-fca-proposes-mandatory-climate-disclosures-from-2027-except-for-scope-3',
  },

  // ---- Australia ----------------------------------------------------------
  {
    key: 'au-g1-fy26',
    jurisdictionKey: 'australia',
    regulation: 'Australia Group 1',
    mandate: 'ASRS Group 1',
    chip: 'Group 1',
    shortDue: 'Sep 2026',
    reportingOn: 'FY2025 / FY2025-26',
    due: '2026-09-30',
    dueLabel: 'Sep–Oct 2026 for a 30 Jun year-end (Dec year-ends lodged early 2026)',
    precision: 'window',
    status: 'fixed',
    requirement: 'AASB S2 sustainability report lodged with ASIC under s319, Corporations Act 2001.',
    note: 'Lodgement is 3 months after year-end for disclosing entities, 4 months otherwise — so the date follows the company’s balance date rather than a fixed calendar day.',
    source: 'https://www.asic.gov.au/about-asic/news-centre/news-items/asic-issues-early-observations-on-sustainability-reporting-ahead-of-30-june-2026/',
  },
  {
    key: 'au-g2-fy27',
    jurisdictionKey: 'australia',
    regulation: 'Australia Group 2',
    mandate: 'ASRS Group 2',
    chip: 'Group 2',
    shortDue: 'Sep 2027',
    reportingOn: 'FY2026-27',
    due: '2027-09-30',
    dueLabel: 'Sep–Oct 2027 — first periods begin on/after 1 Jul 2026',
    precision: 'window',
    status: 'fixed',
    requirement: 'First AASB S2 sustainability report lodged with ASIC.',
    note: 'Same lodgement mechanics as Group 1.',
    source: 'https://www.pitcher.com.au/insights/why-group-2-and-group-3-entities-should-start-asrs-preparation-early/',
  },
  {
    key: 'au-g3-fy28',
    jurisdictionKey: 'australia',
    regulation: 'Australia Group 3',
    mandate: 'ASRS Group 3',
    chip: 'Group 3',
    shortDue: 'Sep 2028',
    reportingOn: 'FY2027-28',
    due: '2028-09-30',
    dueLabel: 'Sep–Oct 2028 — first periods begin on/after 1 Jul 2027',
    precision: 'window',
    status: 'fixed',
    requirement: 'First AASB S2 sustainability report lodged with ASIC (climate statements only where there is no material climate risk).',
    note: 'Same lodgement mechanics as Group 1.',
    source: 'https://www.pitcher.com.au/insights/why-group-2-and-group-3-entities-should-start-asrs-preparation-early/',
  },

  // ---- Mexico -------------------------------------------------------------
  {
    key: 'mx-cnbv-fy25',
    jurisdictionKey: 'mexico',
    regulation: 'Mexico — CNBV',
    mandate: 'CNBV / NIS (IFRS S1–S2)',
    chip: 'CNBV',
    shortDue: '30 Apr 2026',
    reportingOn: 'FY2025',
    due: '2026-04-30',
    dueLabel: 'With the FY2025 annual report (reporte anual), due 30 Apr 2026',
    precision: 'filing',
    status: 'fixed',
    requirement: 'Standalone sustainability report on IFRS S1 and S2, filed with the annual report to CNBV / BMV / BIVA.',
    note: 'First mandatory cycle. No external assurance required for FY2025.',
    source: 'https://www.gtlaw.com/en/insights/2025/6/normas-de-informacion-de-sostenibilidad-2024',
  },
  {
    key: 'mx-cnbv-fy26',
    jurisdictionKey: 'mexico',
    regulation: 'Mexico — CNBV',
    mandate: 'CNBV — limited assurance',
    chip: 'CNBV +LA',
    shortDue: '30 Apr 2027',
    reportingOn: 'FY2026',
    due: '2027-04-30',
    dueLabel: 'With the FY2026 annual report, due 30 Apr 2027',
    precision: 'filing',
    status: 'fixed',
    requirement: 'Same report, now accompanied by a limited-assurance opinion from an external auditor.',
    note: 'Assurance steps up to reasonable assurance for FY2027 (filed 2028).',
    source: 'https://www.forvismazars.com/mx/en/insights/forvis-mazars-in-mexico-thought-leadership/sustainability-alert/nis-in-mexico-2026',
  },

  // ---- Brazil -------------------------------------------------------------
  {
    key: 'br-cvm-fy25',
    jurisdictionKey: 'brazil',
    regulation: 'Brazil — CVM',
    mandate: 'CVM Res. 193 (voluntary)',
    chip: 'Res. 193',
    shortDue: '30 Sep 2026',
    reportingOn: 'FY2025',
    due: '2026-09-30',
    dueLabel: 'Last day of the 9th month after year-end — 30 Sep 2026 for a 31 Dec year-end',
    precision: 'filing',
    status: 'paused',
    requirement: 'CBPS / ISSB-aligned sustainability report filed through Empresas.NET.',
    note: 'Voluntary-adoption window. The longer 9-month deadline applies to voluntary filings.',
    source: 'https://www.gov.br/cvm/en/foreign-investors/regulation-files/ResolutionCVM193.pdf',
  },
  {
    key: 'br-cvm-fy27',
    jurisdictionKey: 'brazil',
    regulation: 'Brazil — CVM',
    mandate: 'CVM comply-or-explain',
    chip: 'CVM CoE',
    shortDue: 'May 2028',
    reportingOn: 'FY2027',
    due: '2028-05-31',
    dueLabel: 'With the FY2027 Formulário de Referência — within 5 months of year-end',
    precision: 'filing',
    status: 'paused',
    requirement: 'Report, or publish a formal justification for not reporting (pratique ou explique).',
    note: 'CVM Resolution 244 (published 1 Jun 2026) removed the mandatory phase that would have applied to years beginning on/after 1 Jan 2026; comply-or-explain runs from 1 Jan 2027 instead.',
    source: 'https://www.cascione.com.br/en/cvm-torna-opcional-para-companhias-abertas-a-divulgacao-de-relatorio-de-sustentabilidade/',
  },
];

// ---- Derivations -----------------------------------------------------------

const parseISO = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? new Date(Date.UTC(y, m - 1, d)) : null;
};

export function quarterLabelOf(iso) {
  const [y, m] = String(iso || '').split('-').map(Number);
  if (!y || !m) return '';
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

// The milestones for a set of jurisdictions, earliest first. `jurisdictions`
// null/undefined means all six; an empty array means none.
export function mandateDeadlines(jurisdictions) {
  const keep = jurisdictions == null ? null : new Set(jurisdictions);
  return CORPORATE_MANDATE_DEADLINES
    .filter(d => keep == null || keep.has(d.jurisdictionKey))
    .slice()
    .sort((a, b) => a.due.localeCompare(b.due) || a.mandate.localeCompare(b.mandate));
}

// The next milestone still ahead of `today` (an ISO date string), or null.
// A paused mandate whose date has already slipped isn't "next" — it has no
// live date at all — so those are skipped once their anchor is in the past.
export function nextMandateDeadline(deadlines, today) {
  const now = String(today || '');
  return deadlines.find(d => d.due >= now && d.status !== 'paused')
    || deadlines.find(d => d.due >= now)
    || null;
}

// Days from `today` to a milestone, negative once it has passed. Null when
// either date can't be read.
export function daysUntil(iso, today) {
  const a = parseISO(today);
  const b = parseISO(iso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86_400_000);
}

// Milestones grouped into the lanes the roadmap chart draws — one lane per
// jurisdiction, in DEADLINE_JURISDICTIONS order, dropping jurisdictions with
// nothing to show.
export function mandateLanes(deadlines) {
  const byKey = new Map();
  for (const d of deadlines) {
    if (!byKey.has(d.jurisdictionKey)) byKey.set(d.jurisdictionKey, []);
    byKey.get(d.jurisdictionKey).push(d);
  }
  return DEADLINE_JURISDICTIONS
    .filter(j => byKey.has(j.key))
    .map(j => ({ ...j, items: byKey.get(j.key) }));
}

// Count of milestones per status, for the legend.
export function statusCounts(deadlines) {
  const out = {};
  for (const s of DEADLINE_STATUS) out[s] = 0;
  for (const d of deadlines) out[d.status] = (out[d.status] || 0) + 1;
  return out;
}
