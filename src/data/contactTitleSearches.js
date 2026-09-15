// The title searches behind each contact persona.
//
// Seven searches, kept as they were worked out in the sheet they came from
// rather than tidied on the way in: these are the strings that get typed
// into HubSpot and ZoomInfo, so a term "corrected" here is a term that
// stops matching the people it used to. "Health and saftey", "Doesnt have"
// and "Power?" are all in the source exactly as they read below, and the
// last one is the author asking themselves a question rather than naming a
// title.
//
// A search is a scope plus one or more groups of terms. The GROUPS are the
// part worth keeping faithful: three of these columns were written with
// their own headings - "Not", "Include", "Doesnt have" - and four were
// written as a flat list of titles with no heading at all. A flat list is
// carried as one unlabelled include group rather than being given a
// heading it never had, and the page says so, because "these are the
// titles" and "these are the titles the author confirmed are the titles"
// are not the same claim.
//
// `kind` is 'include' for terms to search for and 'exclude' for terms that
// disqualify a hit. Nothing reads it yet - this page is a reference, and
// the searches are still run by hand in HubSpot - but it is the difference
// between the two halves of a column and dropping it would lose it.

export const CONTACT_TITLE_SEARCHES = [
  {
    key: 'esg',
    name: 'ESG reporting',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: 'Not',
        kind: 'exclude',
        terms: [
          'Executive assistant', 'Intern', 'Analyst', 'Tax', 'Carpenter',
          'Investing', 'Credit', 'Asia', 'Fixed income', 'Research',
          'Health and saftey', 'Beyond Net Zero', 'Sustainable Finance',
          'Trading', 'Europe', 'Underwriter', 'Analytics', 'Underwriting',
        ],
      },
      {
        label: 'Include',
        kind: 'include',
        terms: [
          'CSR', 'Decarbonization', 'ESG', 'Sustainability', 'Net Zero',
          'Carbon', 'CSO', 'Sustainable', 'Climate', 'Corporate Responsibility',
          'Renewable',
        ],
      },
    ],
  },
  {
    key: 'utilities',
    name: 'Utilities',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Energy', 'Energy Manager', 'Energy Buyer', 'Energy Procurement',
          'Energy Risk', 'Property Management', 'Chief Operating Officer',
          'Building Operations', 'Facilities', 'Facility', 'Operations',
          'Procurement', 'Utilities', 'Utility', 'Accounting',
        ],
      },
    ],
  },
  {
    key: 'procurement',
    name: 'Procurement',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Energy Manager', 'Energy Buyer', 'Energy Procurement', 'Energy Risk',
          'Chief Operating Officer', 'Building Operations', 'Facilities',
          'Facility', 'Expense Management', 'Power?', 'Utilities',
          'Energy Analyst', 'Energy Contracts Manager', 'Energy Supply Manager',
          'Strategic Sourcing Manager', 'Utility Procurement',
          'Director Facilities', 'Director Property Management',
          'Vice President Facilities', 'Vice President Property Management',
          'Senior VP Facilities', 'Senior VP Property Management',
          'Procurement', 'Energy Supply', 'Strategic Sourcing',
          'Chief Procurement Officer', 'Energy',
        ],
      },
    ],
  },
  {
    key: 'engineering',
    name: 'Engineering',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Chief Operating Officer', 'Building Operations', 'Facilities',
          'Facility', 'Capital Budget', 'Building Systems', 'Engineer',
          'Engineering', 'HVAC', 'Maintenance', 'Mechanical', 'Operations',
        ],
      },
    ],
  },
  {
    key: 'climate-risk',
    name: 'Climate Risk',
    scope: 'North American Contacts Only',
    groups: [
      {
        label: '',
        kind: 'include',
        terms: [
          'Chief Compliance Officer', 'Chief Risk Officer',
          'Chief Risk and Compliance Officer', 'Director of Risk Management',
          'Compliance Manager', 'Risk and Compliance Analyst',
          'Regulatory Affairs Specialist', 'Internal Auditor',
        ],
      },
    ],
  },
  {
    key: 'private-equity',
    name: 'Private Equity',
    scope: 'North American Contacts Only',
    groups: [
      { label: 'Not', kind: 'exclude', terms: ['Human resources', 'Talent'] },
      {
        label: 'Include',
        kind: 'include',
        terms: [
          'Chief Transformation Officer', 'Head of Portfolio Operations',
          'Operating Partner', 'Operational Excellence', 'Portfolio Company',
          'Portfolio Operations', 'Portfolio Performance',
          'Portfolio Transformation', 'Procurement Director',
          'Strategic Sourcing Lead', 'Value Creation', 'Vendor Management',
          'Partnership', 'Chief Operating Officer', 'Operating Vice President',
        ],
      },
    ],
  },
  {
    key: 'cfo',
    name: 'CFO',
    scope: 'North American Contacts Only',
    groups: [
      { label: '', kind: 'include', terms: ['Chief Financial Officer', 'CFO'] },
      {
        label: 'Doesnt have',
        kind: 'exclude',
        terms: [
          'Does not include EMEA', 'Asia', 'Europe', 'Executive Assistant',
          'China', 'Credit', 'Fund',
        ],
      },
    ],
  },
];

// Every term in one search, both halves, for the search box on the page.
export function searchTerms(entry) {
  return (entry?.groups || []).flatMap(g => g.terms || []);
}

// How many terms a search carries, said on its card so two columns of
// chips can be told apart at a glance.
export function termCount(entry) {
  return searchTerms(entry).length;
}
