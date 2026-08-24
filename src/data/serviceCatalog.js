// Service catalog metadata used by the Dropdowns › Services subtab.
// Each entry holds the per-service mapping the user defined: BFO Tag,
// Region, recurrence Years, Product Line, and Service Type. The
// Services subtab renders one row per service in the live Solutions
// dropdown list and looks the per-service columns up here. Missing
// services render with empty cells.

export const SERVICE_CATALOG = [
  { name: 'AP upload (indirect payment)',               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Global compliance screening',                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'API/ETL',                                    bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Arc performance certs',                      bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Assurance gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Audits',                                     bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'BBS reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Due diligence',                              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'BECS/BPS screening',                         bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Bespoke consulting SUCON',                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Bill payment',                               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'BPS Reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Budgets',                                    bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'CA SB Bills - SUCON',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Capital asset planning',                     bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring', localProjectName: '#SUESP' },
  { name: 'Cat 1 & 2',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 10',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 11',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 12',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 13',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 14',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 15',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 4',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 8',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 9',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP biodiversity',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP biodiversity risk assessment',           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP climate',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP plastics',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP water',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP water risk assessment',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Client sends invoices',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Climate risk & opportunity assessment SUCON', bfoTag: '#SUECO', region: 'NAM',   years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk disclosure SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk gap analysis',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk scenario analysis SUCON',       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Comp GHG',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Corporate Compliance Screening',             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'CSRD - DMA - SUCON',                         bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'CSRD readiness',                             bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Demand response',                            bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Deposit recovery',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'E.E.D.',                                     bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'EAC procurement - pull through',             bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'EAC/Offset Advisory',                        bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring', localProjectName: '#SUREN' },
  { name: 'ECH',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'ECLR - SUCON',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Ecovadis',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'ENERGY STAR cert',                           bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Enterprise workshop',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'ESG marketing',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESG module',                                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'ESG report',                                 bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESOS',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESPM link',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'ESPM to RA',                                 bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'EV',                                         bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '-', localProjectName: '#SUESP' },
  { name: 'GHG',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Goals & Projects',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Local Law 88',                               bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'GRESB fully managed',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRESB quant',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRESB scorecards',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRI',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Historical invoices',                        bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'IDM',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'IMP',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Insight sourcing',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Invoice collection',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Invoice recalculation',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Invoice variance testing',                   bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'LEED',                                       bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Manual data upload',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Materiality assessment SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Open/Close',                                 bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Other',                                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '-', localProjectName: '#SUSUP' },
  { name: 'Partner scope',                              bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Peak alerts',                                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Peer benchmarking SUCON',                    bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Power Availability Tool',                    bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'PPA/VPPA',                                   bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring', localProjectName: '#SUREN' },
  { name: 'Procurement contract review',                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Professional sourcing',                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Pull through',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'RA AV report',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'RA dashboards & reporting',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'RA internal data feed',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'RA survey',                                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'RADAR',                                      bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Rate optimization',                          bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Rebasline project',                          bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Remote assessments',                         bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'REOA',                                       bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'Reporting gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Risk managment',                             bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SASB',                                       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'SBT AV',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Scope 3 estimates',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Scope 3 target/roadmap SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Invoice collection - light',                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SE metering',                                bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'SECR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Sensor audit',                               bfoTag: '#DATA',  region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'SFDR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'SSO',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Strategic sourcing',                         bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Sustainability exchange SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Target setting/roadmaps SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Tax Equity - pull through',                  bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'TCFD - UK',                                  bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'UCA',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'UN PRI - SUCON',                             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'UPRs',                                       bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Utility feeds',                              bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Utility screening',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Value chain SUCON',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Waste data capture',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Water Cost Recovery',                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Ziego Activate',                             bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Hub',                                  bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Network',                              bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Power',                                bfoTag: '#SUDIG', region: 'EU',     years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'ISO 50001',                                  bfoTag: '#SUESP', region: 'EU',     years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'Microgrid Advisor',                          bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: 'Recurring', localProjectName: '' },
  { name: 'Tax Matrix - pull through',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Building Activate',                          bfoTag: '-',      region: '-',      years: '3 years', productLine: '-',                               serviceType: 'Project', localProjectName: '-' },
  { name: 'EaaS - pull through',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring', localProjectName: '#SUESP' },
  { name: 'ClimVar - EcoAct',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '', localProjectName: '#SUSUP' },
  { name: 'RA + - pull through',                        bfoTag: '#SUSUP', region: '',       years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '', localProjectName: '#SUSUP' },
  { name: 'Nature + Biodiversity',                      bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: '', localProjectName: '' },
  { name: 'EPS',                                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '', localProjectName: '#SUESP' },
  { name: 'Recap - CRREM tool',                         bfoTag: '#SUSUP', region: 'Global', years: '4 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SE Bill Pay',                                bfoTag: '#DATA',  region: 'EU',     years: '',        productLine: '',                                serviceType: '-', localProjectName: '#DATA' },
  // Graveyard — kept for reference; flagged so the UI can render them
  // muted / sorted to the bottom when needed.
  { name: 'WELL',              bfoTag: '#SUECO', region: '-',      years: '', productLine: '', serviceType: '-', localProjectName: '#SUECO', graveyard: true },
  { name: 'Incentives/taxes',  bfoTag: '-',      region: '-',      years: '', productLine: '', serviceType: '-', localProjectName: '-', graveyard: true },
  { name: 'SEC Reporting',     bfoTag: '#SUECO', region: 'Dead',   years: '', productLine: '', serviceType: '',  localProjectName: '#SUECO', graveyard: true },
  { name: 'IREM',              bfoTag: '#SUSUP', region: 'Dead',   years: '', productLine: '', serviceType: '-', localProjectName: '#SUSUP', graveyard: true },
  { name: 'KPI',               bfoTag: '#SUECO', region: 'Global', years: '', productLine: '', serviceType: '-', localProjectName: '#SUECO', graveyard: true },
  { name: 'Greenstruxure',     bfoTag: '#SUESP', region: '-',      years: '', productLine: '', serviceType: '',  localProjectName: '#SUESP', graveyard: true },
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
// them via settings.serviceOverrides. Local Project Name has no seed —
// it's a user-supplied label that flows into the AI Prompt (New BFO
// Opp) prompt block. Timeline Driven (yes/no) and Rollout Time (a number
// of weeks) also have no seed — they're user-supplied and default to
// empty.
export const SERVICE_EDITABLE_FIELDS = [
  'bfoTag', 'region', 'years', 'productLine', 'serviceType', 'localProjectName',
  'timelineDriven', 'rolloutTime', 'dependsOn',
];

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
  return {
    name,
    bfoTag:           override?.bfoTag           ?? seed?.bfoTag           ?? '',
    region:           override?.region           ?? seed?.region           ?? '',
    years:            override?.years            ?? seed?.years            ?? '',
    productLine:      override?.productLine      ?? seed?.productLine      ?? '',
    serviceType:      override?.serviceType      ?? seed?.serviceType      ?? '',
    localProjectName: override?.localProjectName ?? seed?.localProjectName ?? '',
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
// under), or '' when it has none. The dash is the app's blank sentinel
// and reads as unset here, same as an empty cell.
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
