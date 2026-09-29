// Import an SIA's company and annual consumption into the Broker Fees table.
// Pure, so it can be tested without a browser; the picker lives in
// BrokerFeesTab.jsx and reads the SIA History list.
//
// The three figures come from siaKeyFacts: company, annual kWh and annual
// gas. Gas is taken as Dth whether the SIA labels it Dth or MMBtu - one
// dekatherm is one MMBtu, so the number carries over unchanged.

import { siaKeyFacts } from './siaHistoryEntry.js';

const blankNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n)) : '');

// One Broker Fees row's worth of an SIA History entry, or null when the SIA
// carries none of the three figures.
export function brokerFeeImportFor(entry) {
  const f = siaKeyFacts(entry?.options || []);
  const company = f.company || '';
  const loadEp = blankNum(f.annualKwh);
  const loadNg = blankNum(f.annualGas);
  if (!company && !loadEp && !loadNg) return null;
  return { company, loadEp, loadNg };
}

const isBlankRow = (r) => !r || !(r.company || r.loadEp || r.feeEp || r.rfps || r.loadNg || r.feeNg);
const sameCompany = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Merge imported { company, loadEp, loadNg } rows into the table. A row with
// the same company name has its loads filled in (its fees and RFPs are left
// alone, and a load the SIA doesn't carry keeps what the row had). Anything
// else takes the first blank padding row, or a new one on the end.
// Returns { rows, updated, added }.
export function mergeSiaImports(rows, imports) {
  const next = (rows || []).map(r => ({ ...r }));
  let updated = 0;
  let added = 0;
  for (const imp of imports || []) {
    if (!imp) continue;
    const hit = imp.company ? next.findIndex(r => sameCompany(r.company, imp.company)) : -1;
    if (hit >= 0) {
      next[hit] = {
        ...next[hit],
        loadEp: imp.loadEp || next[hit].loadEp || '',
        loadNg: imp.loadNg || next[hit].loadNg || '',
      };
      updated += 1;
      continue;
    }
    const row = { company: imp.company || '', loadEp: imp.loadEp || '', feeEp: '', rfps: '', loadNg: imp.loadNg || '', feeNg: '' };
    const blank = next.findIndex(isBlankRow);
    if (blank >= 0) next[blank] = row;
    else next.push(row);
    added += 1;
  }
  return { rows: next, updated, added };
}
