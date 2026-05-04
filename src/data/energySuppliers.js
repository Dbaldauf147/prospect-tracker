// Top US/Canada competitive retail electricity & natural gas suppliers
// (canonical brand names). When a vendor string from a sites file
// fuzzy-matches one of these, the row's Supplier column gets the
// canonical name back so cosmetic variations ("Reliant", "Reliant
// Energy", "Reliant Energy LLC") collapse to a single value.
//
// Sourced from the user-supplied top-100 lists. Subsidiary brands
// stay listed separately on purpose — customers see "TXU" or
// "Reliant" on their bill, not "Vistra Corp", so the Supplier
// column should match what's printed.

export const ENERGY_SUPPLIERS = [
  // --- Top-level retail aggregators (parent brands) ---
  'NRG Energy',
  'Vistra Energy',
  'Constellation NewEnergy',
  'Constellation Home',
  'Constellation NewEnergy Canada',
  'Constellation NewEnergy-Gas',

  // --- NRG family ---
  'Reliant Energy',
  'Direct Energy',
  'Direct Energy Business Marketing',
  'Direct Energy Regulated Services',
  'Green Mountain Energy',
  'Stream Energy',
  'XOOM Energy',
  'Cirro Energy',
  'Bounce Energy',
  'First Choice Power',
  'Energy Plus',
  'Energy Plus Natural Gas',
  'MxEnergy',

  // --- Vistra family ---
  'TXU Energy',
  'Energy Harbor',
  'Ambit Energy',
  'Public Power LLC',
  '4Change Energy',
  'Veteran Energy',
  'Express Energy',
  'Vistra Retail',

  // --- Just Energy family ---
  'Just Energy',
  'Just Energy Canada',
  'Hudson Energy',
  'Hudson Energy Services',
  'Tara Energy',
  'Amigo Energy',
  'Summitt Energy',
  'Universal Energy',

  // --- Engie family ---
  'Engie Resources',
  'Engie North America',
  'ENGIE Insight',
  'Tradition Energy',
  'ENGIE Resources Mass Market',
  'ENH Power',

  // --- Shell family ---
  'Shell Energy Solutions',
  'Shell Energy North America',
  'MP2 Energy',
  'Pulse Power',

  // --- Calpine family ---
  'Calpine Energy Solutions',
  'Champion Energy Services',

  // --- Spark / Via Renewables family ---
  'Spark Energy',
  'Major Energy',
  'North American Power',
  'Verde Energy USA',
  'Provision Power & Gas',
  'Via Renewables',

  // --- Genie Energy family ---
  'IDT Energy',
  'Genie Retail Energy',
  'Town Square Energy',
  'Residents Energy',

  // --- Renewable / boutique retailers ---
  'Inspire Clean Energy',
  'Inspire Energy',
  'Arcadia Power',
  'CleanChoice Energy',
  'CleanSky Energy',
  'Clearview Energy',
  'Bullfrog Power',
  'Chariot Energy',
  'Rhythm Energy',
  'Kiwi Energy',
  'Octopus Energy US',
  'David Energy',
  'OhmConnect Energy',

  // --- Texas REPs ---
  'Frontier Utilities',
  'Discount Power',
  'Payless Power',
  'Gexa Energy',
  'Energy Texas',
  'Goodcharlie Energy',
  'Acacia Energy',
  'Now Power',
  'Cricket Valley Power Retail',

  // --- Utility-affiliated competitive retail ---
  'AEP Energy',
  'WGL Energy Services',
  'DTE Energy Trading',
  'MidAmerican Energy Services',
  'UGI Energy Services',
  'National Fuel Resources',
  'New Jersey Resources Energy Services',
  'South Jersey Industries Energy Services',
  'South Jersey Resources Group',
  'Dominion Energy Solutions',
  'PSE&G Energy Services',
  'Public Service of NM Retail',
  'PNM',

  // --- Multi-state mid-size ---
  'APG&E',
  'American PowerNet',
  'Mansfield Power & Gas',
  'Mansfield Energy',
  'Gateway Energy Services',
  'Sprague Operating Resources',
  'BlueRock Energy',
  'Agway Energy Services',
  'Glacial Energy',
  'Indra Energy',
  'PALMco Energy',
  'Power Choice',
  'Liberty Power',
  'Liberty Utilities Retail',
  'Smart Energy',
  'SmartEnergy',
  'Volo Energy',
  'Marathon Power',
  'Plymouth Rock Energy',
  'Atlantic Energy',
  'Source Power & Gas',
  'Provider Power',
  'Electricity Maine',
  'Ampion',
  'Snapping Shoals EMC Retail',
  'Volunteer Energy Services',
  'RushMore Energy',
  'Santanna Energy Services',
  'Centrica Business Solutions',
  'Hess Corporation Energy Marketing',
  'Interstate Gas Supply',
  'IGS Energy',
  'Energy Cooperative of America',

  // --- Canadian retailers ---
  'ENMAX Energy',
  'EPCOR Energy Alberta',
  'ATCO Energy',
  'UTILITYnet',
  'Spot Power',
  'Encor',
  'Planet Energy',
  'MyRate Energy',
  'Rogers Energy',
  'Active Energy',
  'TransAlta Energy Marketing',
  'Capital Power Energy Marketing',
  'Bruce Power Direct',

  // --- Gas wholesale marketers / producers (often appear on C&I
  //     gas bills as the "supplier" since they run the marketing
  //     desk that contracts with end users) ---
  'Tenaska Marketing Ventures',
  'BP Energy Company',
  'Macquarie Energy',
  'ConocoPhillips',
  'EQT Corporation',
  'Southwestern Energy',
  'Chesapeake Energy',
  'Expand Energy',
  'Expand Energy Marketing',
  'EDF Trading North America',
  'J. Aron',
  'Goldman Sachs Commodities',
  'Citadel Energy',
  'Vitol',
  'Mercuria Energy Trading',
  'Trafigura',
  'Castleton Commodities',
  'Sequent Energy Management',
  'ExxonMobil Gas & Power Marketing',
  'Chevron Natural Gas',
  'Coterra Energy',
  'Range Resources',
  'Antero Resources',
  'CNX Resources',
  'Ovintiv',
  'Canadian Natural Resources',
  'CNRL',
  'TC Energy Marketing',
  'Enbridge Marketing',
  'Cenovus Energy Marketing',
  'Suncor Energy Marketing',
  'ARC Resources',
  'Diversified Energy Company',
  'Comstock Resources',
  'Rockies Express Pipeline Marketing',
  'Energy Transfer Marketing',
  'Williams Northwest Pipeline',
  'Kinder Morgan Marketing',
  'Targa Resources Marketing',
  'DCP Midstream Marketing',
  'Pioneer Natural Resources',
];
