export const STATUSES = [
  'Client',
  'Inside Sales',
  'Qualifying',
  'Hold Off',
  'Lost - Not Sold',
  'Old Client',
  'Partnering w/Another CDM',
];

export const STATUS_COLORS = {
  'Client': '#10B981',
  'Inside Sales': '#3B82F6',
  'Qualifying': '#F59E0B',
  'Hold Off': '#8B5CF6',
  'Lost - Not Sold': '#EF4444',
  'Old Client': '#6B7280',
  'Partnering w/Another CDM': '#06B6D4',
};

export const TYPES = [
  'Asset Management Firm',
  'Owner Operator',
  'Private Equity',
  'Portfolio Company',
  'Developer',
  'Facility Manager',
  'Other',
];

// PE engagement stages — only relevant when a prospect's Type is
// "Private Equity". Surfaced as a dropdown in the company popup and as
// four columns on the PE Portfolio → Portfolio sub-tab.
export const PE_STAGES = [
  'Discovery',
  'Piloting',
  'Existing Partnership',
  'Not Sold',
];

// PE investment strategies — the built-in starter vocabulary for the
// "PE Strategies" list on the Dropdowns tab (see DROPDOWN_LISTS). That
// list is the single source of truth the PE Firm sub-tab and company
// pop-up Strategies dropdowns read from; users edit it on the Dropdowns
// tab or add tags inline. Order here is the first-provided order.
export const PE_STRATEGIES = [
  'Venture Capital',
  'Real Estate + Credit',
  'Real Estate (Industrial)',
  'Buyout + Credit',
  'Real Estate (Office)',
  'Real Estate (Logistics)',
  'Real Estate (Residential)',
  'Buyout (Diversified)',
  'Real Estate (Diversified)',
  'Buyout (Industrial)',
  'Buyout (Lower-mid)',
  'Real Estate',
  'Distressed/Credit + Buyout',
  'Buyout (Tech) + Credit',
  'Buyout (Software)',
  'Growth/Buyout (Consumer)',
  'Real Estate (Data Center)',
  'Buyout (Asia)',
  'Infrastructure',
  'Buyout (Tech)',
  'Growth + Venture (Tech)',
  'Buyout (Tech/Services)',
  'Buyout (Tech/Gov)',
  'Growth Equity (Tech)',
  'Buyout (Media/Tech)',
  'Growth Equity',
  'Energy (Producer)',
  'Energy/Infra (Producer)',
];

export const GEOGRAPHIES = [
  'Global',
  'NAM',
  'State/Regional',
];

export const PUBLIC_PRIVATE = ['Public', 'Private'];

export const ASSET_TYPES = [
  'Commercial Office',
  'Multifamily',
  'Light Industrial/Logistics',
  'Retail/Mixed Use',
  'Hotels',
  'Medical Office/Senior Living',
  'Malls',
  'Single family',
  'Student Housing',
  'Life Sciences',
  'Storage',
  'Heavy Industrial',
  'Diversified',
  'Private Equity',
];

// Frameworks the Frameworks dropdown in the prospect modal offers.
// Kept in sync with LIST_FLAG_SOURCES so the modal and the My Accounts
// Frameworks column read from the same vocabulary.
// The Frameworks multi-select on the company card. A superset of
// LIST_FLAG_SOURCES: every label there is backed by an uploaded Lists-page
// file that can auto-flag a company, while IFRS and TCFD have no such list
// and are recorded by hand or by the sustainability research. They live
// here because "has this company reported under it" is the same question
// for all of them — see REPORTING_FRAMEWORKS in utils/reportingFrameworks.
export const FRAMEWORKS = [
  'Largest',
  'RECA',
  'CSRD',
  'IFRS',
  'TCFD',
  'CDP',
  'GRESB',
  'SBT',
  'Ecovadis',
  'UN PRI',
  'CA SB',
  'NZAM',
];

export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];

export const COUNTRIES = [
  'United States', 'Canada', 'Mexico',
  'United Kingdom', 'Ireland', 'France', 'Germany', 'Spain', 'Italy', 'Portugal', 'Netherlands', 'Belgium', 'Luxembourg',
  'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland',
  'Poland', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia',
  'Estonia', 'Latvia', 'Lithuania',
  'Russia', 'Ukraine', 'Turkey', 'Israel',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
  'South Africa', 'Egypt', 'Nigeria', 'Kenya', 'Morocco',
  'China', 'Hong Kong', 'Taiwan', 'Japan', 'South Korea', 'India', 'Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines',
  'Australia', 'New Zealand',
  'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru',
];

export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee',
  'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
  'Puerto Rico', 'Guam', 'U.S. Virgin Islands', 'American Samoa', 'Northern Mariana Islands',
];

export const SERVICE_CATEGORIES = [
  {
    name: 'DATA',
    items: [
      'Bill payment', 'AP upload (indirect payment)', 'Invoice collection',
      'Invoice collection - light', 'Client sends invoices', 'IDM', 'API/ETL',
      'Manual data upload', 'ESPM to RA', 'Utility feeds',
      'RA internal data feed', 'Waste data capture', 'Invoice variance testing',
      'Invoice recalculation', 'Invoice recalculation - light',
    ],
  },
  {
    name: 'RA Modules',
    items: [
      'RA dashboards & reporting', 'RA AV report', 'ESPM link',
      'Goals & Projects', 'SSO', 'ECH', 'ESG module', 'RA survey',
      'Capital asset planning', 'UCA', 'Power Availability Tool', 'RA + - pull through',
    ],
  },
  {
    name: 'Traditional Energy Management',
    items: [
      'Strategic sourcing', 'Professional sourcing', 'Insight sourcing',
      'Budgets', 'Deposit recovery', 'Open/Close', 'Rate optimization',
      'Risk managment', 'Risk - progressional', 'Risk - commodity insight',
      'Demand response', 'Procurement contract review', 'Water Cost Recovery',
      'Peak Alerts', 'Renewable natural gas', 'Tax Matrix - pull through',
      'Education calls',
    ],
  },
  {
    name: 'Consulting Services',
    items: [
      'Bespoke consulting SUCON', 'Materiality assessment SUCON',
      'Peer benchmarking SUCON', 'Sustainability exchange SUCON',
      'ESG marketing', 'ESG report', 'Communication Services', 'Due Diligence',
    ],
  },
  {
    name: 'GHG Reporting',
    items: [
      'GHG', 'Comp GHG', 'IMP', 'Rebaseline project',
      'Assurance gap assessment',
    ],
  },
  {
    name: 'Renewables',
    items: [
      'EAC procurement - pull through', 'REOA', 'PPA/VPPA',
      'EAC/Offset Advisory', 'Tax Equity - pull through',
    ],
  },
  {
    name: 'Targets',
    items: [
      'Target setting/roadmaps SUCON', 'Scope 3 target/roadmap SUCON', 'SBT AV',
    ],
  },
  {
    name: 'Efficiency',
    items: [
      'Remote assessments', 'Audits', 'Partner scope',
      'Enterprise workshop', 'Facility Condition Assessment', 'UPRs',
      'Energy modeling', 'EPS',
    ],
  },
  {
    name: 'Scope 3',
    items: [
      'Scope 3 estimates', 'Cat 1 & 2', 'Cat 4', 'Cat 8', 'Cat 9',
      'Cat 10', 'Cat 11', 'Cat 12', 'Cat 13', 'Cat 14', 'Cat 15',
      'Cat 3, 5, 6, and 7 (part of GHG)', 'ClimFit',
    ],
  },
  {
    name: 'Climate Risk',
    items: [
      'Climate risk gap analysis', 'Climate risk & opportunity assessment',
      'Climate risk Scenario Analysis', 'Climate risk disclosure SUCON',
      'ECLR - SUCON', 'ECLR scorecards - SUCON', 'ECLR Consulting - SUCON',
    ],
  },
  {
    name: 'Value Chain Decarbonization',
    items: [
      'Value chain SUCON', 'Ziego Activate', 'Ziego Power',
      'Ziego Hub', 'Ziego Network',
    ],
  },
  {
    name: 'Investor Reporting',
    items: [
      'Reporting gap assessment', 'GRESB fully managed', 'GRESB quant',
      'GRESB scorecards', 'UN PRI - SUCON', 'CDP biodiversity risk assessment',
      'CDP biodiversity', 'CDP climate', 'CDP plastics', 'CDP water',
      'CDP water risk assessment', 'Ecovadis', 'GRI', 'SASB',
    ],
  },
  {
    name: 'Building Certifications',
    items: [
      'ENERGY STAR cert', 'Arc performance certs', 'LEED',
    ],
  },
  {
    name: 'Broader SE',
    items: [
      'EV', 'SE metering', 'Greenstruxure', 'Sensor Audit', 'EaaS',
      'Building Activate',
    ],
  },
  {
    name: 'Compliance Reporting',
    items: [
      'Corporate Compliance Screening', 'BBS reporting', 'BECS/BPS screening',
      'BPS reporting', 'Global compliance screening', 'CA SB Bills - SUCON',
      'Local Law 88',
    ],
  },
  {
    name: 'EU Compliance Reporting',
    items: [
      'CSRD readiness', 'CSRD - DMA - SUCON', 'ESOS', 'TCFD - UK',
      'E.E.D.', 'SECR', 'SFDR', 'RADAR',
    ],
  },
  {
    name: 'Partner Scopes',
    items: [
      'Metering partner', 'Audit partner', 'Virtual audit partner',
      'Pulsora', 'Electrification', 'Carbon and Energy Pricing Tool',
      'Carbon pricing scenario analysis',
    ],
  },
];

export const SERVICE_STATUSES = ['-', 'Exploring', 'Proposed', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold', 'Renewal', 'In Progress', 'N/A'];
