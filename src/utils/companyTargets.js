// A company's sustainability targets, logged by hand on the company popup's
// Targets tab. Stored on the company record as `climateTargets`: an array of
//   { id, action, type, commitmentType, yearSet, baseYear, targetYear1, targetYear2,
//     scope1, scope2, scope3, classification, status, datePublished, hidden }
// `action` is SBTi's Action column, "Target" or "Commitment"; a row saved
// before it existed reads as a Commitment when its type is SBTi commitment,
// else as a Target. `commitmentType` is a commitment's kind ("Net-zero",
// "Standard", "BA1.5 Option 2"); `datePublished` is the date SBTi lists,
// as given ("2024-04-25"), and its year is the Year Set a paste fills in.
// `hidden` greys the row out on the tab (kept, not deleted: an old target
// worth remembering but not worth reading past).
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
    id: newId(), action: 'Target', type: '', commitmentType: '', yearSet: '', baseYear: '', targetYear1: '', targetYear2: '',
    scope1: false, scope2: false, scope3: false, classification: '', status: '', datePublished: '', hidden: false,
  };
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
        hidden: !!r.hidden,
      };
    });
}

// The list with one row's field changed. Year fields are cleaned on the way in.
export function updateTarget(list, id, key, value) {
  const v = TARGET_YEAR_KEYS.includes(key) ? cleanYear(value)
    : (TARGET_SCOPES.includes(key) || key === 'hidden') ? !!value
      : String(value ?? '');
  return normalizeTargets(list).map(r => (r.id === id ? { ...r, [key]: v } : r));
}

export function removeTarget(list, id) {
  return normalizeTargets(list).filter(r => r.id !== id);
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
  yearset: 'yearSet',
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

// Split the pasted text into rows of cells, header row (if any) first.
function pasteGrid(text) {
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

// Parse a pasted table into target rows (with fresh ids).
//   { rows, skipped }  skipped counts lines that held nothing usable.
export function parsePastedTargets(text) {
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
    };
    const anything = row.type || row.baseYear || row.targetYear1 || row.yearSet || row.classification || row.commitmentType;
    if (anything) rows.push(row); else skipped += 1;
  }
  return { rows, skipped };
}

// Two rows describe the same target when their core fields match and the
// detail fields (filled in by later versions of the paste) don't disagree:
// blank on either side counts as agreeing, so re-pasting a table onto rows
// logged before Action / Commitment Type / Date Published existed matches
// them and fills those in, rather than adding the targets a second time.
const DETAIL_KEYS = ['action', 'commitmentType', 'datePublished'];
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
    const fill = Object.fromEntries(DETAIL_KEYS.filter(k => !cur[k] && r[k]).map(k => [k, r[k]]));
    if (Object.keys(fill).length) { list[i] = { ...cur, ...fill }; updated += 1; }
  }
  return { list, added, duplicates, updated };
}

// ---- Every company's targets, as one list ------------------------------
// Prospecting > Targets lists the targets saved on every company popup:
// [{ ...target, id: '<prospect id>:<target id>', targetId, prospect, company }]
// Companies with none add nothing. Hidden targets are included (the page
// decides whether to show them).
export function allSavedTargets(prospects) {
  const out = [];
  for (const p of prospects || []) {
    const list = normalizeTargets(p?.climateTargets);
    if (!list.length) continue;
    for (const t of list) {
      out.push({ ...t, id: `${p.id}:${t.id}`, targetId: t.id, prospect: p, company: String(p.company || '') });
    }
  }
  return out;
}

// One row per company: the target whose refresh falls due soonest (an
// overdue one first, since its year is earliest). A target with no year set
// has no refresh date and is picked only when none of the company's targets
// has one. Ties go to the target listed first on the company's tab.
// Each row also carries `targetCount`, how many targets were in the running.
export function soonestTargetPerCompany(targets) {
  const best = new Map();
  for (const t of targets || []) {
    const key = t.prospect?.id ?? t.company;
    const cur = best.get(key);
    if (!cur) { best.set(key, { row: t, count: 1 }); continue; }
    cur.count += 1;
    const a = refreshDue(t)?.year ?? Infinity;
    const b = refreshDue(cur.row)?.year ?? Infinity;
    if (a < b) cur.row = t;
  }
  return [...best.values()].map(({ row, count }) => ({ ...row, targetCount: count }));
}
