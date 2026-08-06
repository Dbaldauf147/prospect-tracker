// Hand-corrected mandate data, laid over the published reference.
//
// src/data/masterOrdinances.js is a seed built from a workbook, and it goes
// out of date the moment a jurisdiction moves a deadline or publishes a
// penalty the sheet didn't have. Until now the only way to fix a wrong
// figure was to rebuild the seed and ship it, so the screening kept
// quoting the wrong number — and every exposure total, deadline chart and
// export downstream quoted it too.
//
// An override is a per-user correction to ONE category of ONE
// jurisdiction. It is applied to the ordinance list before anything is
// screened, so a corrected deadline or threshold reaches every
// calculation the reference feeds rather than only the popup it was typed
// into.
//
// Only the fields that change an answer are editable: whether the
// ordinance is in force, when it is due, the size it reaches, and what it
// costs — plus the policy name and source link, so a corrected row can
// say where it came from. Everything else stays as published.
//
// Pure: a list and a map of overrides in, a new list out. No React, no
// storage.

import { CATEGORIES } from './complianceMandates.js';

/** Where a category's size thresholds live, per category. */
export const THRESHOLD_KEYS = {
  bbs: [
    ['public', 'Public buildings'],
    ['nonResidential', 'Non-residential'],
    ['multiFamily', 'Multi-family'],
    ['statewide', 'Statewide'],
  ],
  audits: [
    ['public', 'Public buildings'],
    ['commercial', 'Commercial'],
    ['multifamily', 'Multi-family'],
  ],
  bps: [
    ['nonResidential', 'Non-residential'],
    ['multiFamily', 'Multi-family'],
  ],
};

// The status strings the seed uses. `active` is what the screening reads —
// it is kept as its own field rather than re-derived from the text, so a
// jurisdiction with wording nobody anticipated can still be marked in
// force (or not) by hand.
export const STATUS_OPTIONS = [
  { value: 'Active/ Mandatory', active: true },
  { value: 'Active/ Voluntary', active: false },
  { value: 'Pre-Development', active: false },
  { value: 'Not identified', active: false },
];

function num(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A stable key for a Government ID.
 *
 * Government IDs carry spaces ("US-MI-Ann Ar-01"), and these are stored
 * under a dotted settings path where a space is a problem. Alphanumerics
 * only sidesteps that, and the mapping is stable enough to key on: the ids
 * differ well before their punctuation does.
 */
export function overrideKey(govId) {
  return String(govId || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The override stored for one jurisdiction + category, or null. */
export function overrideFor(overrides, govId, category) {
  const entry = overrides?.[overrideKey(govId)];
  const one = entry?.[category];
  return (one && typeof one === 'object') ? one : null;
}

/** How many corrections are on file, across every jurisdiction. */
export function overrideCount(overrides) {
  let n = 0;
  for (const entry of Object.values(overrides || {})) {
    for (const c of CATEGORIES) if (entry?.[c]) n += 1;
  }
  return n;
}

/**
 * The values a form should show for one category: what is published,
 * with any correction already applied.
 *
 * `published` is kept alongside so the editor can say what it is departing
 * from, and so "reset" has something to reset to.
 */
export function mandateFormValues(mandate, category, overrides) {
  const cat = mandate?.[category] || {};
  const saved = overrideFor(overrides, mandate?.govId, category) || {};
  const thresholds = { ...(cat.thresholds || {}), ...(saved.thresholds || {}) };
  return {
    policyName: saved.policyName ?? (cat.policyName || cat.ordinanceName || ''),
    status: saved.status ?? (cat.status || ''),
    active: saved.active ?? !!cat.active,
    // <input type="date"> speaks yyyy-mm-dd, which is what the seed's
    // `deadline` already is; `deadlineRaw` is the printed form.
    deadline: saved.deadline ?? (cat.deadline || ''),
    thresholds,
    maxPenalty: saved.maxPenalty ?? (cat.maxPenalty ?? null),
    penaltyUom: saved.penaltyUom ?? (cat.penaltyUom || ''),
    url: saved.url ?? (cat.url || cat.link || ''),
  };
}

/**
 * A form's values as a stored override — nulls and blanks included,
 * because "this ordinance publishes no threshold" is a correction too and
 * has to survive as one rather than falling back to the seed.
 *
 * `deadlineRaw` is written alongside the ISO date so the popup, the
 * roadmap and the exports print the corrected date the same way they print
 * a published one.
 */
export function overridePatchFrom(values, { now = new Date() } = {}) {
  const deadline = text(values?.deadline);
  const thresholds = {};
  for (const [key, value] of Object.entries(values?.thresholds || {})) {
    thresholds[key] = num(value);
  }
  return {
    policyName: text(values?.policyName),
    status: text(values?.status),
    active: !!values?.active,
    deadline: deadline || null,
    deadlineRaw: deadline ? isoToRaw(deadline) : null,
    thresholds,
    maxPenalty: num(values?.maxPenalty),
    penaltyUom: text(values?.penaltyUom),
    url: text(values?.url),
    editedAt: now.toISOString(),
  };
}

// "2026-06-01" → "6/1/2026", the form the seed's own deadlineRaw uses.
function isoToRaw(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

// One category of one jurisdiction, corrected.
function applyToCategory(cat, saved) {
  if (!saved) return cat;
  const base = cat || {};
  const next = {
    ...base,
    policyName: saved.policyName ?? base.policyName,
    // The audits category names its policy `ordinanceName`; keeping both in
    // step means the correction shows wherever either is read.
    ordinanceName: saved.policyName ?? base.ordinanceName,
    status: saved.status ?? base.status,
    active: saved.active ?? base.active,
    deadline: saved.deadline ?? base.deadline,
    deadlineRaw: saved.deadlineRaw ?? base.deadlineRaw,
    maxPenalty: saved.maxPenalty ?? base.maxPenalty,
    penaltyUom: saved.penaltyUom || base.penaltyUom,
    url: saved.url || base.url,
    link: saved.url || base.link,
    // Marks every figure downstream as hand-corrected, so the screening,
    // the popup and the exports can say a number didn't come from the
    // published reference.
    edited: true,
    editedAt: saved.editedAt || null,
  };
  if (saved.thresholds) next.thresholds = { ...(base.thresholds || {}), ...saved.thresholds };
  return next;
}

/**
 * The ordinance list with every correction applied.
 *
 * Returns the SAME list object when there is nothing to apply — the
 * screening caches its indexes by list identity, so handing back a fresh
 * copy on every render would throw that cache away on every keystroke.
 */
export function applyOrdinanceOverrides(ordinances, overrides) {
  const list = Array.isArray(ordinances) ? ordinances : [];
  if (!overrides || Object.keys(overrides).length === 0) return list;

  let touched = false;
  const out = list.map((g) => {
    const entry = overrides[overrideKey(g?.govId)];
    if (!entry) return g;
    const next = { ...g };
    let any = false;
    for (const c of CATEGORIES) {
      if (!entry[c]) continue;
      next[c] = applyToCategory(g[c], entry[c]);
      any = true;
    }
    if (!any) return g;
    touched = true;
    return next;
  });
  return touched ? out : list;
}
