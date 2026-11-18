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
//   { divider: true }  a separator line.
export const TARGET_WEB_SEARCHES = [
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
