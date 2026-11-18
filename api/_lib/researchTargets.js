// The Targets tab's "Research targets" button: the prompt that has Claude
// look a company's climate targets up on the web, and the cleaning that
// turns whatever comes back into rows shaped exactly like the ones the tab
// stores (see src/utils/companyTargets.js). Pure, so it is tested without
// the network (scripts/researchTargets.test.mjs).
//
// The point of the button is a standard result: the same columns, the same
// spellings and one row per target for every company, where pasting a
// search engine's summary gave whatever the summary happened to say
// (progress figures read as targets, the same target twice).

// The Target Types offered when the caller sends no list of its own.
export const STANDARD_TARGET_TYPES = [
  'Net zero',
  'Carbon neutral',
  'SBTi near-term',
  'SBTi long-term',
  'Absolute emissions reduction',
  'Emissions intensity reduction',
  'Renewable electricity (RE100)',
];
export const CLASSIFICATIONS = ['1.5°C', 'Well-below 2°C', '2°C'];
export const STATUSES = ['Validated Targets', 'Committed', 'Self-declared'];
const ACTIONS = ['Target', 'Commitment'];
const MAX_TARGETS = 12;
const MAX_TYPES = 40;

const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const key = v => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');

// The caller's Target Type list (the user's own vocabulary) with the
// standard ones behind it, de-duped, so the model picks names the user
// already uses.
export function allowedTypes(custom) {
  const out = [];
  const seen = new Set();
  for (const t of [...(Array.isArray(custom) ? custom : []), ...STANDARD_TARGET_TYPES]) {
    const name = text(t, 60);
    // "No target set" is a row the tab logs itself, never a kind of target.
    if (!name || key(name) === 'notargetset' || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push(name);
    if (out.length >= MAX_TYPES) break;
  }
  return out;
}

export function buildSystemPrompt(types) {
  return `You are a sustainability research analyst. For the requested company, use web search to find the climate and energy targets the company itself has publicly set, and report them in a fixed structure.

Where to look, in this order: the SBTi target dashboard (sciencebasedtargets.org), the company's own sustainability / ESG / impact report and website, then CDP, RE100 and reputable news. Prefer the most recent source.

What counts as a target: a forward-looking goal the company has committed to, with a year it must be met by. Do NOT report progress already achieved ("reduced emissions 14.5% since 2019" is a result, not a target), goals of a parent company or an industry body unless the company has adopted them as its own, or vague aspirations with no year.

One entry per distinct target. A net-zero goal and an interim reduction goal are two entries. Never list the same target twice because two sources mention it: merge them into one entry carrying everything known.

Return ONLY a single JSON object (no prose, no markdown fences) with these fields:
- targets: array of objects, each with:
  - action: "Commitment" for an SBTi commitment that has no validated target yet, otherwise "Target".
  - type: the kind of target. Use one of these exact names when one fits: ${types.map(t => `"${t}"`).join(', ')}. Use "SBTi commitment" for an SBTi commitment. Only when none fits, a short name of your own (3 words at most).
  - commitmentType: for a Commitment only, SBTi's commitment type (e.g. "Net-zero", "Standard"). Otherwise "".
  - yearSet: 4-digit year the target was set, announced or last validated. "" if not stated.
  - baseYear: 4-digit base year the reduction is measured from. "" if none or not stated.
  - targetYear1: 4-digit year the target must be met by.
  - targetYear2: a second milestone year of the SAME target, else "".
  - scope1, scope2, scope3: booleans, true only when the source says the target covers that scope. A net-zero or carbon-neutral goal stated for "operations" covers scopes 1 and 2. When the source names no scopes, all false.
  - classification: the temperature ambition, exactly one of ${CLASSIFICATIONS.map(c => `"${c}"`).join(', ')}, or "" if not stated.
  - status: exactly one of "Validated Targets" (validated by the SBTi), "Committed" (committed to the SBTi, not yet validated), "Self-declared" (the company's own goal, no SBTi involvement), or "" if unclear.
  - datePublished: the date the SBTi lists as published, as YYYY-MM-DD, else "".
  - detail: one plain sentence stating the target in the company's own terms, with the figure (e.g. "Cut absolute Scope 1 and 2 emissions 50% by 2030 from a 2019 base year").
  - sourceUrl: the page this target was read from.
- noTargetFound: true only when your searches turned up no target of any kind for this company. Then targets is [].
- summary: 1-2 sentences on what was found and how sure it is. Say so when the targets belong to a parent company, when sources disagree, or when public information is thin.
- sources: array of { title, url }: the pages used, most authoritative first. Up to 6.

Never guess a year or a scope to fill a field. A blank is correct when the source does not say.`;
}

export function buildUserPrompt({ company, domain }) {
  const where = domain ? ` (website: ${domain})` : '';
  return `Research the climate and energy targets set by "${company}"${where}. Return the JSON object as specified.`;
}

const year = (v) => {
  const m = String(v ?? '').match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  return m ? m[1] : '';
};
const flag = v => v === true || /^(true|yes|y|1)$/i.test(String(v ?? '').trim());
const oneOf = (v, list) => list.find(x => key(x) === key(v)) || '';
const httpUrl = (v) => {
  const u = String(v ?? '').trim();
  return /^https?:\/\/\S+$/i.test(u) ? u.slice(0, 500) : '';
};
const isoDate = (v) => (String(v ?? '').match(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/) || [''])[0];

// How a type the model wrote maps onto the names on the list: the list's
// own spelling when it matches ignoring case and punctuation ("Net-Zero"
// lands as "Net zero"), else the model's name, kept short.
function cleanType(raw, action, types) {
  const t = text(raw, 60);
  if (action === 'Commitment' && (!t || /commit/i.test(t))) return 'SBTi commitment';
  return oneOf(t, types) || t;
}

// Whatever the model returned, as rows the tab can merge in as they are,
// plus the note and links shown beside them. Rows with no kind and no
// target year are dropped, as are repeats.
export function cleanResearchedTargets(parsed, types = STANDARD_TARGET_TYPES) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const seen = new Set();
  const targets = [];
  for (const r of Array.isArray(src.targets) ? src.targets : []) {
    if (!r || typeof r !== 'object') continue;
    const action = oneOf(r.action, ACTIONS) || 'Target';
    const row = {
      action,
      type: cleanType(r.type, action, types),
      commitmentType: action === 'Commitment' ? text(r.commitmentType, 40) : '',
      yearSet: year(r.yearSet),
      baseYear: year(r.baseYear),
      targetYear1: year(r.targetYear1),
      targetYear2: year(r.targetYear2),
      scope1: flag(r.scope1),
      scope2: flag(r.scope2),
      scope3: flag(r.scope3),
      classification: oneOf(r.classification, CLASSIFICATIONS),
      status: oneOf(r.status, STATUSES),
      datePublished: isoDate(r.datePublished),
      detail: text(r.detail, 300),
      sourceUrl: httpUrl(r.sourceUrl),
    };
    if (row.targetYear2 === row.targetYear1) row.targetYear2 = '';
    if (!row.type || (!row.targetYear1 && action !== 'Commitment')) continue;
    if (!row.yearSet) row.yearSet = year(row.datePublished);
    const id = [row.action, row.type, row.baseYear, row.targetYear1, row.targetYear2, row.scope1, row.scope2, row.scope3].join('|').toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push(row);
    if (targets.length >= MAX_TARGETS) break;
  }
  const sources = (Array.isArray(src.sources) ? src.sources : [])
    .filter(o => o && typeof o === 'object')
    .map(o => ({ title: text(o.title || o.name || o.url, 160), url: httpUrl(o.url || o.href) }))
    .filter(o => o.url)
    .slice(0, 6);
  return {
    targets,
    noTargetFound: targets.length === 0 && flag(src.noTargetFound),
    summary: text(src.summary, 600),
    sources,
  };
}
