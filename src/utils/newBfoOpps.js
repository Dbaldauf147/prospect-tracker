// Single source of truth for the "New BFO Opp" flow — the set of Opps
// that don't yet exist in BFO and need a fresh Guided Opportunity
// created, plus the "what's still missing" check that drives both the
// red banner on the Agents page and the matching row on the Issues page.
//
// Kept here (rather than inline in AgentsView) so the Agents banner and
// the Issues tab always agree on which opps are incomplete — there's one
// definition, not two that can drift apart.

import { getEffectiveServiceMetadata } from '../data/serviceCatalog';

// Normalize a company name for fuzzy matching against BFO Account Name.
// Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes, strip
// punctuation, collapse whitespace. Same shape ActivityView, MyAccounts
// and AgentsView use so a name that matches there matches here too.
export function normalizeBfoCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same client-keyword test PipelineView + YOY use on the Opps Lead
// Source — keeps "is this a current customer?" consistent across views.
const CURRENT_CUSTOMER_LEAD_SOURCE_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;

// Stages that never qualify for a fresh BFO opp.
const EXCLUDED_STAGES = new Set(['Not Started', 'Not Sold', 'Sold']);

// Normalized company → BFO Company Name, from the Table View prospect
// records. Used to enrich each New BFO Opp row with the BFO-side account
// name (which often differs from the marketing-friendly Account on the
// Opps sheet). First match wins so the lookup is deterministic.
function bfoCompanyByNormMap(prospects) {
  const map = new Map();
  for (const p of (prospects || [])) {
    const norm = normalizeBfoCompany(p.company);
    const bfo = String(p.bfoCompanyName || '').trim();
    if (!norm || !bfo) continue;
    if (!map.has(norm)) map.set(norm, bfo);
  }
  return map;
}

/**
 * Opps that need a fresh BFO Guided Opportunity created. Filter:
 *   • Stage NOT in {Not Started, Not Sold, Sold}
 *   • "BFO Link" is exactly "-" (the deliberate "needs a BFO opp" mark;
 *     blank and "#N/A" do not qualify).
 * Each row is enriched from the Dropdowns › Services metadata for its
 * Scope (Product Line, Type, Region, Class, Local Project Name) and the
 * Table View BFO Company Name for its Account.
 */
export function computeNewBfoOpps({ oppsCache, prospects = [], serviceOverrides = {} }) {
  const records = oppsCache?.records || [];
  const overrides = serviceOverrides || {};
  const bfoCompanyByNorm = bfoCompanyByNormMap(prospects);
  const rows = [];
  for (const r of records) {
    const stage = String(r.Stage || '').trim();
    if (!stage || EXCLUDED_STAGES.has(stage)) continue;
    const bfoLink = String(r['BFO Link'] ?? '').trim();
    if (bfoLink !== '-') continue;
    const callInRaw = String(r['Call In'] ?? '').trim();
    const account = String(r.Account || '').trim();
    const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
    // A Scope can list several comma-joined services (e.g. "Remote
    // assessments, Audits"). The New BFO Opp flow only creates an opp for
    // the first one, so use just the first listed scope item.
    const rawScope = String(r.Scope || '').trim();
    const scope = rawScope.includes(',') ? rawScope.split(',')[0].trim() : rawScope;
    const followUp = String(r['Follow Up'] ?? '').trim();
    const bfoCompanyName = bfoCompanyByNorm.get(normalizeBfoCompany(account)) || '';
    // Per-service metadata from the Dropdowns › Services subtab. Scope is
    // the canonical service name; the catalog supplies Product Line, Type,
    // Region, Class (= BFO Tag), and Local Project Name. User overrides on
    // the Services tab win over the seed values.
    const svcMeta = getEffectiveServiceMetadata(scope, overrides);
    const productLine = svcMeta?.productLine || '';
    const type = svcMeta?.serviceType || '';
    const region = svcMeta?.region || '';
    const klass = svcMeta?.bfoTag || '';
    // Local Project Name picks up the seed / override value. When the
    // opp's Lead Source is "PE Partner", append "#PE PRACTICE" so the BFO
    // opp is tagged into the PE practice book of business.
    const baseLpn = svcMeta?.localProjectName || '';
    const isPePartner = /^pe partner$/i.test(leadSource);
    const localProjectName = isPePartner
      ? (baseLpn ? `${baseLpn} #PE PRACTICE` : '#PE PRACTICE')
      : baseLpn;
    const years = 'YEAR1';
    // Combined Project Name the user pastes into BFO's Project Name box:
    //   SB - {ProductLine code} - New - {Type} - {Region} - YEAR1 - {Scope}
    // {ProductLine code} is the first segment of the Product Line before
    // " - " (e.g. "SUSUP" from "SUSUP - SUPPLY & SUST SERVICES").
    const plCode = productLine.includes(' - ')
      ? productLine.split(' - ')[0].trim()
      : productLine.trim();
    const projectNameParts = ['SB', plCode, 'New', type, region, years, scope].filter(Boolean);
    const projectName = projectNameParts.join(' - ');
    rows.push({
      id: r._id ?? `${account}|${scope}`,
      raw: r,
      company: account || '-',
      bfoCompanyName,
      leadSource: leadSource || '-',
      currentCustomer: CURRENT_CUSTOMER_LEAD_SOURCE_RE.test(leadSource),
      scope: scope || '-',
      stage,
      followUp,
      callIn: callInRaw,
      productLine,
      localProjectName,
      projectName,
      type,
      region,
      class: klass,
      years,
    });
  }
  rows.sort((a, b) => a.company.localeCompare(b.company));
  return rows;
}

// A New BFO Opp field counts as "missing" when it's blank or a dash
// placeholder — those leave a hole in the generated prompt / Project Name.
function isBlankBfoField(v) {
  const s = String(v ?? '').trim();
  return !s || s === '-' || s === '\u2014';
}

/**
 * The data the New BFO Opp AI prompt needs but doesn't have. The prompt
 * emits "BFO Company Name | Project Name | Product Line | Local Project
 * Name" per opp, with Project Name composed from the Product Line code,
 * Type, Region and Scope — so any blank among those fields leaves a hole.
 * Returns one entry per affected opp: { id, oppId, company, scope, missing }.
 * `oppId` is the opp's `_id` where the cached row has one — it's what the
 * Issues tab ranks into the visible "Opp #".
 */
export function computeNewBfoMissingData(newBfoOpps) {
  const out = [];
  for (const o of (newBfoOpps || [])) {
    const missing = [];
    if (isBlankBfoField(o.bfoCompanyName)) missing.push('BFO Company Name');
    if (isBlankBfoField(o.productLine)) missing.push('Product Line');
    if (isBlankBfoField(o.type)) missing.push('Type');
    if (isBlankBfoField(o.region)) missing.push('Region');
    if (isBlankBfoField(o.scope)) missing.push('Scope');
    if (isBlankBfoField(o.localProjectName)) missing.push('Local Project Name');
    if (missing.length) out.push({ id: o.id, oppId: o.raw?._id ?? null, company: o.company, scope: o.scope, missing });
  }
  return out;
}
