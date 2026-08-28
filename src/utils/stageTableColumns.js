// Column model for the stage table on Dropdowns → Timelines.
//
// The table shows a different set of columns per format — a Gantt stage has
// Dates, an implementation step has Type / Month × Span / Depends on — and the
// header, the <colgroup> and each row's cells all have to agree on that set.
// Keeping the list in one place means adding a column can't leave the widths
// one <col> short of the headers, which is exactly how they drifted apart
// before.
//
// Which columns are showing, and how wide each one is, are workspace
// preferences rather than timeline data: they're the same question every time
// you open the tab, and nobody wants a Firestore write per pixel of a drag.
// So they live in user-scoped localStorage, keyed by format, with a change
// event so every open timeline card re-reads at once.

import { userLsGet, userLsSet } from './userLs';

const STORAGE_KEY = 'timeline-stage-table-layout';
// Fired in-tab whenever the layout changes, so other mounted stage tables
// pick it up without a reload. Cross-tab updates ride the native `storage`
// event, same as the other small stores.
export const STAGE_TABLE_LAYOUT_EVENT = 'stage-table-layout-updated';

export const MIN_COLUMN_WIDTH = 44;
export const MAX_COLUMN_WIDTH = 900;

// Every column the table can show, per format, in display order. `width` is
// the default; `fixed: true` marks the ones that can't be hidden — the row
// number and the move/delete buttons, without which a row can't be worked on.
//
// `defaultHidden: true` starts a column off, still listed in the Columns menu.
// Timing is that on the two date-placed formats: the dates decide where a
// stage sits, so the field is only a custom label for the bar, and the label
// reads fine from the dates when it's blank. The milestone format keeps it
// showing — it has no date cells of its own, so Timing is the only way to say
// when a marker happens.
const COLUMNS = {
  milestone: [
    { key: 'n', label: '#', width: 34, fixed: true },
    { key: 'name', label: 'Stage', width: 220 },
    { key: 'owner', label: 'Owner', width: 170 },
    { key: 'icon', label: 'Icon', width: 118 },
    { key: 'timing', label: 'Timing', width: 150 },
    { key: 'description', label: 'Description', width: 260 },
    { key: 'actions', label: '', width: 84, fixed: true },
  ],
  gantt: [
    { key: 'n', label: '#', width: 34, fixed: true },
    { key: 'name', label: 'Stage', width: 220 },
    { key: 'owner', label: 'Owner', width: 170 },
    { key: 'timing', label: 'Timing', width: 150, defaultHidden: true },
    { key: 'dates', label: 'Dates', width: 290 },
    { key: 'description', label: 'Description', width: 260 },
    { key: 'actions', label: '', width: 84, fixed: true },
  ],
  // Duration and Side are on this format only, because this is the format
  // they drive: the implementation chart sizes a bar from the duration and
  // draws the signature rule the side is measured against. The Gantt places
  // by real dates and has no signature line, so offering either there would
  // be a control that changes nothing.
  phased: [
    { key: 'n', label: '#', width: 34, fixed: true },
    { key: 'name', label: 'Step', width: 220 },
    { key: 'owner', label: 'Workstream', width: 170 },
    { key: 'kind', label: 'Type', width: 130 },
    { key: 'side', label: 'Signature', width: 128 },
    { key: 'duration', label: 'Duration', width: 150 },
    { key: 'range', label: 'Start → End', width: 270 },
    { key: 'monthSpan', label: 'Month × Span', width: 130 },
    { key: 'depends', label: 'Depends on', width: 150 },
    { key: 'timing', label: 'Timing', width: 150, defaultHidden: true },
    { key: 'description', label: 'Description', width: 260 },
    { key: 'actions', label: '', width: 84, fixed: true },
  ],
};

// The columns for a format, defaults only. Unknown formats fall back to the
// Gantt set, which is what an un-migrated template renders as.
export function stageTableColumns(format) {
  return COLUMNS[format] || COLUMNS.gantt;
}

// Columns that only apply under one placement mode, keyed to the mode that
// keeps them. The implementation format is positioned either by real dates or
// by typed month numbers, and the cells for the mode that isn't running are
// dead: two date pickers per row that change nothing. Dropping the column
// beats grey-ing it, so a row shows only what's actually in play.
//
// Note that dates still act as a FALLBACK in months mode — getStageMonths
// reads them where Month and Span are both blank — so hiding the column does
// not make them stop counting. What keeps that honest is the Month × Span
// cell, whose placeholders show the resolved position whatever it came from:
// the derived value stays on screen even when the dates behind it don't.
const MODE_ONLY_COLUMNS = {
  range: 'dates',
};

// The columns a format shows under a placement mode. Applied when columns are
// resolved for rendering and when the Columns menu is built — never to the
// stored layout, so a column the user hid by hand in one mode is still hidden
// when they switch back rather than being forgotten while it was out of view.
export function stageTableColumnsForMode(format, mode) {
  const only = mode === 'months' ? 'months' : 'dates';
  return stageTableColumns(format)
    .filter(c => !MODE_ONLY_COLUMNS[c.key] || MODE_ONLY_COLUMNS[c.key] === only);
}

function readAll() {
  try {
    const raw = userLsGet(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// The saved overrides for a format: which keys are hidden, and any widths the
// user has dragged. Anything unrecognised (a column that has since been
// renamed or dropped) is ignored rather than trusted.
export function loadStageTableLayout(format) {
  const cols = stageTableColumns(format);
  const known = new Set(cols.map(c => c.key));
  const hideable = new Set(cols.filter(c => !c.fixed).map(c => c.key));
  const saved = readAll()[format] || {};
  const hidden = {};
  const widths = {};
  // A defaultHidden column stays hidden until the user turns it on, which is
  // recorded positively in `shown`. Without that record the default would
  // re-hide it on the next load and the Columns menu would look broken.
  const shown = new Set(Array.isArray(saved.shown) ? saved.shown : []);
  for (const col of cols) {
    if (col.defaultHidden && !col.fixed && !shown.has(col.key)) hidden[col.key] = true;
  }
  for (const key of Array.isArray(saved.hidden) ? saved.hidden : []) {
    if (hideable.has(key)) hidden[key] = true;
  }
  for (const [key, value] of Object.entries(saved.widths || {})) {
    const n = Number(value);
    if (!known.has(key) || !Number.isFinite(n)) continue;
    widths[key] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(n)));
  }
  return { hidden, widths };
}

// The columns actually rendered: defaults with any dragged width applied, in
// display order, minus the hidden ones and the ones the placement mode makes
// dead.
export function resolveStageTableColumns(format, layout, mode) {
  const { hidden = {}, widths = {} } = layout || {};
  return stageTableColumnsForMode(format, mode)
    .filter(c => !hidden[c.key])
    .map(c => ({ ...c, width: widths[c.key] ?? c.width }));
}

export function saveStageTableLayout(format, { hidden, widths }) {
  const all = readAll();
  all[format] = {
    hidden: Object.keys(hidden || {}).filter(k => hidden[k]),
    shown: stageTableColumns(format)
      .filter(c => c.defaultHidden && !hidden?.[c.key])
      .map(c => c.key),
    widths: widths || {},
  };
  try {
    userLsSet(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Saving stage table layout failed', err);
    return false;
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(STAGE_TABLE_LAYOUT_EVENT));
    }
  } catch { /* CustomEvent unavailable */ }
  return true;
}
