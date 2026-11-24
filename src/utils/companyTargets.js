// A company's sustainability targets, logged by hand on the company popup's
// Targets tab. Stored on the company record as `climateTargets`: an array of
//   { id, action, type, value, commitmentType, yearSet, baseYear, targetYear1, targetYear2,
//     scope1, scope2, scope3, classification, status, datePublished, sourceUrl, hidden }
// `action` is SBTi's Action column, "Target" or "Commitment"; a row saved
// before it existed reads as a Commitment when its type is SBTi commitment,
// else as a Target. `commitmentType` is a commitment's kind ("Net-zero",
// "Standard", "BA1.5 Option 2"); `datePublished` is the date SBTi lists,
// as given ("2024-04-25"), and its year is the Year Set a paste fills in.
// `value` is the size of the target as the source words it, mostly a
// percentage ("50%", "15%"); free text, blank for a target with no number
// to it (net zero) and for every row logged before the column existed.
// `sourceUrl` is a link to where the target is stated (the company's report,
// its SBTi entry): typed on the tab, or the Source column of a pasted table.
// `hidden` greys the row out on the tab (kept, not deleted: an old target
// worth remembering but not worth reading past).
// `reachedOut` is Prospecting > Targets' Reached Out tick for this one
// target. It is only on a row once that box has been ticked or cleared; a
// row without it falls back to the company-wide tick the page kept before
// the tick was per target (see targetReachedOut).
// `classification` is the target's ambition (SBTi's "1.5°C", "Well-below
// 2°C"). Commitments pasted before commitmentType existed carried their
// commitment type here; normalize moves it across. `status` is free
// text ("Validated Targets", "Committed"). Both arrive mostly by pasting the
// SBTi dashboard's table, see parsePastedTargets.
// `yearSet` is the year the company set (or last refreshed) the target; the
// refresh it is due for is REFRESH_CYCLE_YEARS after that, worked out here
// rather than stored so changing the year set moves it too.
// Years are kept as the 4-digit strings typed (or '' when blank) so a
// half-typed year in the box is never coerced; the scope flags are booleans.

export const TARGET_SCOPES = ['scope1', 'scope2', 'scope3'];
export const TARGET_YEAR_KEYS = ['yearSet', 'baseYear', 'targetYear1', 'targetYear2'];

// Targets are refreshed every five years (SBTi's revalidation cycle).
export const REFRESH_CYCLE_YEARS = 5;

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const TARGET_ACTIONS = ['Target', 'Commitment'];

export function blankTarget() {
  return {
    id: newId(), action: 'Target', type: '', value: '', commitmentType: '', yearSet: '', baseYear: '', targetYear1: '', targetYear2: '',
    scope1: false, scope2: false, scope3: false, classification: '', status: '', datePublished: '', sourceUrl: '', hidden: false,
  };
}

// The company popup's "No Target Set" button logs this row: a record that
// the company was checked and has no target, so it reads as answered rather
// than not yet looked at. No action, no years (so no refresh date); it can
// be edited or deleted like any other row.
export const NO_TARGET_TYPE = 'No target set';

export function noTargetRow() {
  return { ...blankTarget(), action: '', type: NO_TARGET_TYPE };
}

export function isNoTargetRow(row) {
  return String(row?.type || '').trim().toLowerCase() === NO_TARGET_TYPE.toLowerCase();
}

export function hasNoTargetRow(list) {
  return normalizeTargets(list).some(isNoTargetRow);
}

// Does the Targets tab hold anything at all? A row only counts once
// something is filled in: the Action every new row starts with ('Target')
// and the Hide tick are not values. A "No target set" row counts: it is
// the answer that the company was checked and has none. (The Issues tab's
// "No targets" row, utils/clientIssues.)
export function hasTargetValues(list) {
  return normalizeTargets(list).some(r => isNoTargetRow(r)
    || ['type', 'value', 'commitmentType', ...TARGET_YEAR_KEYS, 'classification', 'status', 'datePublished', 'sourceUrl'].some(k => String(r[k] || '').trim())
    || TARGET_SCOPES.some(k => r[k]));
}

// The link as an address a browser can open, or '' when it isn't one.
// "example.com/esg" gains https://; anything that is not a web address
// (javascript:, plain words) gives '', so a typed value is never rendered
// as a link that does something other than open a page.
export function targetLinkHref(value) {
  const v = String(value ?? '').trim();
  if (!v || /\s/.test(v)) return '';
  const url = /^https?:\/\//i.test(v) ? v : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v) ? `https://${v}` : '';
  try { return url ? new URL(url).href : ''; } catch { return ''; }
}

// "sciencebasedtargets.org" for the link's label.
export function targetLinkLabel(value) {
  const href = targetLinkHref(value);
  return href ? new URL(href).hostname.replace(/^www\./, '') : '';
}

// Digits only, at most four: the year boxes accept nothing else.
export function cleanYear(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 4);
}

// Whatever is on the record, as a clean list. Anything that isn't an object
// is dropped, and missing fields get their blank value, so the tab never
// has to guard against a partly-written row.
export function normalizeTargets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r === 'object')
    .map(r => {
      const type = String(r.type || '');
      const isCommitment = type === COMMITMENT_TYPE;
      let commitmentType = String(r.commitmentType || '');
      let classification = String(r.classification || '');
      // A commitment saved before commitmentType existed held it in classification.
      if (r.commitmentType === undefined && isCommitment && classification) {
        commitmentType = classification;
        classification = '';
      }
      return {
        id: String(r.id || newId()),
        action: r.action === undefined ? (isCommitment ? 'Commitment' : type ? 'Target' : '') : String(r.action || ''),
        type,
        value: String(r.value || '').trim(),
        commitmentType,
        yearSet: cleanYear(r.yearSet),
        baseYear: cleanYear(r.baseYear),
        targetYear1: cleanYear(r.targetYear1),
        targetYear2: cleanYear(r.targetYear2),
        scope1: !!r.scope1,
        scope2: !!r.scope2,
        scope3: !!r.scope3,
        classification,
        status: String(r.status || ''),
        datePublished: String(r.datePublished || ''),
        sourceUrl: String(r.sourceUrl || '').trim(),
        hidden: !!r.hidden,
        ...(typeof r.reachedOut === 'boolean' ? { reachedOut: r.reachedOut } : {}),
      };
    });
}

// The list with one row's field changed. Year fields are cleaned on the way in.
export function updateTarget(list, id, key, value) {
  const v = TARGET_YEAR_KEYS.includes(key) ? cleanYear(value)
    : (TARGET_SCOPES.includes(key) || key === 'hidden' || key === 'reachedOut') ? !!value
      : String(value ?? '');
  return normalizeTargets(list).map(r => (r.id === id ? { ...r, [key]: v } : r));
}

export function removeTarget(list, id) {
  return normalizeTargets(list).filter(r => r.id !== id);
}

// Has this target been reached out about? Its own tick once it has one.
// Before the tick was per target it was one per company (`targetsReachedOut`
// on the company record), and a target nobody has ticked or cleared since
// still reads that, so the ticks made back then are not lost.
export function targetReachedOut(target, prospect) {
  if (typeof target?.reachedOut === 'boolean') return target.reachedOut;
  return !!prospect?.targetsReachedOut;
}

// "1, 2" / "1, 2, 3" / "" - the scopes a target covers, for export and filters.
export function scopesLabel(row) {
  return TARGET_SCOPES.filter(k => row?.[k]).map(k => k.slice(-1)).join(', ');
}

// When the target is due its refresh: year set + 5. Deliberately not rolled
// forward to the next cycle once that year passes - a refresh nobody logged
// should read as overdue, and logging it is changing the year set.
//   { year: 2029, status: 'upcoming' | 'due' | 'overdue', label }
// or null when no year set is logged.
export function refreshDue(row, thisYear = new Date().getFullYear()) {
  const set = Number(row?.yearSet);
  if (!row?.yearSet || String(row.yearSet).length !== 4 || !Number.isFinite(set)) return null;
  const year = set + REFRESH_CYCLE_YEARS;
  const status = year < thisYear ? 'overdue' : year === thisYear ? 'due' : 'upcoming';
  const label = status === 'overdue' ? 'Overdue' : status === 'due' ? 'Due this year' : 'Upcoming';
  return { year, status, label };
}

// ---- Bulk paste ---------------------------------------------------------
// The Targets tab takes a pasted table, shaped like the SBTi target
// dashboard's "Targets / Commitments" table:
//   Action | Commitment Type | Status | Target | Scope | Target Classification
//   | Base Year | Target Year | Date Published
// with or without that header row. Copied from a web page it arrives
// tab-separated; some pages copy as one cell per line instead, which is
// handled by chunking the lines into rows of the header's width.

// Pasted header -> field. Matched on the header lowercased with everything
// but letters and digits dropped, so "TARGET  CLASSIFICATION" still matches.
const PASTE_HEADERS = {
  action: 'action',
  commitmenttype: 'commitmentType',
  status: 'status',
  target: 'target',
  targettype: 'target',
  type: 'target',
  scope: 'scope',
  scopes: 'scope',
  targetclassification: 'classification',
  classification: 'classification',
  ambition: 'classification',
  baseyear: 'baseYear',
  targetyear: 'targetYear',
  targetyear1: 'targetYear',
  targetyear2: 'targetYear2',
  datepublished: 'datePublished',
  published: 'datePublished',
  source: 'sourceUrl',
  sourceurl: 'sourceUrl',
  sourcelink: 'sourceUrl',
  link: 'sourceUrl',
  url: 'sourceUrl',
  yearset: 'yearSet',
  value: 'value',
  targetvalue: 'value',
  reduction: 'value',
  percent: 'value',
  percentage: 'value',
};
// The SBTi table's column order, for a paste without its header row.
const SBTI_ORDER = ['action', 'commitmentType', 'status', 'target', 'scope', 'classification', 'baseYear', 'targetYear', 'datePublished'];

const headerKey = (cell) => PASTE_HEADERS[String(cell ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')];

// "NA", "N/A", "-", "n.a." and blanks all mean nothing was given.
function pasteValue(cell) {
  const v = String(cell ?? '').replace(/\s+/g, ' ').trim();
  if (!v || /^(n\/?a|n\.a\.?|none|-+|–|—)$/i.test(v)) return '';  // em-dash-ok: a pasted cell holding only a dash means blank
  return v;
}

// The first plausible 4-digit year in a cell: "2019", "2024-12-05", "FY2030".
function pasteYear(cell) {
  const m = String(cell ?? '').match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  return m ? m[1] : '';
}

// A Value cell, tidied: "15 %" and "15 percent" both read "15%". Anything
// that is more than a bare percentage is kept as written.
export function pasteTargetValue(cell) {
  const v = pasteValue(cell);
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)$/i);
  return m ? `${m[1]}%` : v;
}

// SBTi's target names onto the standard Target Type list's spelling, so a
// pasted "Net-zero" lands as the "Net zero" already on the list.
const TYPE_ALIASES = {
  netzero: 'Net zero',
  nearterm: 'SBTi near-term',
  longterm: 'SBTi long-term',
};
export const COMMITMENT_TYPE = 'SBTi commitment';

function rowAction(action, target) {
  if (/^commit/i.test(action)) return 'Commitment';
  if (/^target/i.test(action)) return 'Target';
  return action || (target ? 'Target' : '');
}

function rowType(action, target) {
  if (/^commit/i.test(action) && !target) return COMMITMENT_TYPE;
  return TYPE_ALIASES[target.toLowerCase().replace(/[^a-z0-9]/g, '')] || target;
}

// A table written with pipes, as an AI chat gives it back (the Search web
// menu's "Ask ChatGPT / Claude" prompt asks for exactly this):
//   Action | Target Type | Year Set | ...
//   Target | Net zero | 2021 | ...
// with or without the outer pipes and the |---|---| rule of a markdown
// table, and with or without the ``` fence around it. null when the text
// isn't one: it takes two lines with pipes, the first with two or more.
const PIPE_RULE = /^[\s|:-]+$/;
export function pipeGrid(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^```/.test(l));
  const pipes = l => (l.match(/\|/g) || []).length;
  const piped = lines.filter(l => pipes(l) >= 1);
  if (piped.length < 2 || pipes(piped[0]) < 2 || lines.some(l => l.includes('\t'))) return null;
  return piped
    .filter(l => !PIPE_RULE.test(l))
    .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
}

// Split the pasted text into rows of cells, header row (if any) first.
function pasteGrid(text) {
  const piped = pipeGrid(text);
  if (piped) return piped;
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.some(l => l.includes('\t'))) {
    return lines.filter(l => l.trim()).map(l => l.split('\t'));
  }
  // One cell per line: the header (if present) sets the width, else the
  // SBTi table's nine columns.
  const cells = lines.map(l => l.trim()).filter(Boolean);
  // The header runs until a cell that isn't a header name, or is one we've
  // had already (the first row's "Target" under an ACTION header).
  let width = 0;
  const seenHeaders = new Set();
  while (width < cells.length && headerKey(cells[width]) && !seenHeaders.has(headerKey(cells[width]))) {
    seenHeaders.add(headerKey(cells[width]));
    width += 1;
  }
  if (width < 3) width = SBTI_ORDER.length;
  const grid = [];
  for (let i = 0; i < cells.length; i += width) grid.push(cells.slice(i, i + width));
  return grid;
}

// ---- Free text ----------------------------------------------------------
// The paste box also reads a target written as prose, as copied out of a
// sustainability report or a news story:
//   "Realterm aims to achieve net-zero Scope 1 and Scope 2 emissions by 2050"
// Each sentence that names a target year or a kind of target becomes a row.
// It is read as prose when nothing is tab-separated and some line runs to
// six words or more; the SBTi table copied one cell per line never does.

// Kind of target, first match wins (net zero before the reductions, since a
// net-zero sentence often mentions reducing on the way there).
const FREE_TEXT_TYPES = [
  [/\bnet[\s-]*zero\b/i, 'Net zero'],
  [/\bcarbon[\s-]*neutral(ity)?\b|\bclimate[\s-]*neutral(ity)?\b/i, 'Carbon neutral'],
  [/\bnet[\s-]*positive\b|\bcarbon[\s-]*negative\b|\bclimate[\s-]*positive\b/i, 'Net positive'],
  [/\bRE100\b|\brenewable (electricity|energy|power)\b/i, 'Renewable electricity (RE100)'],
  [/\bnear[\s-]*term\b/i, 'SBTi near-term'],
  [/\blong[\s-]*term\b/i, 'SBTi long-term'],
  [/\bintensity\b/i, 'Emissions intensity reduction'],
  [/\b(reduc\w*|cut\w*|lower\w*|decreas\w*)\b[^.]*?\d+(\.\d+)?\s*(%|percent)|\d+(\.\d+)?\s*(%|percent)[^.]*?\b(reduc\w*|cut\w*|lower\w*|decreas\w*)\b/i, 'Absolute emissions reduction'],
];

const YEAR = '((?:19|20)\\d{2})(?!\\d)';

export function looksLikeFreeText(text) {
  const t = String(text ?? '');
  if (!t.trim() || t.includes('\t')) return false;
  return t.split(/\r?\n/).some(l => l.trim().split(/\s+/).length >= 6);
}

// Scopes named in a sentence: "Scope 1 and Scope 2", "Scopes 1, 2 and 3",
// "Scope 1+2", "scope 1-3".
function freeTextScopes(sentence) {
  const found = new Set();
  const re = /\bscopes?\s*((?:[123](?:\s*(?:,|and|&|\+|\/|-|–|to)\s*(?:scope\s*)?)?)+)/gi;
  let m;
  while ((m = re.exec(sentence))) {
    const part = m[1];
    const range = part.match(/([123])\s*(?:-|–|to)\s*([123])/);
    if (range) for (let n = Number(range[1]); n <= Number(range[2]); n += 1) found.add(n);
    for (const d of part.match(/[123]/g) || []) found.add(Number(d));
  }
  return { scope1: found.has(1), scope2: found.has(2), scope3: found.has(3) };
}

function freeTextRow(sentence) {
  const s = sentence.replace(/\s+/g, ' ').trim();
  const type = (FREE_TEXT_TYPES.find(([re]) => re.test(s)) || [])[1] || '';
  const baseYear = (s.match(new RegExp(`\\b(?:base(?:line)?(?: year)?(?: of)?|from|against|vs\\.?|versus|relative to|compared (?:to|with))\\s+(?:a |the |its |fiscal |FY ?)?${YEAR}`, 'i'))
    || s.match(new RegExp(`${YEAR}\\s+(?:base(?:line)?|levels?)\\b`, 'i')) || [])[1] || '';
  const yearSet = (s.match(new RegExp(`\\b(?:set|announced|committed|pledged|published|adopted|launched)\\b[^.]{0,30}?\\b(?:in|during)\\s+${YEAR}`, 'i'))
    || s.match(new RegExp(`\\b(?:in|during)\\s+${YEAR},`, 'i')) || [])[1] || '';
  const targetYears = [];
  const re = new RegExp(`\\b(?:by|before|in|until|through|no later than|ahead of|to)\\s+(?:the end of |end of |year[- ]end |FY ?|fiscal (?:year )?)?${YEAR}`, 'gi');
  let m;
  while ((m = re.exec(s))) {
    const y = m[1];
    if (y !== baseYear && y !== yearSet && !targetYears.includes(y)) targetYears.push(y);
  }
  const classification = /well[\s-]*below\s*2\s*°?\s*C/i.test(s) ? 'Well-below 2°C'
    : /1\.5\s*°?\s*C/i.test(s) ? '1.5°C'
      : /\b2\s*°\s*C/i.test(s) ? '2°C' : '';
  return {
    ...blankTarget(),
    action: 'Target',
    type,
    // The first percentage the sentence gives: "cut emissions 46% by 2030".
    value: ((s.match(/(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/i) || [])[1] || '').replace(/^(.+)$/, '$1%'),
    yearSet,
    baseYear,
    targetYear1: targetYears[0] || '',
    targetYear2: targetYears[1] || '',
    ...freeTextScopes(s),
    classification,
    status: /\b(SBTi[\s-]*)?validated\b/i.test(s) ? 'Validated Targets' : '',
  };
}

export function parseFreeTextTargets(text) {
  // Sentence ends: . ! ? ; or a line break. A decimal point ("1.5°C") or an
  // abbreviation followed by a lower-case word doesn't split.
  const sentences = String(text ?? '')
    .split(/\n+|(?<=[.!?;])\s+(?=[A-Z(])/)
    .map(x => x.trim())
    .filter(Boolean);
  const rows = [];
  let skipped = 0;
  for (const sentence of sentences) {
    const row = freeTextRow(sentence);
    if (row.type || row.targetYear1) { rows.push(row); continue; }
    // "The targets were validated by SBTi as consistent with 1.5°C." names
    // no target of its own but describes the ones before it.
    if (rows.length && (row.classification || row.status)) {
      for (const r of rows) {
        if (!r.classification) r.classification = row.classification;
        if (!r.status) r.status = row.status;
      }
      continue;
    }
    skipped += 1;
  }
  return { rows, skipped };
}

// Parse a pasted table into target rows (with fresh ids).
//   { rows, skipped }  skipped counts lines that held nothing usable.
// A pipe-delimited table (an AI chat's answer) is read like any other.
// Prose instead of a table goes to parseFreeTextTargets.
export function parsePastedTargets(text) {
  if (!pipeGrid(text) && looksLikeFreeText(text)) return parseFreeTextTargets(text);
  const grid = pasteGrid(text);
  if (!grid.length) return { rows: [], skipped: 0 };
  // A header row is one where most of the cells are names we know.
  const first = grid[0].map(headerKey);
  const known = first.filter(Boolean).length;
  const hasHeader = known >= 2 && known >= Math.ceil(grid[0].filter(c => String(c).trim()).length / 2);
  const fields = hasHeader ? first : SBTI_ORDER;
  const body = hasHeader ? grid.slice(1) : grid;

  const rows = [];
  let skipped = 0;
  for (const cells of body) {
    const rec = {};
    fields.forEach((f, i) => { if (f && rec[f] === undefined) rec[f] = cells[i]; });
    const action = pasteValue(rec.action);
    const target = pasteValue(rec.target);
    const type = rowType(action, target);
    const scope = pasteValue(rec.scope);
    const commitmentType = pasteValue(rec.commitmentType);
    const row = {
      ...blankTarget(),
      action: rowAction(action, target),
      type,
      value: pasteTargetValue(rec.value),
      commitmentType,
      yearSet: pasteYear(rec.yearSet) || pasteYear(rec.datePublished),
      baseYear: pasteYear(rec.baseYear),
      targetYear1: pasteYear(rec.targetYear),
      targetYear2: pasteYear(rec.targetYear2),
      scope1: /1/.test(scope),
      scope2: /2/.test(scope),
      scope3: /3/.test(scope),
      classification: pasteValue(rec.classification),
      status: pasteValue(rec.status),
      datePublished: pasteValue(rec.datePublished),
      // Only something that opens as a web page: a Source cell reading
      // "Annual report 2024" is not a link.
      sourceUrl: targetLinkHref(pasteValue(rec.sourceUrl)) ? pasteValue(rec.sourceUrl) : '',
    };
    // The AI prompt's answer for a company with none: the row the tab's own
    // No Target Set button logs, with no action.
    if (isNoTargetRow(row)) { rows.push({ ...noTargetRow(), id: row.id }); continue; }
    const anything = row.type || row.value || row.baseYear || row.targetYear1 || row.yearSet || row.classification || row.commitmentType;
    if (anything) rows.push(row); else skipped += 1;
  }
  return { rows, skipped };
}

// Two rows describe the same target when their core fields match and the
// detail fields (filled in by later versions of the paste) don't disagree:
// blank on either side counts as agreeing, so re-pasting a table onto rows
// logged before Action / Commitment Type / Date Published existed matches
// them and fills those in, rather than adding the targets a second time.
// Value is one of them: a re-paste fills in the percentage on a row logged
// before the column existed, while two targets alike in everything but
// their percentage stay two rows.
const DETAIL_KEYS = ['action', 'value', 'commitmentType', 'datePublished'];
// Filled in on a match like the detail fields, but never part of deciding
// one: the same target read off two different pages is still one target.
const FILL_ONLY_KEYS = ['sourceUrl'];
const norm = v => String(v ?? '').trim().toLowerCase();
function targetKey(r) {
  return [r.type, r.yearSet, r.baseYear, r.targetYear1, r.targetYear2, scopesLabel(r), r.classification, r.status]
    .map(norm).join('|');
}
function sameTarget(a, b) {
  return targetKey(a) === targetKey(b)
    && DETAIL_KEYS.every(k => !norm(a[k]) || !norm(b[k]) || norm(a[k]) === norm(b[k]));
}

// The list with the pasted rows appended, leaving out any that are already
// on it (pasting the same table twice adds nothing) or repeated in the paste.
// A pasted row matching one already logged fills in that row's blank detail
// fields; `updated` counts the rows that gained something.
//   { list, added, duplicates, updated }
export function mergePastedTargets(existing, pasted) {
  const list = normalizeTargets(existing);
  const matched = new Set();
  let added = 0;
  let duplicates = 0;
  let updated = 0;
  for (const r of normalizeTargets(pasted)) {
    // Each logged row absorbs at most one pasted row, so two commitments
    // that differ only in commitment type don't both land on one old row.
    // Rows added by this paste stay matchable, so a repeat in the paste is
    // skipped.
    const i = list.findIndex(x => !matched.has(x.id) && sameTarget(x, r));
    if (i === -1) { list.push(r); added += 1; continue; }
    const cur = list[i];
    matched.add(cur.id);
    duplicates += 1;
    const fill = Object.fromEntries([...DETAIL_KEYS, ...FILL_ONLY_KEYS].filter(k => !cur[k] && r[k]).map(k => [k, r[k]]));
    if (Object.keys(fill).length) { list[i] = { ...cur, ...fill }; updated += 1; }
  }
  return { list, added, duplicates, updated };
}

// A company's `climateTargets` with one field of one target changed, for an
// edit made away from the company popup (Prospecting > Targets). The target
// is found by its place in the list; null when there is none there or the
// value is what it already holds, so the caller saves nothing.
export function editSavedTarget(prospect, targetIndex, key, value) {
  const list = normalizeTargets(prospect?.climateTargets);
  const cur = list[targetIndex];
  if (!cur) return null;
  const next = updateTarget(list, cur.id, key, value);
  return next[targetIndex][key] === cur[key] ? null : next;
}

// ---- Every company's targets, as one list ------------------------------
// Prospecting > Targets lists the targets saved on every company popup:
// How many targets a company has, for a count beside its name: the rows on
// its Targets tab with something filled in, less the hidden ones and less a
// "No target set" row (that row says the company has none). 0 for a company
// with no targets, checked or not.
export function companyTargetCount(prospect) {
  return normalizeTargets(prospect?.climateTargets)
    .filter(t => !t.hidden && !isNoTargetRow(t) && hasTargetValues([t])).length;
}

// [{ ...target, id: '<prospect id>:<target id>', targetId, targetIndex, prospect, company }]
// targetIndex is the target's place in the company's list, which is what an
// edit made from that page goes by: a target saved without an id gets a new
// one each time the list is read, so its id cannot be relied on to find it.
// Companies with none add nothing. Hidden targets are included (the page
// decides whether to show them).
export function allSavedTargets(prospects) {
  const out = [];
  for (const p of prospects || []) {
    const list = normalizeTargets(p?.climateTargets);
    if (!list.length) continue;
    for (const [targetIndex, t] of list.entries()) {
      out.push({ ...t, id: `${p.id}:${t.id}`, targetId: t.id, targetIndex, prospect: p, company: String(p.company || '') });
    }
  }
  return out;
}

// One row per company: the target whose refresh falls due soonest (an
// overdue one first, since its year is earliest). A target with no year set
// has no refresh date and is picked only when none of the company's targets
// has one, and a "No target set" row only when the company has nothing else.
// Ties go to the target listed first on the company's tab.
// Each row also carries `targetCount`, how many targets were in the running.
// Prospecting > Targets' company search: EVERY target of the companies
// whose name holds each word typed (any order, any case), each row with
// `targetCount`, how many targets its company has. '' when nothing is typed
// gives []: the page then shows its usual one row per company.
export function targetsOfCompaniesMatching(targets, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = (targets || []).filter(t => {
    const name = String(t.company || '').toLowerCase();
    return words.every(w => name.includes(w));
  });
  const counts = new Map();
  const keyOf = t => t.prospect?.id ?? t.company;
  for (const t of hits) counts.set(keyOf(t), (counts.get(keyOf(t)) || 0) + 1);
  return hits.map(t => ({ ...t, targetCount: counts.get(keyOf(t)) }));
}

export function soonestTargetPerCompany(targets) {
  const best = new Map();
  for (const t of targets || []) {
    const key = t.prospect?.id ?? t.company;
    const cur = best.get(key);
    if (!cur) { best.set(key, { row: t, count: 1 }); continue; }
    cur.count += 1;
    const rank = r => [isNoTargetRow(r) ? 1 : 0, refreshDue(r)?.year ?? Infinity];
    const [na, ya] = rank(t);
    const [nb, yb] = rank(cur.row);
    if (na < nb || (na === nb && ya < yb)) cur.row = t;
  }
  return [...best.values()].map(({ row, count }) => ({ ...row, targetCount: count }));
}

// The Prospecting > Targets subtabs: one per target type that is actually
// saved, most companies first, with "No target set" and untyped targets
// last. Types are free text, so spellings that differ only in case or
// spacing ("SBTi net zero" / "SBTi Net zero") are one type, labelled with
// whichever spelling is used most. `key` is the folded spelling ('' for no
// type); `companies` is how many companies have a target of that type.
export const targetTypeKey = t => String(t?.type || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Type groups: the user's own bundles of target types ("SBTi near-term" +
// "SBTi long-term" + "SBTi Net zero" as "SBTi"), saved in
// settings.targetTypeGroups as [{ id, name, types: [folded type key] }].
// A group takes its types' place in the subtab row as one subtab. Nothing
// on the targets themselves changes. A type sits in one group at most (the
// first that lists it), and a group left with no types is dropped.
export const TYPE_GROUP_PREFIX = 'group:';
export const typeGroupKey = id => `${TYPE_GROUP_PREFIX}${id}`;
export const isTypeGroupKey = key => String(key ?? '').startsWith(TYPE_GROUP_PREFIX);

export function normalizeTypeGroups(groups) {
  const taken = new Set();
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const id = String(g?.id || '').trim();
    const name = String(g?.name || '').trim().replace(/\s+/g, ' ');
    if (!id || !name || out.some(o => o.id === id)) continue;
    const types = [];
    for (const raw of Array.isArray(g.types) ? g.types : []) {
      const k = targetTypeKey({ type: raw });
      if (taken.has(k)) continue;
      taken.add(k);
      types.push(k);
    }
    if (types.length) out.push({ id, name, types });
  }
  return out;
}

// t => the key of the subtab a target sits on: its group's, or its type's.
export function targetTabKeyFn(groups) {
  const byType = new Map();
  for (const g of normalizeTypeGroups(groups)) for (const k of g.types) byType.set(k, typeGroupKey(g.id));
  return t => { const k = targetTypeKey(t); return byType.get(k) ?? k; };
}

// Put the picked subtabs together under `name`. `keys` are subtab keys:
// type keys and/or group keys. A picked group is merged in whole, and the
// first one picked keeps its id (so its column layout stays); picking one
// group alone renames it. A type moves out of any group it was in. `newId`
// names a brand new group.
export function saveTypeGroup(groups, { name, keys, newId }) {
  const list = normalizeTypeGroups(groups);
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  const picked = [...new Set(keys || [])];
  if (!clean || !picked.length) return list;
  const pickedGroups = picked.map(k => list.find(g => typeGroupKey(g.id) === k)).filter(Boolean);
  const types = [];
  for (const k of picked) {
    const g = pickedGroups.find(x => typeGroupKey(x.id) === k);
    for (const t of g ? g.types : [k]) if (!types.includes(t)) types.push(t);
  }
  const id = pickedGroups[0]?.id || String(newId || '');
  if (!id) return list;
  const merged = { id, name: clean, types };
  const rest = list
    .filter(g => !pickedGroups.includes(g))
    .map(g => ({ ...g, types: g.types.filter(t => !types.includes(t)) }));
  // Where the first picked group was, or at the end.
  const at = pickedGroups.length ? list.indexOf(pickedGroups[0]) : list.length;
  const before = list.slice(0, at).filter(g => !pickedGroups.includes(g)).length;
  return normalizeTypeGroups([...rest.slice(0, before), merged, ...rest.slice(before)]);
}

// Take one type out of a group. A group of one is no group, so it goes too.
export function removeTypeFromGroup(groups, id, typeKey) {
  return normalizeTypeGroups(groups)
    .map(g => (g.id === id ? { ...g, types: g.types.filter(t => t !== typeKey) } : g))
    .filter(g => g.id !== id || g.types.length > 1);
}

export const removeTypeGroup = (groups, id) => normalizeTypeGroups(groups).filter(g => g.id !== id);

// With `groups`, a group's types share one subtab: `key` is the group's key,
// `label` its name, `group` its id and `types` its type keys.
export function targetTypeTabs(targets, typeGroups) {
  const saved = normalizeTypeGroups(typeGroups);
  const tabKey = targetTabKeyFn(saved);
  const groups = new Map();
  for (const t of targets || []) {
    const key = tabKey(t);
    let g = groups.get(key);
    if (!g) { g = { key, spellings: new Map(), companies: new Set(), targets: 0 }; groups.set(key, g); }
    const spelling = String(t?.type || '').trim().replace(/\s+/g, ' ');
    g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);
    g.companies.add(t.prospect?.id ?? t.company);
    g.targets += 1;
  }
  const last = k => (k === '' ? 2 : k === NO_TARGET_TYPE.toLowerCase() ? 1 : 0);
  return [...groups.values()]
    .map(g => {
      const group = saved.find(x => typeGroupKey(x.id) === g.key);
      return {
        key: g.key,
        label: group ? group.name : g.key === '' ? 'No type' : [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
        companies: g.companies.size,
        targets: g.targets,
        ...(group ? { group: group.id, types: group.types } : {}),
      };
    })
    .sort((a, b) => last(a.key) - last(b.key) || b.companies - a.companies || a.label.localeCompare(b.label));
}
