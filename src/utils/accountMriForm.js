// The Account MRI popup (My Accounts > Strategic Accounts > Account MRI):
// the intake template's seven tabs as a form. This file is the form's
// shape, its scoring, and how what is typed into it reaches the template
// export. The tracker's own answers come from utils/accountMri.js, the same
// mapping the export has always used; what is typed here is saved per
// company under settings.accountMri and laid over them.
//
// Every list, row number and threshold below is the template's own
// (src/assets/account-mri-intake-template.xlsx, its Lists tab and
// formulas); scripts/accountMriForm.test.mjs holds them to it.
//
// Imported with extensions so this loads under plain Node for the tests.
import { MRI_PROFILE_FIELDS, NO_COMPETITOR, siteGeography } from './accountMri.js';
import { normalizeTargets, isNoTargetRow, hasTargetValues, NO_TARGET_TYPE } from './companyTargets.js';

export const MRI_LISTS = {
  tier: ['Not set', 'Tier I', 'Tier II', 'Tier III'],
  yesNo: ['Yes', 'No'],
  yesNoTbd: ['Yes', 'No', 'TBD'],
  // The dash in the last stage is the template's own en dash.
  stage: ['Prospect', 'Discovery', 'Qualify', 'Proposal', 'Negotiation', 'Customer – Expand'],
  stageCap: [0.25, 0.5, 0.5, 0.6, 0.8, 0.8],
  level: ['Absent', 'Low', 'Moderate', 'Strong'],
  footprint: ['Not yet served', 'Competitor-held', 'SE partial', 'SE incumbent'],
  bodySystem: ['Brain', 'Heart', 'Lungs', 'Nervous System', 'Skeleton', 'Immune System', 'Bloodstream'],
  buyingRole: ['Technical Buyer', 'Business Stakeholder', 'Budget Holder', 'Procurement', 'Other', 'Unknown'],
  support: ['Advocate (Champion)', 'Supporter (Favors Us)', 'Neutral (Non-Committal)', 'Resister (Favors Competitor)', 'Adversary (Anti-Champion)', 'Unknown'],
  decisionRole: ['Decider', 'Influencer', 'None', 'Unknown'],
  relationship: ['0 - No Relationship', '1 - Very Weak', '2 - Weak', '3 - Neutral', '4 - Strong', '5 - Very Strong'],
  agree: ['Unknown', 'Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  advantage: ['Unknown', 'Clear disadvantage', 'Small disadvantage', 'Parity', 'Small advantage', 'Clear advantage'],
};

export const MRI_TABS = [
  { key: 'profile', label: 'Profile & Background' },
  { key: 'diagnosis', label: 'Diagnosis' },
  { key: 'committee', label: 'Buying Committee' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'sites', label: 'Sites & Utilities' },
  { key: 'dealHealth', label: 'Deal Health' },
  { key: 'closePlan', label: 'Close Plan' },
];

// ── Tab 1 ────────────────────────────────────────────────────────────────
// How each row of tab 1 is asked for. Rows and keys are MRI_PROFILE_FIELDS;
// this only adds the control and where it sits.
const PROFILE_INPUT = {
  tier: { type: 'select', list: 'tier' },
  existingClient: { type: 'select', list: 'yesNo' },
  stage: { type: 'select', list: 'stage' },
  assignedSince: { type: 'date' },
  hq: { placeholder: 'City, State' },
  revenueB: { type: 'money' },
  sites: { type: 'count' },
  energySpend: { type: 'money' },
  background: { type: 'textarea' },
  services: { type: 'textarea' },
  fee: { type: 'textarea' },
  setup: { type: 'textarea' },
  contractTerm: { type: 'textarea' },
  earlyOut: { type: 'select', list: 'yesNo' },
  upsell: { type: 'textarea' },
};
const PROFILE_LABEL = {
  accountName: 'Account name',
  mainContact: 'Main point of contact · email / phone',
  upsell: 'Potential upsell opportunities & who is responsible',
};
const PROFILE_SECTION = [
  { key: 'account', title: 'Account profile', from: 5, to: 17 },
  { key: 'background', title: 'Client background', hint: 'from Opportunity Plan › Client-Prospect Info', from: 19, to: 23 },
  { key: 'commercials', title: 'Commercials & scope', from: 25, to: 31 },
];
export const PROFILE_SECTIONS = PROFILE_SECTION.map(s => ({
  key: s.key,
  title: s.title,
  hint: s.hint || '',
  fields: MRI_PROFILE_FIELDS.filter(f => f.row >= s.from && f.row <= s.to).map(f => ({
    key: f.key,
    label: PROFILE_LABEL[f.key] || f.label,
    source: f.source,
    type: 'text',
    ...PROFILE_INPUT[f.key],
  })),
}));

const isBlank = v => v == null || String(v).trim() === '';

/**
 * Tab 1 as the popup shows it: what was typed where something was, else
 * the tracker's answer. Returns { values, typed } where `typed[key]` says
 * the value is the user's own rather than the tracker's.
 */
export function mergeProfile(tracker = {}, saved = {}) {
  const values = {};
  const typed = {};
  for (const f of MRI_PROFILE_FIELDS) {
    const own = saved?.[f.key];
    if (own !== undefined) { values[f.key] = own; typed[f.key] = true; } else values[f.key] = tracker?.[f.key] ?? '';
  }
  return { values, typed };
}

// Tab 1 rows that are the company record's own field: a value typed on the
// Account MRI is written to the company (so the company popup shows it too)
// rather than kept on the MRI only. Each turns what the row holds into the
// record's fields. The other rows are worked out from more than one field
// (Stage, Existing client), from other lists (Tier, Services, contracts,
// contacts) or have no field on the record, so they stay the MRI's own.
const plainNumber = v => String(v ?? '').replace(/[$,\s]/g, '');

/**
 * The company's Revenue ($B) as it is stored: a bare amount in billions
 * (".5", "$40.6" typed by hand) becomes "$0.5B" / "$40.6B", so every screen
 * reading the free-text Revenue sees the scale. An amount of a million or
 * more is dollars, and anything worded ("850M", "$1.5B") is kept as typed.
 */
export function revenueBillionsText(raw) {
  const s = String(raw ?? '').trim();
  const n = plainNumber(s);
  if (n === '') return '';
  if (!/^(\d+\.?\d*|\.\d+)$/.test(n)) return s;
  const value = Number(n);
  if (!Number.isFinite(value) || value >= 1e6) return s;
  return `$${value}B`;
}
export const PROFILE_RECORD_FIELDS = {
  vertical: v => ({ vertical: v }),
  salesperson: v => ({ cdm: v }),
  hq: v => ({ hqRegion: v }),
  // Revenue ($B) "$40.6" is $40.6 billion; the record's Revenue is free text.
  revenueB: v => ({ revenue: revenueBillionsText(v) }),
  revenueText: v => ({ revenue: v }),
  sites: v => ({ numberOfSites: plainNumber(v) }),
  background: v => ({ notes: v }),
  competitors: v => ({ competitorsNotes: String(v ?? '').trim() === NO_COMPETITOR ? '' : v }),
};

/** The company record update for one tab 1 row, or null when the row is the MRI's own. */
export function profileRecordPatch(key, value) {
  const to = PROFILE_RECORD_FIELDS[key];
  return to ? to(String(value ?? '').trim()) : null;
}

// ── Tab 2 ────────────────────────────────────────────────────────────────
// Seven body systems, four vital signs each, on rows 4 to 31 in this order;
// the per-system summary (footprint, intel notes) is on rows 35 to 41.
const SYSTEMS = [
  ['brain', 'Brain', 'Corporate Strategy', ['Public climate / net-zero commitment', 'Exec / board ownership of sustainability', 'Strategic transformation underway', 'Roadmap gap (ambition without a plan)']],
  ['heart', 'Heart', 'Financial Priorities', ['Margin / cost pressure', 'Energy is a material cost line', 'Budget volatility exposure', 'Procurement sophistication gap']],
  ['lungs', 'Lungs', 'Energy & Emissions', ['Energy-intensive operations', 'Scope 1 & 2 emissions scale', 'Renewable procurement gap', 'Scope 3 / supplier pressure']],
  ['nervous', 'Nervous System', 'Data & Digital Infrastructure', ['Data fragmentation', 'Manual reporting burden', 'Meter / interval data gaps', 'Integration readiness (ERP / IT)']],
  ['skeleton', 'Skeleton', 'Real Estate Footprint', ['Footprint scale (sites / sq ft)', 'Aging assets / deferred capex', 'Electrification potential', 'Geographic spread']],
  ['immune', 'Immune System', 'Risk & Compliance', ['Regulatory disclosure exposure', 'Investor / customer ESG scrutiny', 'Climate / physical risk', 'Grid & resilience risk']],
  ['blood', 'Bloodstream', 'Capital Allocation', ['Capex budget availability', 'Payback hurdle flexibility', 'AP / bill-payment complexity', 'Appetite for OPEX / as-a-service']],
];
export const BODY_SYSTEMS = SYSTEMS.map(([key, name, focus, signs], i) => ({
  key,
  name,
  focus,
  summaryRow: 35 + i,
  signs: signs.map((label, j) => ({ key: `${key}.${j}`, label, row: 4 + i * 4 + j })),
}));
export const RAW_INTEL_CELL = 'A46';

// The vital signs every company starts rated Absent, before anything is
// known about it. A rating picked for a company replaces its default, and
// clearing a defaulted one is saved as '' so the default doesn't come back.
export const DEFAULT_SIGNALS = Object.fromEntries([
  'brain.2', 'brain.3',
  'heart.0', 'heart.2',
  'lungs.2',
  'nervous.0', 'nervous.2', 'nervous.3',
  'skeleton.1', 'skeleton.2',
  'immune.2', 'immune.3',
  'blood.0', 'blood.1', 'blood.3',
].map(key => [key, 'Absent']));

// What each body system's Intel notes box holds until something is typed
// there. Emptying the box is saved as '' so the default doesn't come back.
export const DEFAULT_INTEL_NOTE = '-';

/** Each system's Intel notes as shown: what was typed, else DEFAULT_INTEL_NOTE. */
export function diagnosisNotes(saved = {}) {
  const out = {};
  for (const system of BODY_SYSTEMS) {
    const own = saved?.[system.key];
    out[system.key] = own !== undefined ? String(own ?? '') : DEFAULT_INTEL_NOTE;
  }
  return out;
}

/**
 * The ratings a company's Diagnosis tab shows: DEFAULT_SIGNALS with what
 * was picked for it laid over them. A key saved as '' (a default cleared
 * by hand) is left out.
 */
export function diagnosisSignals(saved = {}) {
  const out = {};
  for (const [key, value] of Object.entries({ ...DEFAULT_SIGNALS, ...(saved || {}) })) {
    if (value) out[key] = value;
  }
  // A sign that follows another reads whatever that one shows, until a
  // rating is picked for it (or it is cleared by hand, saved as '').
  for (const [key, source] of Object.entries(SIGNAL_FOLLOWS)) {
    if (saved?.[key] !== undefined) continue;
    if (out[source]) out[key] = out[source]; else delete out[key];
  }
  return out;
}

// Signs rated the same as another sign until rated on their own:
// "Exec / board ownership of sustainability" matches "Public climate /
// net-zero commitment" (itself read from the Targets tab).
export const SIGNAL_FOLLOWS = { 'brain.1': 'brain.0' };

/**
 * One body system's reading: `sum` of its four ratings (Absent 0 to Strong
 * 3, the template's "Signal score (of 12)"), `rated` how many are rated,
 * and `pct` that sum as a share of 12, the card's headline number.
 */
export function systemScore(system, signals = {}) {
  let sum = 0;
  let rated = 0;
  for (const s of system.signs) {
    const at = MRI_LISTS.level.indexOf(signals[s.key]);
    if (at < 0) continue;
    rated += 1;
    sum += at;
  }
  return { sum, rated, pct: Math.round((sum / (system.signs.length * 3)) * 100) };
}

// The sign "Public climate / net-zero commitment" read from the company's
// Targets tab: Strong for a net-zero or SBTi (science-based) target or
// commitment, Moderate for any other target, Absent when it has none (or
// only a "No target set" row). Hidden rows are old targets and don't count.
export const CLIMATE_COMMITMENT_SIGN = 'brain.0';
const STRONG_TARGET = /net[\s-]*zero|\bsbti?\b|science[\s-]*based/i;
export function climateCommitmentLevel(climateTargets) {
  const rows = normalizeTargets(climateTargets).filter(r => !r.hidden && !isNoTargetRow(r) && hasTargetValues([r]));
  if (!rows.length) return 'Absent';
  if (rows.some(r => [r.type, r.commitmentType, r.status].some(v => STRONG_TARGET.test(v)))) return 'Strong';
  return 'Moderate';
}

// The tracker's own Diagnosis ratings for a company record.
// Skeleton's "Footprint scale (sites / sq ft)" from the company's site
// count: Strong over 100 sites, Moderate for 50 to 100, Low under 50. ''
// when the count isn't known.
export const FOOTPRINT_SIGN = 'skeleton.0';
export function footprintLevel(siteCount) {
  const n = Number(String(siteCount ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 100) return 'Strong';
  if (n >= 50) return 'Moderate';
  return 'Low';
}

// Skeleton's "Geographic spread" from where the company's listed sites are
// (siteGeography): Strong across more than one country, Moderate across
// more than one state, Low in one state (or a single site). '' when the
// list doesn't say where its sites are.
export const SPREAD_SIGN = 'skeleton.3';
export function spreadLevel(geo) {
  if (!geo?.sites) return '';
  if (geo.countries > 1) return 'Strong';
  if (geo.states > 1) return 'Moderate';
  if (geo.states === 1 || geo.sites === 1) return 'Low';
  return '';
}

// Immune's "Regulatory disclosure exposure" and "Investor / customer ESG
// scrutiny" from the frameworks the company reports to: Strong when it
// reports to any of CDP, GRESB, NZAM, UN PRI, CSRD or CA SB (California
// SB 253 / 261), Absent when it reports to none of them.
export const DISCLOSURE_SIGNS = ['immune.0', 'immune.1'];
export const DISCLOSURE_FRAMEWORKS = ['CDP', 'GRESB', 'NZAM', 'UN PRI', 'CSRD', 'CA SB'];
export function disclosureLevel(frameworks) {
  const have = new Set([...(frameworks || [])].map(f => String(f || '').trim().toUpperCase()));
  return DISCLOSURE_FRAMEWORKS.some(f => have.has(f)) ? 'Strong' : 'Absent';
}

// Where each tracker rating comes from, for the tag beside the sign.
export const SIGNAL_SOURCE = {
  [CLIMATE_COMMITMENT_SIGN]: 'Targets',
  [FOOTPRINT_SIGN]: 'Sites',
  [SPREAD_SIGN]: 'site list',
  ...Object.fromEntries(DISCLOSURE_SIGNS.map(k => [k, 'Frameworks'])),
};

// The tracker's own Diagnosis ratings for a company record and its saved
// site list (settings.companySiteLists entry). The site count is the
// record's Sites field, else how many sites the list has. `frameworks` is
// every framework the company is flagged with (its own list plus the
// Lists-page mappings, as the Frameworks column shows); the record's own
// list is read either way.
export function trackerSignals(record, { siteList = null, frameworks = null } = {}) {
  const geo = siteGeography(siteList);
  const count = footprintLevel(record?.numberOfSites) ? record.numberOfSites : geo.sites;
  const out = { [CLIMATE_COMMITMENT_SIGN]: climateCommitmentLevel(record?.climateTargets) };
  const footprint = footprintLevel(count);
  if (footprint) out[FOOTPRINT_SIGN] = footprint;
  const spread = spreadLevel(geo);
  if (spread) out[SPREAD_SIGN] = spread;
  const disclosure = disclosureLevel([...(record?.frameworks || []), ...(frameworks || [])]);
  for (const k of DISCLOSURE_SIGNS) out[k] = disclosure;
  return out;
}

// Why the tracker rated each sign it rates (trackerSignals, same inputs),
// as a sentence with the company's own figures, for the popup's hover text.
// A sign the tracker rates but couldn't this time (Skeleton's, with no site
// count or locations) gets what was missing instead, starting lower case.
export function trackerSignalReasons(record, { siteList = null, frameworks = null } = {}) {
  const out = {};
  const signals = trackerSignals(record, { siteList, frameworks });

  const targets = normalizeTargets(record?.climateTargets).filter(r => !r.hidden && !isNoTargetRow(r) && hasTargetValues([r]));
  const summary = climateTargetSummary(record?.climateTargets);
  const climateRule = 'Rule: Strong for a net-zero or SBTi (science-based) target or commitment, Moderate for any other target, Absent for none.';
  out[CLIMATE_COMMITMENT_SIGN] = targets.length
    ? `${signals[CLIMATE_COMMITMENT_SIGN]}: the Targets tab has ${targets.length === 1 ? 'one target' : `${targets.length} targets`} (${summary}). ${climateRule}`
    : `Absent: the Targets tab has no current target${summary === NO_TARGET_TYPE ? ' ("No target set")' : ''}. ${climateRule}`;

  const geo = siteGeography(siteList);
  const fromField = !!footprintLevel(record?.numberOfSites);
  const footprintRule = 'Rule: Strong over 100 sites, Moderate for 50 to 100, Low under 50.';
  if (signals[FOOTPRINT_SIGN]) {
    const n = Number(String(fromField ? record.numberOfSites : geo.sites).replace(/[,\s]/g, ''));
    out[FOOTPRINT_SIGN] = `${signals[FOOTPRINT_SIGN]}: ${n.toLocaleString('en-US')} site${n === 1 ? '' : 's'} (${fromField ? "the company's Sites field" : 'open sites on its saved site list, as the Sites field is empty'}). ${footprintRule}`;
  } else {
    out[FOOTPRINT_SIGN] = `the company's Sites field is empty and it has no saved site list to count. ${footprintRule}`;
  }
  const spreadRule = 'Rule: Strong across more than one country, Moderate across more than one state, Low in one state.';
  if (signals[SPREAD_SIGN]) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    out[SPREAD_SIGN] = `${signals[SPREAD_SIGN]}: the saved site list has ${plural(geo.sites, 'open site', 'open sites')} across ${plural(geo.countries, 'country', 'countries')} and ${plural(geo.states, 'state / province', 'states / provinces')}. ${spreadRule}`;
  } else {
    out[SPREAD_SIGN] = `${geo.sites ? "the saved site list doesn't say which state or country its sites are in" : 'the company has no saved site list'}. ${spreadRule}`;
  }

  const all = [...new Set([...(record?.frameworks || []), ...(frameworks || [])].map(f => String(f || '').trim()).filter(Boolean))];
  const hits = all.filter(f => DISCLOSURE_FRAMEWORKS.includes(f.toUpperCase()));
  const disclosure = hits.length
    ? `Strong: the company reports to ${hits.join(', ')}.`
    : `Absent: the company reports to none of ${DISCLOSURE_FRAMEWORKS.join(', ')}${all.length ? ` (its frameworks: ${all.join(', ')})` : ' (no frameworks on file)'}.`;
  for (const k of DISCLOSURE_SIGNS) out[k] = `${disclosure} Rule: Strong when it reports to any of ${DISCLOSURE_FRAMEWORKS.join(', ')}, Absent when it reports to none. Frameworks are the company's own plus its Lists-page mappings.`;
  return out;
}

/**
 * The hover text for one Diagnosis sign: why it shows what it shows.
 * `saved` is what was picked on this MRI, `tracker` / `reasons` the
 * tracker's ratings and why (trackerSignalReasons), `signals` what the tab
 * shows (mergeSignals), `labelOf(key)` a sign's name.
 */
export function signalReason(key, { saved = {}, tracker = {}, reasons = {}, signals = {}, labelOf = k => k } = {}) {
  const shown = signals[key] || '';
  const own = saved?.[key];
  const trackerNote = tracker[key] && reasons[key] ? `\n\nThe tracker would rate it ${reasons[key]}` : '';
  if (own === '') return `Cleared by hand, so it is not rated.${trackerNote}`;
  if (own !== undefined) return `${own}: picked by hand on this Account MRI.${trackerNote}`;
  const source = SIGNAL_FOLLOWS[key];
  if (source) {
    if (!shown) return `Not rated yet. It matches "${labelOf(source)}" until rated here, and that is not rated either.`;
    const why = signalReason(source, { saved, tracker, reasons, signals, labelOf });
    return `${shown}: matches "${labelOf(source)}" until you pick a rating here.\n\n"${labelOf(source)}" is ${why}`;
  }
  if (tracker[key] && reasons[key]) return `${reasons[key]}\n\nRated by the tracker until you pick a rating here.`;
  if (!tracker[key] && reasons[key]) {
    const missing = `Not rated by the tracker: ${reasons[key]}`;
    return shown ? `${shown} by default: this sign starts ${shown} for every company until a rating is picked.\n\n${missing}` : `${missing}\n\nPick a rating.`;
  }
  if (DEFAULT_SIGNALS[key] && shown === DEFAULT_SIGNALS[key]) return `${shown} by default: this sign starts ${shown} for every company until a rating is picked.`;
  if (shown) return `${shown}.`;
  return 'Not rated yet: nothing in the tracker rates this sign. Pick a rating.';
}

// What kind of targets a company has, from its Targets tab, as one line
// for Brain's Intel notes: "50% Absolute reduction (Scope 1, 2) by 2030,
// 1.5°C; Net-zero commitment by 2050". Hidden rows are old targets and are
// left out. "No target set" when the company was checked and has none, ''
// when its targets have not been looked at.
export function climateTargetSummary(climateTargets) {
  const all = normalizeTargets(climateTargets).filter(r => !r.hidden);
  const rows = all.filter(r => !isNoTargetRow(r) && hasTargetValues([r]));
  if (!rows.length) return all.some(isNoTargetRow) ? NO_TARGET_TYPE : '';
  return rows.map((r) => {
    const name = r.action === 'Commitment'
      ? (r.commitmentType ? `${r.commitmentType} commitment` : 'Commitment')
      : ([r.value, r.type].filter(Boolean).join(' ') || 'Target');
    const scopes = ['scope1', 'scope2', 'scope3'].filter(k => r[k]).map(k => k.slice(-1));
    const year = r.targetYear1 || r.targetYear2;
    return [
      name,
      scopes.length ? ` (Scope ${scopes.join(', ')})` : '',
      year ? ` by ${year}` : '',
      r.classification ? `, ${r.classification}` : '',
    ].join('');
  }).join('; ');
}

// The tracker's own Intel notes for a company record: Brain's is the kind
// of targets it has, Immune's the disclosure frameworks it reports to
// (`frameworks` as trackerSignals takes them). Only notes the tracker has
// something for are given.
export function trackerNotes(record, { frameworks = null, profile = null, siteList = null } = {}) {
  const out = {};
  const heart = energyShareNote(profile);
  if (heart) out.heart = heart;
  const skeleton = siteFootprintNote(record, siteList);
  if (skeleton) out.skeleton = skeleton;
  const brain = climateTargetSummary(record?.climateTargets);
  if (brain) out.brain = brain;
  const immune = disclosureFrameworkList([...(record?.frameworks || []), ...(frameworks || [])]);
  if (immune) out.immune = immune;
  return out;
}

// Skeleton's Intel notes: how many sites and where, "2,000 sites across 3
// countries" (or "... across 12 states" when they are all in one country).
// The count is the company's Sites field, else its site list's; where they
// are comes from the site list (siteGeography). '' when neither says.
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
export function siteFootprintNote(record, siteList) {
  const geo = siteGeography(siteList);
  const field = Number(String(record?.numberOfSites ?? '').replace(/[,\s]/g, ''));
  const count = Number.isFinite(field) && field > 0 ? Math.round(field) : geo.sites;
  const where = geo.countries > 1 ? plural(geo.countries, 'country', 'countries')
    : geo.states ? plural(geo.states, 'state', 'states')
      : geo.countries === 1 ? '1 country' : '';
  if (!count) return '';
  return where ? `${plural(count, 'site', 'sites')} across ${where}` : plural(count, 'site', 'sites');
}

// Immune's Intel notes: which of the disclosure frameworks the company
// reports to ("GRESB, UN PRI, CSRD"), '' when none of them.
export function disclosureFrameworkList(frameworks) {
  const have = new Set([...(frameworks || [])].map(f => String(f || '').trim().toUpperCase()));
  return ['GRESB', 'CDP', 'UN PRI', 'NZAM', 'CSRD', 'CA SB'].filter(f => have.has(f)).join(', ');
}

// Heart's Intel notes: energy spend as a share of revenue, from tab 1's
// Energy spend ($M/yr) and Revenue ($B) as shown (`profile`, typed or the
// tracker's). Each is read in its row's unit ("40" is $40M a year, "1.63"
// is $1.63B), and a figure written out in full dollars ("200,000,000") is
// read as dollars. '' when either is missing.
const asAmount = (v) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const shortDollars = (d) => (d >= 1e9 ? `$${+(d / 1e9).toFixed(2)}B` : `$${+(d / 1e6).toFixed(1)}M`);
export function energyShareNote(profile) {
  const energy = asAmount(profile?.energySpend);
  const revenue = asAmount(profile?.revenueB);
  if (energy == null || revenue == null) return '';
  const energyDollars = energy >= 1e5 ? energy : energy * 1e6;
  const revenueDollars = revenue >= 1e5 ? revenue : revenue * 1e9;
  const pct = (energyDollars / revenueDollars) * 100;
  const shown = pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
  return `Energy spend is ${+shown}% of revenue (${shortDollars(energyDollars)} of ${shortDollars(revenueDollars)})`;
}

// Where each tracker Intel note comes from, for the tag beside the box.
export const NOTE_SOURCE = { brain: 'Targets', heart: 'Energy spend / Revenue', immune: 'Frameworks', skeleton: 'Sites' };

// Tab 2's ratings as shown: the defaults (DEFAULT_SIGNALS), then the
// tracker's ratings, then what was picked by hand. A sign cleared by hand is
// saved as '' and so stays blank over both.
export function mergeSignals(tracker = {}, saved = {}) {
  return diagnosisSignals({ ...(tracker || {}), ...(saved || {}) });
}

// Schneider footprint from the services assigned to each body system
// (settings.mriSystemServices: system key -> service names, the same for
// every company) and how far this company has got with them on its Services
// board (accountServiceStatuses):
//   SE incumbent     any of them Sold (or up for Renewal, so sold before)
//   Competitor-held  else any of them Not Sold
//   Not yet served   else (not explored yet, or still being worked)
// A system with no services assigned gets nothing. The assignment itself is
// a tracker setting, never written to the export.
const SOLD_STATUSES = new Set(['sold', 'renewal']);
export function footprintFromServices(names, statuses = {}) {
  const list = (names || []).map(n => String(n ?? '').trim()).filter(Boolean);
  if (!list.length) return '';
  const byName = new Map(Object.entries(statuses || {}).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? '').trim().toLowerCase()]));
  const read = list.map(n => byName.get(n.toLowerCase()) || '');
  if (read.some(s => SOLD_STATUSES.has(s))) return 'SE incumbent';
  if (read.includes('not sold')) return 'Competitor-held';
  return 'Not yet served';
}

/** Each body system's footprint from its assigned services, for one company. */
export function trackerFootprint(systemServices, statuses) {
  const out = {};
  for (const system of BODY_SYSTEMS) {
    const v = footprintFromServices(systemServices?.[system.key], statuses);
    if (v) out[system.key] = v;
  }
  return out;
}

// Each body system's footprint as shown: the services' reading, then what
// was picked by hand. A footprint cleared by hand is saved as '' and stays
// blank.
export function mergeFootprint(tracker = {}, saved = {}) {
  const out = {};
  for (const [k, v] of Object.entries({ ...(tracker || {}), ...(saved || {}) })) if (v) out[k] = v;
  return out;
}

// The saved form with the tracker's Diagnosis ratings (and Intel notes,
// trackerNotes, and footprints, trackerFootprint) laid under what was
// picked or typed, for the progress figures and the export (which add the
// defaults).
export function withTrackerSignals(form, tracker, notes = {}, footprint = {}) {
  const f = form || {};
  const d = f.diagnosis || {};
  return {
    ...f,
    diagnosis: {
      ...d,
      signals: { ...(tracker || {}), ...(d.signals || {}) },
      notes: { ...(notes || {}), ...(d.notes || {}) },
      footprint: mergeFootprint(footprint, d.footprint),
    },
  };
}

// ── Tab 4 ────────────────────────────────────────────────────────────────
// `type` is the control and, for the export, how the cell is written: a
// date as a date, percent as a fraction, money as a number.
export const OPPORTUNITY_SECTIONS = [
  {
    title: 'Opportunity background',
    hint: 'from Opportunity Plan › Opportunity Background',
    fields: [
      { row: 5, key: 'name', label: 'Opportunity name' },
      { row: 6, key: 'owner', label: 'Opportunity owner' },
      { row: 7, key: 'planStarted', label: 'Date plan started', type: 'date' },
      { row: 11, key: 'workingSince', label: 'Working on it since', type: 'date' },
      { row: 14, key: 'targetClose', label: 'Target close date', type: 'date' },
      { row: 15, key: 'odds', label: 'Current % odds to close', type: 'percent' },
      { row: 16, key: 'revenue', label: 'Revenue amount ($)', type: 'money' },
      { row: 12, key: 'cameFrom', label: 'It came about from...' },
      { row: 8, key: 'nature', label: 'The nature of the opportunity is...', type: 'textarea' },
      { row: 9, key: 'desiredResult', label: "Client's desired result / outcome", type: 'textarea' },
      { row: 10, key: 'successCriteria', label: 'Success criteria / required return (ROI)', type: 'textarea' },
      { row: 13, key: 'milestones', label: 'Upcoming key milestones & deliverables', type: 'textarea' },
      { row: 17, key: 'barrier', label: 'Most significant selling barrier or challenge', type: 'textarea' },
    ],
  },
  {
    title: 'Value drivers & solution alignment',
    fields: [
      { row: 19, key: 'valueDrivers', label: 'Client situation, the solution offered, and why adopting it makes sense', type: 'textarea', tall: true },
    ],
  },
  {
    title: 'Enterprise efficiency',
    hint: 'from Opportunity Plan › Addl Enterprise Efficiency Info',
    fields: [
      { row: 21, key: 'geography', label: 'Geography / perimeter' },
      { row: 22, key: 'programValue', label: 'Potential program value ($)', type: 'money' },
      { row: 24, key: 'proofOfConcept', label: 'Proof of concept required?', type: 'select', list: 'yesNoTbd' },
      { row: 25, key: 'expansionPath', label: 'Path to program expansion' },
      { row: 23, key: 'projectList', label: 'Potential project list (micro-grid, controls, EMIS...)', type: 'textarea' },
      { row: 26, key: 'keysSchneider', label: 'Keys to success: Schneider', type: 'textarea' },
      { row: 27, key: 'keysClient', label: 'Keys to success: Client', type: 'textarea' },
      { row: 28, key: 'challengesSchneider', label: 'Challenges: Schneider', type: 'textarea' },
      { row: 29, key: 'challengesClient', label: 'Challenges: Client', type: 'textarea' },
    ],
  },
  {
    title: 'Resources · time, people & money',
    fields: [
      { row: 31, key: 'time', label: 'Time: when does the client want results?', type: 'textarea' },
      { row: 32, key: 'timeValidated', label: 'Time: client validated?', type: 'select', list: 'yesNo' },
      { row: 33, key: 'people', label: 'People: resources the client will commit', type: 'textarea' },
      { row: 34, key: 'peopleValidated', label: 'People: client validated?', type: 'select', list: 'yesNo' },
      { row: 35, key: 'money', label: 'Money: investment the client sees as appropriate', type: 'textarea' },
      { row: 36, key: 'moneyValidated', label: 'Money: client validated?', type: 'select', list: 'yesNo' },
    ],
  },
];
export const OPPORTUNITY_FIELDS = OPPORTUNITY_SECTIONS.flatMap(s => s.fields);

// What tab 4 holds when the account has no active opportunity: the name
// says so, every number is 0 and everything else is "-", so the tab reads
// as answered rather than left blank.
export const NO_ACTIVE_OPPORTUNITY = 'No Active Opportunity';
export function noActiveOpportunityValues() {
  const out = {};
  for (const f of OPPORTUNITY_FIELDS) {
    if (f.key === 'name') out[f.key] = NO_ACTIVE_OPPORTUNITY;
    else if (f.type === 'money' || f.type === 'percent' || f.type === 'number') out[f.key] = '0';
    else out[f.key] = '-';
  }
  return out;
}

// Ticking "No active opportunity" keeps what was typed under `beforeNoActive`
// so unticking it brings that back.
export function setNoActiveOpportunity(opportunity = {}, on) {
  const o = opportunity || {};
  if (on) return { ...noActiveOpportunityValues(), noActive: true, beforeNoActive: o.noActive ? o.beforeNoActive : o };
  // Unticked by hand is kept as noActive: false, so the box isn't ticked
  // again on its own (withOpportunityDefault).
  return { ...(o.beforeNoActive || {}), noActive: false };
}

/**
 * The form with "No active opportunity" ticked on its own when the company
 * and its portfolio companies have no live opp (`liveOpps` from
 * accountLiveOpps; null while the opps haven't loaded, which ticks
 * nothing). Only while nobody has touched the box or typed on the tab:
 * ticked or unticked by hand, or a field filled in, and the form is left as
 * it is. The auto-ticked tab carries noActiveAuto, and is never saved.
 */
export function withOpportunityDefault(form, liveOpps) {
  const f = form || {};
  const o = f.opportunity || {};
  if (!liveOpps || liveOpps.own?.length || liveOpps.portfolio?.length) return f;
  if (o.noActive !== undefined || OPPORTUNITY_FIELDS.some(fl => !isBlank(o[fl.key]))) return f;
  return { ...f, opportunity: { ...noActiveOpportunityValues(), noActive: true, noActiveAuto: true } };
}

// A no-opportunity value as the read-only field shows it.
export function noActiveDisplay(field, value) {
  if (field.type === 'money') return `$${value}`;
  if (field.type === 'percent') return `${value}%`;
  return String(value ?? '');
}

// ── Tab 6 ────────────────────────────────────────────────────────────────
export const BUY_STATEMENTS = [
  { row: 5, key: 'businessCase', label: 'Strong business case', meaning: 'Key stakeholders articulated and verified prioritized business issues with quantifiable evidence; constraints are manageable.' },
  { row: 6, key: 'resources', label: 'Resources: time, people & money', meaning: 'Client has realistic expectations on time; division of labor is reasonable; we are in range on economics.' },
  { row: 7, key: 'process', label: 'Defined decision process & criteria', meaning: 'We understand the steps, decisions, timing and people; we have criteria from each decision maker.' },
  { row: 8, key: 'reason', label: 'Compelling reason to act', meaning: 'Economic, regulatory or environmental drivers exist and align with the client strategy.' },
  { row: 9, key: 'relationships', label: 'Relationships with decision-makers', meaning: 'We have met and have green relationships with key decision makers; no red relationship can veto.' },
];
export const OURS_STATEMENTS = [
  { row: 14, key: 'technical', label: 'Technical solution vs. competitors', meaning: 'Our technical solution is unique in a way the client values; competitors cannot meet requirements.' },
  { row: 15, key: 'business', label: 'Business solution vs. competitors', meaning: 'Meets stated business requirements; we are reasonable to do business with; no unmanageable T&Cs.' },
  { row: 16, key: 'relationship', label: 'Relationship strength vs. competitors', meaning: 'Our relationships with decision makers are superior to the competition.' },
  { row: 17, key: 'extra', label: 'Extra advantage', meaning: 'We have unique advantages the client values that are difficult for competitors to address.' },
];

// Win probability by level: rows are "will they buy ours" (HIGH, MED, LOW),
// columns "will they buy" (LOW, MED, HIGH).
export const WIN_LEVELS = ['LOW', 'MED', 'HIGH'];
export const WIN_MATRIX = { HIGH: [0.3, 0.6, 0.8], MED: [0.25, 0.5, 0.6], LOW: [0.15, 0.25, 0.3] };

function ratingBlock(statements, list, ratings, { high, med, floor }) {
  const scores = statements.map(s => Math.max(0, list.indexOf(ratings?.[s.key])));
  const total = scores.reduce((a, b) => a + b, 0);
  const rated = statements.filter(s => list.includes(ratings?.[s.key])).length;
  let level = 'LOW';
  if (total >= high) level = scores.some(n => n < floor) ? 'MED' : 'HIGH';
  else if (total >= med) level = 'MED';
  return { scores, total, rated, level, max: statements.length * 5 };
}

/**
 * The Sales Probability Index as the template works it: both totals and
 * levels, the win probability the two levels meet at (0 until both blocks
 * have a score), and the most the current stage allows (null when the
 * stage is not one of the template's).
 */
export function dealHealthScore(dealHealth = {}, stage = '') {
  const buy = ratingBlock(BUY_STATEMENTS, MRI_LISTS.agree, dealHealth.buy, { high: 19, med: 12, floor: 3 });
  const ours = ratingBlock(OURS_STATEMENTS, MRI_LISTS.advantage, dealHealth.ours, { high: 15, med: 10, floor: 2 });
  const winProbability = buy.total === 0 || ours.total === 0 ? 0 : WIN_MATRIX[ours.level][WIN_LEVELS.indexOf(buy.level)];
  const at = MRI_LISTS.stage.indexOf(String(stage || '').trim());
  return { buy, ours, winProbability, stageCap: at < 0 ? null : MRI_LISTS.stageCap[at] };
}

// ── The list tables ──────────────────────────────────────────────────────
// Where each table's entry rows sit on its sheet (the row above `startRow`
// is the template's grey example, which stays) and what each column holds.
// `width` is the column's share of the popup's table.
const sheet = n => `xl/worksheets/sheet${n}.xml`;
export const MRI_TABLES = {
  committee: {
    path: sheet(3), startRow: 6, endRow: 30,
    columns: [
      { col: 'A', key: 'name', label: 'Name', width: 150 },
      { col: 'B', key: 'title', label: 'Title', width: 150 },
      { col: 'C', key: 'email', label: 'Email', width: 150 },
      { col: 'D', key: 'phone', label: 'Phone', width: 130 },
      { col: 'E', key: 'bodySystem', label: 'Body system', list: 'bodySystem', width: 125 },
      { col: 'F', key: 'buyingRole', label: 'Buying role', list: 'buyingRole', width: 150 },
      { col: 'G', key: 'support', label: 'Level of support', list: 'support', width: 185 },
      { col: 'H', key: 'decisionRole', label: 'Decision role', list: 'decisionRole', width: 110 },
      { col: 'I', key: 'relationship', label: 'Relationship', list: 'relationship', width: 150 },
      { col: 'J', key: 'relOwner', label: 'Rel. owner', width: 140 },
    ],
  },
  pursuitTeam: {
    path: sheet(3), startRow: 35, endRow: 44,
    columns: [
      { col: 'A', key: 'name', label: 'Name', width: 240 },
      { col: 'B', key: 'role', label: 'Role', width: 240 },
    ],
  },
  evidence: {
    path: sheet(4), startRow: 41, endRow: 55,
    columns: [
      { col: 'A', key: 'issue', label: '1. Issue: client problem to solve / result to achieve', width: 300 },
      { col: 'B', key: 'evidence', label: '2. Evidence: current vs. future state', width: 300 },
      { col: 'C', key: 'impact', label: '3. Impact ($)', width: 170 },
      { col: 'D', key: 'importance', label: 'Importance 1–10', type: 'number', width: 110 },
      { col: 'E', key: 'validated', label: 'Client validated?', list: 'yesNo', width: 120 },
    ],
  },
  decisionGrid: {
    path: sheet(6), startRow: 33, endRow: 44,
    columns: [
      { col: 'A', key: 'step', label: 'Step', type: 'number', width: 60 },
      { col: 'B', key: 'decision', label: 'Decision(s)', width: 220 },
      { col: 'C', key: 'when', label: 'When?', width: 120 },
      { col: 'D', key: 'who', label: 'Who is involved?', width: 190 },
      { col: 'E', key: 'criteria', label: 'Criteria / beliefs for deciding', width: 300 },
      { col: 'F', key: 'validated', label: 'Validated?', list: 'yesNo', width: 100 },
    ],
  },
  yellowLights: {
    path: sheet(6), startRow: 49, endRow: 60,
    columns: [
      { col: 'B', key: 'light', label: 'What yellow light has (or might) arise?', width: 360 },
      { col: 'C', key: 'resolve', label: 'How will we resolve it?', width: 360 },
      { col: 'D', key: 'resolved', label: 'Resolved?', list: 'yesNo', width: 100 },
    ],
  },
  closePlan: {
    path: sheet(7), startRow: 5, endRow: 34,
    columns: [
      { col: 'A', key: 'what', label: 'What?', width: 250 },
      { col: 'B', key: 'when', label: 'When?', type: 'date', width: 140 },
      { col: 'C', key: 'who', label: 'Who is responsible?', width: 170 },
      { col: 'D', key: 'endInMind', label: 'End in mind', width: 230 },
      { col: 'E', key: 'results', label: 'Results', width: 230 },
      { col: 'F', key: 'done', label: 'Done', list: 'yesNo', width: 90 },
    ],
  },
};

const rowHasText = (row, columns) => columns.some(c => !isBlank(row?.[c.key]));

/**
 * The buying committee the popup shows: the saved list once somebody has
 * edited it, else the tracker's decision makers (which is what the export
 * wrote before the popup existed).
 */
export function committeeRows(saved, trackerRows = []) {
  if (!Array.isArray(saved)) return trackerRows;
  // A saved row takes the tracker's support, relationship, decision role and
  // rel. owner for any of them never set on it (a field somebody cleared
  // holds '' and stays cleared), so lists saved before those were filled
  // catch up.
  const byId = new Map();
  for (const r of trackerRows) {
    for (const id of [committeeKey(r.email), committeeKey(r.name)]) if (id && !byId.has(id)) byId.set(id, r);
  }
  return saved.map((row) => {
    const from = byId.get(committeeKey(row?.email)) || byId.get(committeeKey(row?.name));
    if (!from) return row;
    let out = row;
    for (const key of TRACKER_COMMITTEE_FIELDS) {
      if (out[key] == null && from[key] != null) out = { ...out, [key]: from[key] };
    }
    return out;
  });
}
const TRACKER_COMMITTEE_FIELDS = ['support', 'relationship', 'decisionRole', 'relOwner'];
const committeeKey = v => String(v || '').trim().toLowerCase();

/**
 * `rows` with any tracker decision maker it does not already hold added at
 * the end, matched on email, else on name. For pulling in people tagged
 * since the committee was first edited.
 */
export function addMissingDecisionMakers(rows, trackerRows = []) {
  const idOf = r => String(r?.email || r?.name || '').trim().toLowerCase();
  const have = new Set((rows || []).map(idOf).filter(Boolean));
  const out = [...(rows || [])];
  for (const r of trackerRows) {
    const id = idOf(r);
    if (!id || have.has(id)) continue;
    have.add(id);
    out.push({ ...r });
  }
  return out;
}

// ── Progress ─────────────────────────────────────────────────────────────
const share = (done, of) => (of > 0 ? Math.round((done / of) * 100) : 0);

/**
 * How far along each tab is, 0 to 100, keyed as MRI_TABS: the share of
 * its fields filled (ratings rated, on Diagnosis and Deal Health; steps
 * done, on Close Plan). The two list tabs are done once they hold a row.
 *
 *   form       what is saved for the company (settings.accountMri[slug])
 *   profile    tab 1 as shown (mergeProfile(...).values)
 *   committee  tab 3 as shown
 *   sites      tab 5 rows
 */
export function tabProgress({ form = {}, profile = {}, committee = [], sites = [] } = {}) {
  const signals = diagnosisSignals(form.diagnosis?.signals);
  const ratedSigns = BODY_SYSTEMS.reduce((n, s) => n + systemScore(s, signals).rated, 0);
  const deal = dealHealthScore(form.dealHealth);
  const steps = (form.closePlan || []).filter(r => rowHasText(r, MRI_TABLES.closePlan.columns));
  return {
    profile: share(MRI_PROFILE_FIELDS.filter(f => !isBlank(profile[f.key])).length, MRI_PROFILE_FIELDS.length),
    diagnosis: share(ratedSigns, BODY_SYSTEMS.length * 4),
    committee: committee.some(r => rowHasText(r, MRI_TABLES.committee.columns)) ? 100 : 0,
    opportunity: share(OPPORTUNITY_FIELDS.filter(f => !isBlank(form.opportunity?.[f.key])).length, OPPORTUNITY_FIELDS.length),
    sites: sites.length ? 100 : 0,
    dealHealth: share(deal.buy.rated + deal.ours.rated, BUY_STATEMENTS.length + OURS_STATEMENTS.length),
    closePlan: share(steps.filter(r => r.done === 'Yes').length, steps.length),
  };
}

/**
 * Where the Account MRI stands overall: the first of the seven tabs that is
 * not finished yet, and how far along it is. `progress` is tabProgress(...).
 * Every tab finished reads as the last tab at 100.
 *
 *   { stage: 1..7, key, label, pct, text: "1 - 55%" }
 */
export function mriStageProgress(progress = {}) {
  let i = MRI_TABS.findIndex(t => !((progress[t.key] || 0) >= 100));
  if (i < 0) i = MRI_TABS.length - 1;
  const t = MRI_TABS[i];
  const pct = Math.min(100, Math.max(0, Math.round(progress[t.key] || 0)));
  return { stage: i + 1, key: t.key, label: t.label, pct, text: `${i + 1} - ${pct}%` };
}

// ── Export ───────────────────────────────────────────────────────────────
// "2026-12-15" as the day number a spreadsheet stores a date as, or null.
export function dateSerial(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const days = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 + 25569;
  return Number.isFinite(days) ? days : null;
}
/**
 * A money box's text as it should read: a dollar sign and thousands
 * commas ("1350000" -> "$1,350,000"), keeping a decimal point and up to two
 * cents digits as they are typed. Anything that isn't a digit, the first
 * point or a leading minus is dropped; no digits at all reads as blank.
 * amount() strips the "$" and commas back off, so the export is unchanged.
 */
export function formatMoneyInput(raw) {
  return formatNumberInput(raw, '$');
}

// A number as typed, grouped with commas and led by `prefix` ('$' for money,
// '' for a count): "2000" -> "2,000". '' when there is no digit.
export function formatNumberInput(raw, prefix = '') {
  const s = String(raw ?? '').trim();
  const negative = s.startsWith('-');
  const cleaned = s.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  const whole = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const cents = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  if (!whole && cents == null) return '';
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${prefix}${grouped}${cents == null ? '' : `.${cents}`}`;
}

// Tab 1 values as the Account MRI table shows them, matching the popup:
// dollar rows with "$" and commas, counts with commas, the rest as they are.
const PROFILE_MONEY = new Set(['revenueB', 'energySpend']);
export function profileDisplayValue(key, value) {
  if (value == null || value === '') return '';
  if (PROFILE_MONEY.has(key)) return formatMoneyInput(value) || String(value);
  if (key === 'sites') return formatNumberInput(value) || String(value);
  return String(value);
}

const amount = v => {
  const n = Number(String(v ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// A typed value as the cell it becomes: { value, number }. A value that
// will not read as its type goes across as the text it is.
function cellFor(value, type) {
  if (isBlank(value)) return null;
  if (type === 'date') {
    const n = dateSerial(value);
    return n == null ? { value: String(value) } : { value: n, number: true };
  }
  if (type === 'percent') {
    const n = amount(value);
    return n == null ? { value: String(value) } : { value: n / 100, number: true };
  }
  if (type === 'money' || type === 'number') {
    const n = amount(value);
    return n == null ? { value: String(value) } : { value: n, number: true };
  }
  return { value: String(value) };
}

/**
 * Everything typed into the popup beyond tabs 1, 3 and 5, as what
 * fillAccountMriWorkbook writes: `cells` (single cells by sheet) and
 * `tables` (the list tables, lowest on each sheet first, so a table that
 * grows does not move one still to be written).
 */
export function mriFormExport(form = {}) {
  const cells = {};
  const put = (path, ref, value, type) => {
    const cell = cellFor(value, type);
    if (cell) (cells[path] ||= []).push({ ref, ...cell });
  };
  const d = form.diagnosis || {};
  const signals = diagnosisSignals(d.signals);
  const notes = diagnosisNotes(d.notes);
  for (const system of BODY_SYSTEMS) {
    for (const s of system.signs) put(sheet(2), `D${s.row}`, signals[s.key]);
    put(sheet(2), `D${system.summaryRow}`, d.footprint?.[system.key]);
    put(sheet(2), `E${system.summaryRow}`, notes[system.key]);
  }
  put(sheet(2), RAW_INTEL_CELL, d.rawIntel);
  for (const f of OPPORTUNITY_FIELDS) put(sheet(4), `B${f.row}`, form.opportunity?.[f.key], f.type);
  for (const s of BUY_STATEMENTS) put(sheet(6), `D${s.row}`, form.dealHealth?.buy?.[s.key]);
  for (const s of OURS_STATEMENTS) put(sheet(6), `D${s.row}`, form.dealHealth?.ours?.[s.key]);

  const table = (def, rows) => ({
    path: def.path,
    startRow: def.startRow,
    endRow: def.endRow,
    columns: def.columns.map(c => ({ col: c.col, key: c.key, number: c.type === 'number' || c.type === 'date' })),
    rows: (rows || []).filter(r => rowHasText(r, def.columns)).map(r => {
      const out = {};
      for (const c of def.columns) {
        const cell = cellFor(r[c.key], c.type);
        if (cell) out[c.key] = cell.value;
      }
      return out;
    }),
  });
  return {
    cells,
    tables: [
      table(MRI_TABLES.pursuitTeam, form.pursuitTeam),
      table(MRI_TABLES.evidence, form.evidence),
      table(MRI_TABLES.yellowLights, form.dealHealth?.yellowLights),
      table(MRI_TABLES.decisionGrid, form.dealHealth?.decisionGrid),
      table(MRI_TABLES.closePlan, form.closePlan),
    ],
  };
}

/** The key a company's Account MRI is saved under in settings.accountMri. */
export function mriSlug(company) {
  return String(company || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
