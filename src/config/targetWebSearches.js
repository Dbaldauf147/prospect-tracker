// The company popup's Targets tab > "Search web" menu: preset Google
// searches for finding a company's climate targets (framework, validation
// status, horizon, metric, value, base and target years, scopes) and its
// framework tags. Edit this list to add, reword or reorder searches; the
// menu (ProspectModal/TargetSearchMenu.jsx) draws whatever is here.
//
// Each entry is one of:
//   { label, query, requiresDomain? }  a Google search. `query` is a
//       template: {name} is the company's name, cleaned of legal suffixes
//       and already wrapped in double quotes; {domain} is its website's bare
//       domain ("prologis.com"). An entry with requiresDomain: true is left
//       out for a company with no website or email domain on its record.
//   { label, url }  a fixed link, opened as is.
//   { label, ai }  a free AI chat opened with TARGET_RESEARCH_PROMPT already
//       typed in. `ai` is the chat's address with {prompt} where the
//       (URL-encoded) prompt goes. No API and no cost: it is the user's own
//       free ChatGPT / Claude account doing the search.
//   { divider: true }  a separator line.
export const TARGET_WEB_SEARCHES = [
  // hints=search asks ChatGPT to search the web rather than answer from memory.
  { label: 'Ask ChatGPT for a targets table (free)', ai: 'https://chatgpt.com/?hints=search&q={prompt}' },
  { label: 'Ask Claude for a targets table (free)', ai: 'https://claude.ai/new?q={prompt}' },
  { divider: true },
  { label: 'All targets', query: '{name} net zero OR emissions reduction target scope 1 2 3 base year' },
  { label: 'SBTi status', query: '{name} SBTi science based targets validated OR committed' },
  { label: 'Sustainability report (PDF)', query: '{name} sustainability OR ESG OR impact report filetype:pdf' },
  { label: 'On their website', query: 'site:{domain} sustainability OR ESG OR "net zero"', requiresDomain: true },
  { label: 'CRREM / real estate pathway', query: '{name} CRREM pathway OR stranding' },
  { label: 'GRESB', query: '{name} GRESB score OR rating' },
  { label: 'CDP', query: '{name} CDP climate score' },
  { label: 'TCFD / climate risk', query: '{name} TCFD OR ISSB climate risk report' },
  { label: 'RE100 / renewable electricity', query: '{name} RE100 OR "renewable electricity" target' },
  { divider: true },
  // The SBTi's own search page. It takes no query parameters we can rely
  // on, so it opens the dashboard and the company is searched there.
  { label: 'SBTi Target Dashboard', url: 'https://sciencebasedtargets.org/target-dashboard' },
];

// What the two "Ask ..." entries above send. It asks for the answer as one
// table in a fixed set of columns, which Paste targets reads as is (see
// parsePastedTargets: the header names below are ones it knows, and it
// ignores the Source column). That is what makes the result the same shape
// for every company, where a search engine's summary is free prose.
// {name} is the company's name (not quoted here) and {site} is
// " (website: prologis.com)" or nothing.
export const TARGET_RESEARCH_PROMPT = `Search the web for the climate and energy targets that {name}{site} has publicly set. Check the SBTi target dashboard (sciencebasedtargets.org) first, then the company's own sustainability or ESG report, then CDP and RE100.

Reply with ONLY one code block holding a pipe-delimited table with exactly this header row, and nothing before or after it:

Action | Target Type | Commitment Type | Year Set | Base Year | Target Year | Target Year 2 | Scope | Classification | Status | Date Published | Source

Rules:
- One row per distinct target. Never list the same target twice.
- Only forward-looking targets with a year to meet them by. Leave out progress already achieved (such as "reduced emissions 15% since 2019") and goals of a parent company or industry body.
- Action: Commitment for an SBTi commitment with no validated target yet, otherwise Target.
- Target Type: one of Net zero, Carbon neutral, SBTi near-term, SBTi long-term, Absolute emissions reduction, Emissions intensity reduction, Renewable electricity (RE100). Only if none fits, a name of three words at most.
- Commitment Type: for a Commitment only (Net-zero or Standard).
- Year Set, Base Year, Target Year: 4-digit years. Target Year 2 only for a second milestone of the same target.
- Scope: the scope numbers the target covers, such as 1, 2 or 1, 2, 3.
- Classification: 1.5°C, Well-below 2°C or 2°C.
- Status: Validated Targets (validated by SBTi), Committed (committed to SBTi) or Self-declared.
- Date Published: the date SBTi lists, as YYYY-MM-DD.
- Source: the address of the page the row came from.
- Leave a cell empty when the source does not say. Never guess.
- If the company has set no target, return the header row and one row reading: - | No target set`;
