// One-time fix, Nov 10 2026: the companies that joined My Accounts that day
// (All Missing History) came onto the roster carrying Dan as CDM, because a
// card made from the Targets list takes the signed-in CDM. Dan asked that
// any of them whose Targets list row has no CDM not have him down as CDM.
//
// Pure: works out which cards to clear. MyAccountsView applies it once and
// records it in settings.cdmBlankTargetFix so it never runs again.

import { normalizeCompanyName } from './companyKey.js';
import { matchesCdm } from './cdmMatch.js';

export const FIX_KEY = 'cdmBlankTargetFix';

// The day's "Added" list, as pasted.
export const NOV10_ADDED = [
  'Access Industries', 'ACRE Management', 'agilon health (a Clayton, Dubilier & Rice co.)', 'Alvarez & Marsal Capital Partners',
  'Andreessen Horowitz', 'Apartment Investment and Management Company (Aimco)', 'ARCH Venture Partners', 'Arctos Partners',
  'Argosy Real Estate Partners', 'Arlington Capital Partners', 'Ascentris', 'Avanath Capital Management', 'Avanti Investment Advisors',
  'Baypine', 'BDT & MSD Partners', 'Berkshire Residential Investments', 'BKM Capital Partners', 'Blackstone Real Estate - BRE (BX-PC)',
  'Blue Vista Capital Management', 'BNY Mellon Global Real Estate Scs', 'Bonaccord Capital Partners', 'Bradford Management Company Inc',
  'Brasa Capital Management', 'Bristol Group', 'Broadshore Capital Partners', 'Butterfly Equity', 'Buzz Oates', 'CapRidge Partners',
  'Chartwell Retirement Residences', 'Cheyne Capital', 'CIRE Equity', 'CLK Properties', 'Colliers Capital', 'Combined Properties Inc.',
  'Continental Realty Corporation', 'Conundrum Capital Corp.', 'Core Bridge Real Estate Investors (formerly AIG Global Real Estate)',
  'Covenant Capital Group', 'Credit Suisse Asset Management Real Estate', 'CS Capital Management', 'Cummings Properties',
  'Damianos Realty Group', 'Diamond Properties', 'Diamond Realty Management', 'Domain Capital Group', 'ECP', 'Elion Partners',
  'EMMES Realty Advisors', 'Epic Investment Services', 'Equity Estate', 'Equity Industrial Partners', 'Equity International',
  'EURAMCO Group', 'Exactech', 'FBM (Foundation Building Materials)', 'FEDERAL REALTY INVESTMENT TRUST', 'Fernau LeBlanc',
  'FIBRA Prologis', 'First Washington Realty', 'Flexpoint Ford', 'Founders Fund', 'Founders Properties', 'FPA Multifamily',
  'Friedman Integrated Real Estate Solutions', 'GEM Realty Capital', 'Genstar Capital', 'GFI Partners', 'GFP Real Estate',
  'Global Holdings Management Group', 'Goodman Group', 'Graceada Partners', 'GreenPoint Partners', 'Griffith Properties',
  'GTIS Partners', 'Hampshire', 'Hart Realty Advisers', 'Haveli Investments', 'Hearthstone Investments', 'Hunter Point Capital',
  'Index Ventures', 'INDUS Realty Trust', 'Intercontinental Real Estate Corporation', 'InterRent REIT', 'InvenTrust Properties Corp.',
  'Irgens', 'Ironstone Partners', 'K1 Investment Management', 'Kairos Investment Management Co.', 'KBS', 'Kin Properties',
  'Kinderhook Industries', 'L&B Realty Advisors', 'LEM Capital', 'Lincoln Harris', 'Linden Capital Partners', 'LLR Partners',
  'Locust Point Capital', 'Long Wharf Capital', 'Longpoint Realty Partners', 'LS Power Group', 'Lubert-Adler Partners',
  'M3 Capital Partners', 'Madison International Realty', 'Medical Properties Trust Inc.', 'mizrahi developments - CN - developer',
  'Morgan Stanley Real Estate (MSREF)', 'Morguard REIT', 'Mosaic Health (Apre + MPG) (a Clayton, Dubilier & Rice co.)',
  'Mosser Capital', 'NAI Hiffman', 'New England Life Insurance Company', 'New York City Reit', 'Newport Capital Partners',
  'NorthBridge Partners', 'Oak Street Real Estate Capital', 'OMNINET', 'Pacific Investment Management Company LLC',
  'Paine Schwartz Partners', 'Paladin Realty Partners', 'Paramount Group Real Estate', 'Pearlmark', 'Phase3 Real Estate partners',
  'Phillips Edison & Company', 'PLZ', 'Praedium Group', 'Preferred Apartment Communities, Inc',
  'Presidio (a Clayton, Dubilier & Rice co.)', 'Presima', 'Prima Capital Advisors', 'PSG', 'Quantum (Quantum Capital Group)',
  'Ram Realty Advisors', 'REDICO (Real Estate Development and Investment Company)', 'Ridgemont Equity Partners',
  'Rockefeller Capital Management', 'RXR Realty', 'Sarofim Realty Advisors', 'Saul Centers Inc.', 'Shamrock Capital',
  'Shore Capital Partners', 'Sorbara group of companies - CN', 'Spear Street Capital', 'Sterling Equities',
  'Strategic Capital Partners', 'Summit Hotel Properties Inc.', 'Taurus Investment Holdings', 'Terracap Group',
  'TerraCap Management, LLC', 'TGM Associates', 'The Hamilton Company', 'The Hampshire', 'The KABR Group, LLC',
  'The Rainier Companies', 'The Resmark Companies', 'The Rockefeller Group', 'The Trump Organization',
  'The Winter Organization Inc.', 'Thrive Capital', 'Torchlight Investors', 'Trigate Capital', 'Unite Integrated Solutions',
  'UnitedStatesDepartmentofAgriculture', 'Velocis', 'Virtu Investments', 'Virtus Real Estate Capital', 'Vision Properties',
  'Walker & Dunlop Investment Partners', 'Washington Prime Group', 'Waterton', 'Wespath Benefits and Investments',
  'Western National Group', 'Wharton Properties', 'Wheelock Street Capital', 'Wind Point Partners',
  'Xenia Hotels & Resorts, Inc.', 'Zeller Real Estate',
];

const lc = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The cards to clear: [{ id, company, targetRow }].
 *  - the card is one of `names` (by its own name, trimmed, any case),
 *  - its CDM is `cdmName`,
 *  - it is on the Targets list (its targetMap names, else a row of the same
 *    name, else the same normalized name), and every row it is on has no
 *    CDM. Not on the list at all: left alone.
 * `rows` is targetAccountRows() output ({ name, cdm }, cdm '' for none).
 */
export function cardsToClear({ prospects, rows, targetMap = {}, cdmName, names = NOV10_ADDED }) {
  const wanted = new Set(names.map(lc));
  const byName = new Map();
  const byNorm = new Map();
  for (const r of rows || []) {
    if (!r?.name) continue;
    if (!byName.has(lc(r.name))) byName.set(lc(r.name), r);
    const n = normalizeCompanyName(r.name);
    if (n && !byNorm.has(n)) byNorm.set(n, r);
  }
  const out = [];
  for (const p of prospects || []) {
    if (!p?.id || !wanted.has(lc(p.company))) continue;
    if (!matchesCdm(p.cdm, cdmName)) continue;
    const raw = targetMap[p.id];
    const mapped = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(n => byName.get(lc(n))).filter(Boolean);
    let hits = mapped;
    if (!hits.length) {
      const r = byName.get(lc(p.company)) || byNorm.get(normalizeCompanyName(p.company));
      hits = r ? [r] : [];
    }
    if (!hits.length || hits.some(r => r.cdm)) continue;
    out.push({ id: p.id, company: p.company, targetRow: hits[0].name });
  }
  return out;
}
