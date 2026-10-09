// Resolve the Tier a prospect inherits from the Target Accounts list it's
// mapped to. This mirrors the tier resolution My Accounts does, factored
// out so the Clients page can show the same "tier from the mapped target
// account" without duplicating the parse.
//
// Sources, in the order they're consulted:
//   1. settings.targetMap[prospect.id] — the explicit prospect → target
//      account name(s) mapping the user sets on My Accounts.
//   2. A fuzzy name match of the prospect's company against the target
//      list (only when the user never explicitly set/cleared a mapping).

import { matchesCdm, resolveTargetAccountCdm } from './cdmMatch.js';
import { buildCompanyIndex, findMatchesInIndex } from './companyIndex.js';
import { NOT_ON_TIER_LIST } from '../data/enums.js';

// A Target Accounts row's company name: the first column whose header reads
// like one AND has something in it. A blank "Account ID" ahead of "Account
// Name" must not hide the name, or the row reads as having no company.
const NAME_KEYWORDS = ['account', 'company', 'account name', 'client', 'name'];
export function targetRowCompany(r) {
  for (const key of Object.keys(r || {})) {
    const lower = key.toLowerCase();
    if (NAME_KEYWORDS.some(kw => lower.includes(kw))) {
      const v = String(r[key] || '').trim();
      if (v) return v;
    }
  }
  return '';
}

// A Target Accounts row's tier as "Tier N" (1–9), '' when it has none. The
// first non-blank tier-ish column, else any cell shaped like "Tier 2". This
// is the one reading the popup's Targets list box and its Tier warning
// (and the Clients and Opps pages) share, so they can't disagree about the
// same row.
const TIER_KEYWORDS = ['tier', 'account tier', 'tier level', 'target'];
export function targetRowTier(r) {
  let raw = '';
  for (const key of Object.keys(r || {})) {
    const lower = key.toLowerCase();
    if (TIER_KEYWORDS.some(kw => lower.includes(kw))) {
      raw = String(r[key] || '').trim();
      if (raw) break;
    }
  }
  if (!raw) raw = String(Object.values(r || {}).find(v => /Tier\s*[1-9]/i.test(String(v || ''))) || '');
  const m = raw.match(/(?:Tier\s*)?([1-9])/i);
  return m ? `Tier ${m[1]}` : '';
}

// Pull the company + tier out of a Target Accounts workbook, keeping every
// tier (1–9), not just Tier 1/2. When `scopeToCdm` is true the rows are
// filtered to the configured CDM (matching My Accounts' CDM-scoped parse);
// when false, every rep's rows are kept — used as a fallback so a mapped
// account tiered under another rep / a blank owner cell still resolves.
export function parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm = true } = {}) {
  const data = targetAccountsData;
  if (!data?.sheets) return [];
  const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
  const out = [];
  for (const sheetName of data.sheetNames || []) {
    const sheet = data.sheets[sheetName];
    if (!sheet?.records) continue;
    for (const r of sheet.records) {
      if (scopeToCdm) {
        let cdm = resolveTargetAccountCdm(r, targetCdmColumn).toLowerCase();
        if (!cdm && cdmLastName) {
          cdm = String(Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '').toLowerCase();
        }
        if (!matchesCdm(cdm, cdmName)) continue;
      }
      const company = targetRowCompany(r);
      if (!company) continue;
      const tier = targetRowTier(r);
      if (!tier) continue;
      out.push({ company, tier });
    }
  }
  return out;
}

// Build a resolver: prospect → { tier, name, source }. `tier` is '' when
// nothing maps. `name` is the target account the tier came from; `source`
// is 'mapped' (explicit targetMap) or 'fuzzy' (name match). Build once per
// (targetAccountsData, cdmName, settings) change and reuse for every row.
//
// `includeAllReps` widens the name search to every rep's rows once this
// CDM's have nothing: for a list of OTHER pods' accounts (the Keith
// agenda's PE overlap deals), where the account is usually not this CDM's.
export function buildTargetTierResolver({ targetAccountsData, cdmName, settings, includeAllReps = false }) {
  const targetCdmColumn = settings?.targetCdmColumn;
  const cdmScoped = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: true });
  const allReps = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: false });
  const targetMap = settings?.targetMap || {};

  const byNameCdm = new Map();
  for (const t of cdmScoped) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameCdm.has(k)) byNameCdm.set(k, t.tier);
  }
  const byNameAll = new Map();
  for (const t of allReps) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameAll.has(k)) byNameAll.set(k, t.tier);
  }
  const cdmIndex = buildCompanyIndex(cdmScoped.map(t => t.company));
  const allIndex = includeAllReps ? buildCompanyIndex(allReps.map(t => t.company)) : null;

  const lookupName = (nm) => {
    const k = (nm || '').toLowerCase().trim();
    return byNameCdm.get(k) || byNameAll.get(k) || '';
  };

  return function resolveTargetTier(prospect) {
    if (!prospect) return { tier: '', name: '', source: '' };
    const rawMap = targetMap[prospect.id];
    const hasExplicit = rawMap !== undefined; // explicit empty array = user cleared it
    const names = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
    if (names.length > 0) {
      for (const nm of names) {
        const t = lookupName(nm);
        if (t) return { tier: t, name: nm, source: 'mapped' };
      }
      // Mapped, but the name isn't on the target list (or has no tier).
      return { tier: '', name: names[0] || '', source: 'mapped' };
    }
    if (!hasExplicit) {
      for (const tName of findMatchesInIndex(cdmIndex, prospect.company || '')) {
        const t = byNameCdm.get((tName || '').toLowerCase().trim());
        if (t) return { tier: t, name: tName, source: 'fuzzy' };
      }
      if (allIndex) {
        const exact = byNameAll.get(String(prospect.company || '').toLowerCase().trim());
        if (exact) return { tier: exact, name: prospect.company, source: 'fuzzy' };
        for (const tName of findMatchesInIndex(allIndex, prospect.company || '')) {
          const t = byNameAll.get((tName || '').toLowerCase().trim());
          if (t) return { tier: t, name: tName, source: 'fuzzy' };
        }
      }
    }
    return { tier: '', name: '', source: '' };
  };
}

// Who owns each account on the Target Accounts list: the CDM column of its
// row (settings.targetCdmColumn when set, else the column whose header
// reads like a CDM / owner). Every rep's rows, not just this user's: the
// point of reading it is to see whose account a deal is.
export function parseTargetAccountCdms(targetAccountsData, targetCdmColumn) {
  const data = targetAccountsData;
  if (!data?.sheets) return [];
  const out = [];
  for (const sheetName of data.sheetNames || []) {
    for (const r of data.sheets[sheetName]?.records || []) {
      let company = '';
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        if (['account', 'company', 'account name', 'client', 'name'].some(kw => lower.includes(kw))) {
          company = String(r[key] || '').trim();
          if (company) break;
        }
      }
      const cdm = resolveTargetAccountCdm(r, targetCdmColumn);
      if (company && cdm) out.push({ company, cdm });
    }
  }
  return out;
}

// Build a resolver: prospect-like { id?, company } → the CDM the Target
// Accounts list names for it, or ''. Matched the way the tier resolver
// matches: the explicit My Accounts mapping first, then the exact name,
// then a fuzzy name match.
export function buildTargetCdmResolver({ targetAccountsData, settings }) {
  const rows = parseTargetAccountCdms(targetAccountsData, settings?.targetCdmColumn);
  const byName = new Map();
  for (const t of rows) {
    const k = t.company.toLowerCase().trim();
    if (k && !byName.has(k)) byName.set(k, t.cdm);
  }
  const index = buildCompanyIndex(rows.map(t => t.company));
  const targetMap = settings?.targetMap || {};
  return function resolveTargetCdm(prospect) {
    if (!prospect) return '';
    const rawMap = prospect.id != null ? targetMap[prospect.id] : undefined;
    const names = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
    for (const nm of names) {
      const c = byName.get(String(nm || '').toLowerCase().trim());
      if (c) return c;
    }
    const exact = byName.get(String(prospect.company || '').toLowerCase().trim());
    if (exact) return exact;
    if (rawMap !== undefined) return ''; // mapped (or cleared) on purpose
    for (const tName of findMatchesInIndex(index, prospect.company || '')) {
      const c = byName.get(String(tName || '').toLowerCase().trim());
      if (c) return c;
    }
    return '';
  };
}

// Whether the tier on a company card disagrees with the Target Accounts
// list. `cardTier` is the card's Tier field; `reading` is what
// buildTargetTierResolver returned for it, or null while the list has not
// loaded (no warning then: an unloaded list is not a disagreement).
//
// Blank, "-" and "Not on tier list" all mean "no tier", so a card left
// blank or marked Not on tier list agrees with a company the list doesn't
// tier. Returns null when they agree, else { cardTier, targetTier, apply },
// where `apply` is the value to set the card to so it matches the list.
export function tierMismatch(cardTier, reading) {
  if (!reading) return null;
  const norm = (t) => {
    const s = String(t || '').trim();
    return (!s || s === '-' || s === NOT_ON_TIER_LIST) ? '' : s;
  };
  const card = norm(cardTier);
  const target = norm(reading.tier);
  if (card === target) return null;
  return { cardTier: card, targetTier: target, apply: target || NOT_ON_TIER_LIST };
}

// Header words that read like a vertical column when none is picked on the
// Target Accounts page (settings.targetVerticalColumn).
const VERTICAL_COLUMN_KEYWORDS = ['vertical', 'industry', 'sector', 'segment'];

/** A Target Accounts row's vertical: the picked column, else the first header that reads like one. */
export function resolveTargetAccountVertical(record, verticalColumn) {
  if (!record) return '';
  const col = String(verticalColumn || '').trim();
  if (col) return Object.prototype.hasOwnProperty.call(record, col) ? String(record[col] ?? '').trim() : '';
  // A header that IS one of the words ("Vertical") before one that only
  // contains it ("Sub Vertical").
  const keys = Object.keys(record);
  const exact = (k) => VERTICAL_COLUMN_KEYWORDS.includes(String(k).trim().toLowerCase());
  for (const key of [...keys.filter(exact), ...keys.filter(k => !exact(k))]) {
    const lower = String(key).toLowerCase();
    if (VERTICAL_COLUMN_KEYWORDS.some(kw => lower.includes(kw))) {
      const v = String(record[key] ?? '').trim();
      if (v) return v;
    }
  }
  return '';
}

/**
 * The vertical the Target Accounts list gives a company, but only once the
 * company has been MAPPED to a target account (settings.targetMap, set on
 * My Accounts) - never off a name guess, since importing a field off the
 * wrong row writes something wrong onto the card.
 *
 * Returns null when the company is not mapped, else { name, vertical }:
 * the target account the vertical came from (the first mapped one that
 * has a vertical) and its vertical, '' when the mapped rows carry none.
 * `options` (Dropdowns > Vertical) snaps the value to the list's own
 * spelling when it matches one ignoring case; `onList` says whether it did.
 */
export function targetVerticalFor({ targetAccountsData, settings, prospectId, options = [] }) {
  if (prospectId == null) return null;
  const raw = settings?.targetMap?.[prospectId];
  const names = (Array.isArray(raw) ? raw : (raw ? [raw] : []))
    .map(n => String(n || '').trim()).filter(Boolean);
  if (names.length === 0) return null;
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const col = settings?.targetVerticalColumn;
  const found = new Map();
  const data = targetAccountsData;
  for (const sheetName of data?.sheetNames || []) {
    for (const r of data?.sheets?.[sheetName]?.records || []) {
      let company = '';
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        if (['account', 'company', 'account name', 'client', 'name'].some(kw => lower.includes(kw))) {
          company = String(r[key] || '').trim();
          if (company) break;
        }
      }
      const k = company.toLowerCase();
      if (!wanted.has(k) || found.has(k)) continue;
      const v = resolveTargetAccountVertical(r, col);
      if (v) found.set(k, v);
    }
  }
  for (const n of names) {
    const v = found.get(n.toLowerCase());
    if (!v) continue;
    const listed = (options || []).find(o => String(o).trim().toLowerCase() === v.toLowerCase());
    return { name: n, vertical: listed || v, onList: !!listed };
  }
  return { name: names[0], vertical: '', onList: false };
}
