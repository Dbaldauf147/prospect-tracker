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

export const FRAMEWORKS = [
  'GRESB',
  'CDP',
  'UN PRI',
  'SBT',
  'NZAM',
];

export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];

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
      'GHG', 'Comp GHG', 'IMP', 'Rebasline project',
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
