// The Agents page's "AI Prompt (Application Description)" list, shared with
// the Issues tab's "Application Description missing contracting info"
// detector so both agree on which opps qualify and what counts as missing.
//
// An opp qualifies when its BFO Sales Stage is 5 or 6, its Opps Stage is
// Contracting or Agreement Sent, and BFO's Application Description is
// blank. Join key is BFO Opportunity Name (BFO Activity "Opportunity Name"
// == Opps "BFO Link"). The BFO list view only carries Application
// Description when that column has been added to it, so `hasAppDescCol`
// says whether the blank check really ran: without the column every
// matching opp is listed and the prompt tells the assistant to leave the
// ones that already have a value.
//
// What goes in the field is the company's Contracting Entity and its
// address, off the Table View record the opp's Account (or its BFO Company
// Name) matches. Rows missing either keep a `missing` list; the Agents page
// leaves those out of the prompt and the Issues tab reports them.
import { normalizeCompany } from './companyNorm.js';
import { detectBfoUrl } from './closeNotSoldOpps.js';

const QUALIFYING_OPPS_STAGES = new Set(['contracting', 'agreement sent']);
const BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);
export const NO_COMPANY = 'company not found in Table View';

function bfoStageNumber(v) {
  const m = String(v ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function computeAppDescriptionOpps({ bfoActivity = null, oppsCache = null, prospects = [] }) {
  const empty = { rows: [], hasAppDescCol: false };
  if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return empty;
  const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
  const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
  const descCol = bfoActivity.headers.find(h => /application\s*description/i.test(h));
  if (!stageCol || !oppCol) return empty;
  const oppsByName = new Map();
  for (const r of (oppsCache?.records || [])) {
    const k = String(r['BFO Link'] || '').trim().toLowerCase();
    if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
  }
  // Company lookup by canonical name and by BFO Company Name. A record
  // that carries contracting info wins over a duplicate that doesn't.
  const prospectByCanon = new Map();
  const addProspect = (key, p) => {
    if (!key) return;
    const prev = prospectByCanon.get(key);
    if (!prev || (!String(prev.contractingEntity || '').trim() && String(p.contractingEntity || '').trim())) {
      prospectByCanon.set(key, p);
    }
  };
  for (const p of (prospects || [])) {
    addProspect(normalizeCompany(p?.company || ''), p);
    addProspect(normalizeCompany(p?.bfoCompanyName || ''), p);
  }
  const rows = [];
  const seen = new Set();
  for (const r of bfoActivity.rows) {
    const stage = bfoStageNumber(r[stageCol]);
    if (stage !== 5 && stage !== 6) continue;
    if (descCol && !BLANK_SENTINELS.has(String(r[descCol] ?? '').trim().toLowerCase())) continue;
    const name = String(r[oppCol] || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    const oppsRow = oppsByName.get(k);
    if (!oppsRow) continue;
    const oppsStage = String(oppsRow.Stage || '').trim();
    if (!QUALIFYING_OPPS_STAGES.has(oppsStage.toLowerCase())) continue;
    const bfoUrl = detectBfoUrl(oppsRow);
    if (!bfoUrl) continue;
    seen.add(k);
    const account = String(oppsRow.Account || '').trim();
    const company = prospectByCanon.get(normalizeCompany(account))
      || prospectByCanon.get(normalizeCompany(oppsRow['BFO Company Name'] || ''))
      || null;
    const entity = String(company?.contractingEntity || '').trim();
    const address = String(company?.contractingEntityAddress || '').trim();
    const missing = [];
    if (!company) missing.push(NO_COMPANY);
    else {
      if (!entity) missing.push('Contracting Entity');
      if (!address) missing.push('Contracting Entity Address');
    }
    rows.push({
      id: `${k}|${bfoUrl}`,
      oppId: oppsRow._id,
      prospectId: company?.id ?? null,
      name,
      account,
      bfoStage: String(r[stageCol] || '').trim(),
      oppsStage,
      entity,
      address,
      missing,
      bfoUrl,
    });
  }
  rows.sort((a, b) => a.account.localeCompare(b.account));
  return { rows, hasAppDescCol: !!descCol };
}
