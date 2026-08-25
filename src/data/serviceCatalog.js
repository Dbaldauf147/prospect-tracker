// Service catalog metadata used by the Dropdowns › Services subtab.
// Each entry holds the per-service mapping the user defined: BFO Tag,
// Region, recurrence Years, Product Line, and Service Type. The
// Services subtab renders one row per service in the live Solutions
// dropdown list and looks the per-service columns up here. Missing
// services render with empty cells.
//
// BFO Tag and Local Project Name used to be two seeded fields holding the
// same string on every row — one field wearing two names. They're merged
// into `bfoTag` here; see mergedBfoTag(), which reads either stored key
// and hands the value back under both names.
//
// A service's bucket isn't here: it's which box the services board files it
// in, which lives in the board layout (src/utils/serviceCategoriesStore.js)
// rather than as per-service metadata.

export const SERVICE_CATALOG = [
  { name: 'AP upload (indirect payment)',               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Global compliance screening',                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'API/ETL',                                    bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Arc performance certs',                      bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Assurance gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Audits',                                     bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project' },
  { name: 'BBS reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Due diligence',                              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'BECS/BPS screening',                         bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Bespoke consulting SUCON',                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Bill payment',                               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'BPS Reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Budgets',                                    bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CA SB Bills - SUCON',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Capital asset planning',                     bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring' },
  { name: 'Cat 1 & 2',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 10',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 11',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 12',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 13',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 14',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 15',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 4',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 8',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Cat 9',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP biodiversity',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP biodiversity risk assessment',           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP climate',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP plastics',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP water',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'CDP water risk assessment',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Client sends invoices',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Climate risk & opportunity assessment SUCON', bfoTag: '#SUECO', region: 'NAM',   years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Climate risk disclosure SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Climate risk gap analysis',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Climate risk scenario analysis SUCON',       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Comp GHG',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Corporate Compliance Screening',             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'CSRD - DMA - SUCON',                         bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'CSRD readiness',                             bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Demand response',                            bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Deposit recovery',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'E.E.D.',                                     bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'EAC procurement - pull through',             bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project' },
  { name: 'EAC/Offset Advisory',                        bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring' },
  { name: 'ECH',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'ECLR - SUCON',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring' },
  { name: 'Ecovadis',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'ENERGY STAR cert',                           bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Enterprise workshop',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project' },
  { name: 'ESG marketing',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'ESG module',                                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'ESG report',                                 bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'ESOS',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'ESPM link',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'ESPM to RA',                                 bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'EV',                                         bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '-' },
  { name: 'GHG',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Goals & Projects',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Local Law 88',                               bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'GRESB fully managed',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'GRESB quant',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'GRESB scorecards',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'GRI',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Historical invoices',                        bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'IDM',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'IMP',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Insight sourcing',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Invoice collection',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Invoice recalculation',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Invoice variance testing',                   bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'LEED',                                       bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Manual data upload',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Materiality assessment SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Open/Close',                                 bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Other',                                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '-' },
  { name: 'Partner scope',                              bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Peak alerts',                                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Peer benchmarking SUCON',                    bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Power Availability Tool',                    bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'PPA/VPPA',                                   bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring' },
  { name: 'Procurement contract review',                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Professional sourcing',                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Pull through',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'RA AV report',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'RA dashboards & reporting',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'RA internal data feed',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'RA survey',                                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'RADAR',                                      bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Rate optimization',                          bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Rebasline project',                          bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Remote assessments',                         bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project' },
  { name: 'REOA',                                       bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project' },
  { name: 'Reporting gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Risk managment',                             bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'SASB',                                       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'SBT AV',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Scope 3 estimates',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Scope 3 target/roadmap SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Invoice collection - light',                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'SE metering',                                bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'SECR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Sensor audit',                               bfoTag: '#DATA',  region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'SFDR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'SSO',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Strategic sourcing',                         bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Sustainability exchange SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Target setting/roadmaps SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project' },
  { name: 'Tax Equity - pull through',                  bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project' },
  { name: 'TCFD - UK',                                  bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'UCA',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'UN PRI - SUCON',                             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring' },
  { name: 'UPRs',                                       bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Utility feeds',                              bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Utility screening',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project' },
  { name: 'Value chain SUCON',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring' },
  { name: 'Waste data capture',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Water Cost Recovery',                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Ziego Activate',                             bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring' },
  { name: 'Ziego Hub',                                  bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring' },
  { name: 'Ziego Network',                              bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring' },
  { name: 'Ziego Power',                                bfoTag: '#SUDIG', region: 'EU',     years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring' },
  { name: 'ISO 50001',                                  bfoTag: '#SUESP', region: 'EU',     years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project' },
  { name: 'Microgrid Advisor',                          bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: 'Recurring' },
  { name: 'Tax Matrix - pull through',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'Building Activate',                          bfoTag: '-',      region: '-',      years: '3 years', productLine: '-',                               serviceType: 'Project' },
  { name: 'EaaS - pull through',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring' },
  { name: 'ClimVar - EcoAct',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '' },
  { name: 'RA + - pull through',                        bfoTag: '#SUSUP', region: '',       years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '' },
  { name: 'Nature + Biodiversity',                      bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: '' },
  { name: 'EPS',                                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '' },
  { name: 'Recap - CRREM tool',                         bfoTag: '#SUSUP', region: 'Global', years: '4 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring' },
  { name: 'SE Bill Pay',                                bfoTag: '#DATA',  region: 'EU',     years: '',        productLine: '',                                serviceType: '-' },
  // Graveyard — kept for reference; flagged so the UI can render them
  // muted / sorted to the bottom when needed.
  { name: 'WELL',              bfoTag: '#SUECO', region: '-',      years: '', productLine: '', serviceType: '-', graveyard: true },
  { name: 'Incentives/taxes',  bfoTag: '-',      region: '-',      years: '', productLine: '', serviceType: '-', graveyard: true },
  { name: 'SEC Reporting',     bfoTag: '#SUECO', region: 'Dead',   years: '', productLine: '', serviceType: '',  graveyard: true },
  { name: 'IREM',              bfoTag: '#SUSUP', region: 'Dead',   years: '', productLine: '', serviceType: '-', graveyard: true },
  { name: 'KPI',               bfoTag: '#SUECO', region: 'Global', years: '', productLine: '', serviceType: '-', graveyard: true },
  { name: 'Greenstruxure',     bfoTag: '#SUESP', region: '-',      years: '', productLine: '', serviceType: '',  graveyard: true },
];

// Map from lower-cased service name → metadata so a lookup ignores
// casing drift between dropdown-list entries and the catalog data.
const SERVICE_BY_NAME = new Map(
  SERVICE_CATALOG.map(s => [s.name.toLowerCase(), s])
);

export function getServiceMetadata(name) {
  if (!name) return null;
  return SERVICE_BY_NAME.get(String(name).toLowerCase()) || null;
}

// Rollout Time is a number of weeks. It was free text before, so a value
// saved back then can be anything — "6", "6 weeks", or a range like
// "4-6 weeks". A bare number, with or without a weeks unit written after
// it, reads as that many weeks; anything else doesn't, and is left alone
// rather than guessed at.
const ROLLOUT_WEEKS_RE = /^\s*(\d+(?:\.\d+)?)\s*(?:w|wk|wks|week|weeks)?\s*$/i;

// The number of weeks a stored Rollout Time means, or null when it isn't a
// number of weeks (including empty).
export function rolloutWeeks(raw) {
  const m = ROLLOUT_WEEKS_RE.exec(String(raw ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// A Rollout Time written out with its unit, for the places that show it
// outside the Services table — where the column header isn't there to say
// what the number counts. Legacy free text passes through as written.
export function formatRolloutWeeks(raw) {
  const weeks = rolloutWeeks(raw);
  if (weeks === null) return String(raw ?? '').trim();
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

// Editable per-service fields the Dropdowns › Services subtab exposes.
// The seed values above are the defaults; the user can override any of
// them via settings.serviceOverrides. Timeline Driven (yes/no) and Rollout
// Time (a number of weeks) have no seed at all — they're user-supplied and
// default to empty. Service Bucket isn't here either: it's board layout,
// not metadata (see src/utils/serviceCategoriesStore.js).
// `localProjectName` stays listed for the overrides a user saved back when
// it was its own column — reads still honour it, writes go to `bfoTag`.
export const SERVICE_EDITABLE_FIELDS = [
  'bfoTag', 'region', 'years', 'productLine', 'serviceType', 'localProjectName',
  'timelineDriven', 'rolloutTime', 'dependsOn',
];

// BFO Tag and Local Project Name held the same "#DATA" / "#SUECO" family
// tag on every service, so they're one field now. Either stored key is
// read — a user's override under the retired `localProjectName` key still
// counts — and the merged value goes back out under both names so
// downstream readers (New BFO Opp, PE Portfolio) need no change.
function mergedBfoTag(seed, override) {
  return override?.bfoTag ?? override?.localProjectName ?? seed?.bfoTag ?? '';
}

// Merge the static seed catalog with the user's per-service overrides.
// Returns a fully-populated metadata object (every editable field
// present, even if empty) so callers don't have to defensively
// fallback themselves. `overrides` is the raw settings.serviceOverrides
// map keyed by service name (case-insensitive).
export function getEffectiveServiceMetadata(name, overrides) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  const seed = SERVICE_BY_NAME.get(key) || null;
  // Overrides are stored under the original-case name so the
  // Dropdowns view can round-trip them. Look up case-insensitively
  // to forgive casing drift between the Solutions list and the
  // stored map.
  let override = null;
  if (overrides && typeof overrides === 'object') {
    if (overrides[name]) override = overrides[name];
    else {
      for (const k of Object.keys(overrides)) {
        if (k.toLowerCase() === key) { override = overrides[k]; break; }
      }
    }
  }
  if (!seed && !override) {
    return {
      name, bfoTag: '', region: '', years: '',
      productLine: '', serviceType: '', localProjectName: '',
      timelineDriven: '', rolloutTime: '', dependsOn: '', sme: '', ktm: '',
    };
  }
  const bfoTag = mergedBfoTag(seed, override);
  return {
    name,
    bfoTag,
    region:           override?.region           ?? seed?.region           ?? '',
    years:            override?.years            ?? seed?.years            ?? '',
    productLine:      override?.productLine      ?? seed?.productLine      ?? '',
    serviceType:      override?.serviceType      ?? seed?.serviceType      ?? '',
    // The same value as bfoTag — one field, two names, kept so callers
    // that ask for a Local Project Name still get one.
    localProjectName: bfoTag,
    timelineDriven:   override?.timelineDriven   ?? seed?.timelineDriven   ?? '',
    rolloutTime:      override?.rolloutTime      ?? seed?.rolloutTime      ?? '',
    // Services that have to be rolled out before this one can start,
    // as a comma-separated list of Solutions names. No seed — the
    // dependencies are whatever the user maps on the Services tab.
    dependsOn:        override?.dependsOn        ?? seed?.dependsOn        ?? '',
    // Free text: the Schneider subject-matter expert for this service. No
    // seed value — it's whoever the user names on the Services tab.
    sme:              override?.sme              ?? seed?.sme              ?? '',
    // Free text, same as SME and with no seed value: whatever the user
    // records as this service's KTM on the Services tab.
    ktm:              override?.ktm              ?? seed?.ktm              ?? '',
    graveyard: seed?.graveyard || false,
  };
}

// A service's Local Project Name (the "#SUECO" / "#DATA" family it bills
// under), or '' when it has none — the same value as its BFO Tag, which is
// the one field the two names now share. The dash is the app's blank
// sentinel and reads as unset here, same as an empty cell.
export function localProjectNameFor(name, overrides) {
  const raw = String(getEffectiveServiceMetadata(name, overrides)?.localProjectName || '').trim();
  return raw === '-' ? '' : raw;
}

// Every distinct Local Project Name in the effective catalog, sorted.
// Drawn from the seed catalog plus any service the user has overridden
// (which is also where a service they added themselves shows up), so a
// project family invented on the Dropdowns tab is included. Callers use
// this to build one column / bucket per project family.
export function getLocalProjectNames(overrides) {
  const names = new Set(SERVICE_CATALOG.map(s => s.name));
  if (overrides && typeof overrides === 'object') {
    for (const k of Object.keys(overrides)) names.add(k);
  }
  const projects = new Set();
  for (const n of names) {
    const p = localProjectNameFor(n, overrides);
    if (p) projects.add(p);
  }
  return [...projects].sort((a, b) => a.localeCompare(b));
}
