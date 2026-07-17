// Dan's strategic (Tier 1 / Tier 2) account tiers, extracted so both the
// My Accounts view and the Pipeline Excel export resolve tiers the same way.
// The hardcoded map mirrors Dan's named strategic accounts; findTier does a
// case-insensitive exact-then-prefix match on the company name.

// Dan's tiered account names (normalized lowercase for matching)
export const MY_ACCOUNTS = new Map([
  ['blue owl capital', 'Tier 1'],
  ['brookfield asset management', 'Tier 1'],
  ['cbre investment management', 'Tier 1'],
  ['cerberus capital management', 'Tier 1'],
  ['nationwide', 'Tier 1'],
  ['goldman sachs asset management', 'Tier 1'],
  ['hellman & friedman', 'Tier 1'],
  ['jones lang lasalle (jll)', 'Tier 1'],
  ['jp morgan asset management real estate', 'Tier 1'],
  ['nuveen real estate, a tiaa co.', 'Tier 1'],
  ['pnc', 'Tier 1'],
  ['prologis', 'Tier 1'],
  ['simon property group', 'Tier 1'],
  ['thoma bravo', 'Tier 1'],
  ['ventas', 'Tier 1'],
  ['ameriprise financial', 'Tier 2'],['affinius capital, a usaa co.', 'Tier 2'],['affinius capital', 'Tier 2'],
  ['american homes 4 rent', 'Tier 2'],['article student living', 'Tier 2'],['article student living, llc', 'Tier 2'],
  ['bank ozk', 'Tier 2'],['bok financial', 'Tier 2'],['berkeley partners', 'Tier 2'],
  ['chubb, ltd.', 'Tier 2'],['cibc', 'Tier 2'],['eos hospitality', 'Tier 2'],
  ['formerly washreit', 'Tier 2'],['washreit', 'Tier 2'],['invitation homes', 'Tier 2'],
  ['lineage logistics (a bay grove co.)', 'Tier 2'],['lineage logistics', 'Tier 2'],
  ['bluerock residential growth reit', 'Tier 2'],['boxer properties', 'Tier 2'],
  ['cabot properties', 'Tier 2'],['cadillac fairview', 'Tier 2'],['cbre', 'Tier 2'],
  ['lpl financial', 'Tier 2'],['clayton, dubilier & rice (cdr)', 'Tier 2'],
  ['new york life', 'Tier 2'],['community healthcare trust inc.', 'Tier 2'],
  ['costar group, inc.', 'Tier 2'],['deloitte', 'Tier 2'],['northern trust', 'Tier 2'],
  ['park hotels & resorts', 'Tier 2'],['divcowest', 'Tier 2'],['realterm', 'Tier 2'],
  ['diversified healthcare trust', 'Tier 2'],['sofi', 'Tier 2'],
  ['teachers insurance and annuity association of america (tiaa)', 'Tier 2'],['tiaa', 'Tier 2'],
  ['dream industrial (a dream unlimited co.)', 'Tier 2'],['dream industrial', 'Tier 2'],
  ['easterly government properties inc.', 'Tier 2'],['eastgroup properties (egp)', 'Tier 2'],
  ['edens', 'Tier 2'],['education realty trust inc. (a greystar co.)', 'Tier 2'],['education realty trust inc.', 'Tier 2'],
  ['equity lifestyle properties', 'Tier 2'],['ey consulting', 'Tier 2'],['gbx group', 'Tier 2'],
  ['griffis residential', 'Tier 2'],['harrison street', 'Tier 2'],['hines', 'Tier 2'],
  ['hobbs brook real estate', 'Tier 2'],['industrious', 'Tier 2'],
  ['international workplace group (iwg)', 'Tier 2'],['invesco real estate', 'Tier 2'],
  ['jackson financial group', 'Tier 2'],['jamestown properties', 'Tier 2'],
  ['kilroy realty', 'Tier 2'],['kimco realty corporation', 'Tier 2'],
  ['kite realty group trust', 'Tier 2'],['klein enterprises, llc', 'Tier 2'],['klein enterprises', 'Tier 2'],
  ['lennar corp.', 'Tier 2'],['macerich', 'Tier 2'],['merritt properties', 'Tier 2'],
  ["moody's", 'Tier 2'],['piedmont office realty trust inc.', 'Tier 2'],
  ['popular, inc.', 'Tier 2'],['price waterhouse coopers (pwc)', 'Tier 2'],
  ['principal financial group', 'Tier 2'],['pritzker private capital (ppc-pc)', 'Tier 2'],
  ['pulte group', 'Tier 2'],['realty income', 'Tier 2'],['remedy reit', 'Tier 2'],
  ['renew senior living', 'Tier 2'],['rinchem company', 'Tier 2'],['rmr group', 'Tier 2'],
  ["shearer's foods", 'Tier 2'],['silver lake', 'Tier 2'],['south bay development company', 'Tier 2'],
  ['starwood capital group', 'Tier 2'],['store capital', 'Tier 2'],['strategic value partners', 'Tier 2'],
  ['tishman speyer properties inc.', 'Tier 2'],['trammell crow company, (a cbre co.)', 'Tier 2'],
  ['trammell crow company (a cbre co.)', 'Tier 2'],['trammell crow company', 'Tier 2'],
  ['tricon residential', 'Tier 2'],['usaa', 'Tier 2'],['vertiv', 'Tier 2'],
  ['westinghouse (a brookfield co.)', 'Tier 2'],['wework', 'Tier 2'],
  ['whitestone reit', 'Tier 2'],['wilsonart international, inc.', 'Tier 2'],['wsp global', 'Tier 2'],
]);

export function findTier(companyName) {
  const key = (companyName || '').toLowerCase().trim();
  if (MY_ACCOUNTS.has(key)) return MY_ACCOUNTS.get(key);
  for (const [k, tier] of MY_ACCOUNTS) {
    if (k.startsWith(key) || key.startsWith(k)) return tier;
  }
  return null;
}

// Resolve a prospect's tier the way My Accounts does (minus the Target
// Accounts sheet fallback, which needs that store): an explicit Tier 1/2/3
// wins; blank / "-" defaults to Tier 3; otherwise the hardcoded strategic map.
// Returns 'Tier 1' | 'Tier 2' | 'Tier 3' | null.
export function resolveMyTier(p) {
  const t = p && p.tier;
  if (t === 'Tier 1' || t === 'Tier 2' || t === 'Tier 3') return t;
  if (t === '-' || t === '') return 'Tier 3';
  return findTier(p && p.company); // may be null
}
