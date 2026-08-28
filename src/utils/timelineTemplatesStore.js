// Reusable timeline templates defined on the Dropdowns → Timelines subtab.
//
// A template is a named timeline (e.g. "Budget timeline") holding an ordered
// list of stages. Every stage records who owns it — the client or Schneider
// Electric — so the plan reads as a hand-off sequence rather than a flat task
// list. Templates can also be attached to one or more services from the
// Solutions catalog; that's the hook the rest of the app uses when it needs
// "the timeline for this service".
//
// Shape stored under settings.timelineTemplates (syncs across devices with
// the other dropdown settings):
//
//   [{
//     id:       'tl-<base36>',
//     name:     'Budget timeline',
//     libraryId: 'lib-<base36>',           // set once it's been on the library shelf
//     subtitle: 'What the timeline is for',  // optional, drawn under the title
//     services: ['Budgets'],               // Solutions-catalog names, optional
//     stages: [{
//       id:          'st-<base36>',
//       name:        'Inputs due',
//       owner:       'Schneider Electric', // one of TIMELINE_STAGE_OWNERS
//       timing:      '8/7/2026',           // free text — a date, a window, "2 weeks"
//       description: '',
//       icon:        'handshake',          // marker artwork, see STAGE_ICONS
//     }],
//   }]
//
// Until the user saves anything, the seeds in data/timelineTemplates are what
// the page shows; the first edit persists the whole array (seeds included).

// Extension included so this resolves under plain Node for the tests.
import { BUILTIN_TIMELINE_TEMPLATES } from '../data/timelineTemplates.js';
import { STEP_DURATION_UNITS, DEFAULT_DURATION_UNIT, parseDependsOn, getStageRange } from './timelineDates.js';

// The owners a stage can be assigned to. "Both" covers the joint working
// sessions that neither side runs alone.
export const TIMELINE_STAGE_OWNERS = ['Schneider Electric', 'Client', 'Both'];
export const DEFAULT_STAGE_OWNER = 'Schneider Electric';

// How a stage occupies the timeline. A 'timeline' stage is a duration and
// draws as a bar across its months; a 'milestone' is a point in time and
// draws as a marker in its start month, whatever span the dates imply.
// Stages saved before this existed have no kind and read as durations, so
// existing timelines render exactly as they did.
export const TIMELINE_STAGE_KINDS = ['timeline', 'milestone'];
export const DEFAULT_STAGE_KIND = 'timeline';
export const STAGE_KIND_LABELS = { timeline: 'Timeline', milestone: 'Milestone' };

// Short id generator on the same pattern as makeCustomListKey — a timestamp
// in base36 plus a random tail so two stages added in the same millisecond
// still get distinct keys.
export function makeTimelineId(prefix = 'tl') {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

// The steps a stage waits on. Lives in timelineDates because placeStages —
// which sequences unplaced steps behind the ones they wait on — has to read
// the same list, and the dependency direction between these two modules runs
// this way. Re-exported so every existing caller keeps its import.
export { parseDependsOn } from './timelineDates.js';

export function formatDependsOn(ids) {
  return parseDependsOn(ids).join(', ');
}

// Colours for the step groups — the phase bands the implementation chart
// draws down its left edge.
//
// Deliberately none of the workstream colours (see WORKSTREAM_COLOR: green for
// Schneider Electric, blue for the client, teal for both). A step's chip is
// coloured by who owns it and the legend says so; the group is a different
// question about the same step, so it gets a different set of hues and a
// different piece of the drawing — the band, not the chip.
//
// Ordered so neighbouring groups don't land on neighbouring hues.
export const PHASE_COLORS = [
  '#4338CA', // indigo
  '#B45309', // amber
  '#0F766E', // teal
  '#9D174D', // magenta
  '#4D7C0F', // olive
  '#6D28D9', // violet
  '#B91C1C', // brick
  '#0369A1', // ocean
];

// The colour for one group. A stored override wins; otherwise the group takes
// the palette entry for its position, so a timeline is legible the moment it
// has groups and nobody has picked anything.
//
// Overrides are keyed by group name rather than position, so inserting a
// group above another doesn't repaint it — the name is what the user attached
// the colour to.
export function phaseColorFor(name, index, overrides) {
  const key = String(name ?? '').trim();
  const stored = key && overrides && typeof overrides === 'object' ? overrides[key] : null;
  if (typeof stored === 'string' && /^#[0-9a-f]{6}$/i.test(stored.trim())) return stored.trim();
  return PHASE_COLORS[Math.abs(Number(index) || 0) % PHASE_COLORS.length];
}

// Steps gathered into their groups, in plan order.
//
// A group is a run of CONSECUTIVE steps carrying the same `phase` name — the
// bands the implementation chart draws down its left edge. Order is never
// re-sorted, so the same name used twice down a timeline is two runs, and
// because the colour is keyed by name they read as the same group both times.
//
// Shared by the chart and the Services popup's step list so the two can't
// disagree about where one group ends and the next begins.
// Returns [{ phase, color, steps: [{ stage, index }] }]; `phase` is '' and
// `color` null for the steps that aren't in a group.
export function groupStagesByPhase(stages, phaseColors) {
  const groups = [];
  (Array.isArray(stages) ? stages : []).forEach((stage, index) => {
    const phase = String(stage?.phase || '').trim();
    const prev = groups[groups.length - 1];
    if (prev && phase && prev.phase === phase) prev.steps.push({ stage, index });
    else groups.push({ phase, steps: [{ stage, index }] });
  });
  const order = [];
  for (const g of groups) {
    if (g.phase && !order.includes(g.phase)) order.push(g.phase);
  }
  return groups.map(g => ({
    ...g,
    color: g.phase ? phaseColorFor(g.phase, order.indexOf(g.phase), phaseColors) : null,
  }));
}

// A band's steps split into their sub-groups: runs of consecutive steps
// carrying the same `subPhase`.
//
// Only the deal rollout sets one. There a band is a SERVICE, so `phase` is
// spent naming it, and the structure the service's own timeline had — its
// phases — rides along as `subPhase` rather than being flattened away. An
// ordinary timeline has none and comes back as a single unnamed run, which
// draws exactly as it did.
//
// Takes the `{ stage, index }` steps groupStagesByPhase returns, and is
// shared by the chart and the Excel sheet so the two split a band the same
// way.
export function subRuns(steps) {
  const runs = [];
  for (const step of (Array.isArray(steps) ? steps : [])) {
    const sub = String(step.stage?.subPhase || '').trim();
    const prev = runs[runs.length - 1];
    if (prev && sub && prev.sub === sub) prev.steps.push(step);
    else runs.push({ sub, color: step.stage?.subPhaseColor || '', steps: [step] });
  }
  return runs;
}

// Move a step to the other side of contract signature.
//
// The stages array IS the plan order — the chart numbers steps from it and
// stacks its rows in it — so a step changing sides has to physically move,
// not just change a flag. The boundary index is both the end of the run-up
// and the head of the engagement, so it's where the step goes whichever way
// it's travelling.
//
// Shared by both editors: without it, setting "Before" in one of them left
// the step where it was, and the chart drew it first while numbering it last.
export function setStagePreKickoff(stages, index, preKickoff) {
  const list = Array.isArray(stages) ? stages : [];
  if (index < 0 || index >= list.length) return list;
  const moving = { ...list[index], preKickoff: !!preKickoff };
  const rest = list.filter((_, i) => i !== index);
  const boundary = rest.findIndex(s => !s?.preKickoff);
  const at = boundary === -1 ? rest.length : boundary;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

// Can these two positions swap? Only within a side: the reorder arrows shuffle
// steps inside the run-up or inside the engagement, and crossing the signature
// is what the side control is for. Without this, nudging the first delivery
// step up would drop it into the run-up without saying so.
export function canSwapStages(stages, a, b) {
  const list = Array.isArray(stages) ? stages : [];
  if (a < 0 || b < 0 || a >= list.length || b >= list.length) return false;
  return !!list[a]?.preKickoff === !!list[b]?.preKickoff;
}

// Every distinct group name on a timeline, in the order they first appear.
export function phaseNames(stages) {
  const out = [];
  for (const stage of (Array.isArray(stages) ? stages : [])) {
    const phase = String(stage?.phase || '').trim();
    if (phase && !out.includes(phase)) out.push(phase);
  }
  return out;
}

// A blank stage, ready to append. Used by both editors — the Timelines tab's
// stage table and the Services popup's step list — so the two can't drift on
// what a new step starts life as.
export function makeTimelineStage(overrides = {}) {
  return {
    id: makeTimelineId('st'),
    name: '',
    owner: DEFAULT_STAGE_OWNER,
    timing: '',
    description: '',
    icon: 'number',
    kind: DEFAULT_STAGE_KIND,
    dependsOn: '',
    preKickoff: false,
    duration: '',
    durationUnit: DEFAULT_DURATION_UNIT,
    ...overrides,
  };
}

// --- The contract legal review run-up ------------------------------------
//
// The months a deal spends in legal before anyone signs. Optional, because
// plenty of timelines start at signature and have nothing to say about what
// came before, and adjustable, because two months is a convention rather
// than a rule.
//
// It's a STEP, not a setting on the timeline: the implementation chart draws
// steps, the Excel sheet lists them, and the run-up wants to read like the
// rest of the plan — a named bar in the months before the signature rule,
// renameable and describable like anything else. The control on the
// Timelines tab is a shortcut for authoring that one step, and reads its
// value back off it, so there's one source of truth and the Duration cell
// and the control can't disagree.
export const LEGAL_REVIEW_NAME = 'Contract legal review';
export const LEGAL_REVIEW_DEFAULT_MONTHS = 2;

// The legal review step on a timeline, or null.
export function legalReviewStage(template) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  return stages.find(st => st?.legalReview === true) || null;
}

// How many months of legal review the timeline carries — 0 when it has none.
export function legalReviewMonths(template) {
  const stage = legalReviewStage(template);
  if (!stage) return 0;
  const n = Math.floor(Number(stage.duration) || 0);
  return n > 0 ? n : LEGAL_REVIEW_DEFAULT_MONTHS;
}

// First day of the month `delta` months from the one this ISO date is in,
// and the last day of the month before it. Whole months, so the run-up
// occupies exactly the columns it's given rather than straddling a boundary
// because the engagement happens to start on the 31st.
function monthStartISO(iso, delta = 0) {
  const [y, m] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + delta, 1));
  return d.toISOString().slice(0, 10);
}
function priorMonthEndISO(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

// The same date `delta` months away, keeping the day of the month so a range
// the user typed comes back exactly as they typed it when the run-up that
// moved it is shortened again. Clamped for the short months: 31 August back
// six months is 28 February, not 3 March.
function shiftMonthsISO(iso, delta) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const target = new Date(Date.UTC(y, (m - 1) + delta, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d || 1, lastDay));
  return target.toISOString().slice(0, 10);
}

// The date the engagement starts: the earliest start among the steps that
// happen after signature. '' when none of them is dated.
function engagementStartISO(template) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const starts = stages
    .filter(st => !st?.preKickoff)
    .map(st => getStageRange(st)?.start)
    .filter(Boolean)
    .sort();
  return starts[0] || '';
}

/**
 * Set (or clear) the timeline's legal review run-up, in months.
 *
 * 0 removes it. Anything else writes a single pre-signature step at the head
 * of the plan — the run-up precedes the engagement, and the stages array IS
 * the plan order — keeping whatever name and description the user has given
 * it.
 *
 * On a timeline placed by DATES the step is dated too, in whole months
 * ending the month before the engagement starts, because a step with no
 * dates on that chart falls back to the first column and would draw on top
 * of the work it's supposed to precede. A declared timeline range moves back
 * with it by the same number of months, so the months just added are inside
 * the window rather than warned about as falling outside it — and forward
 * again when the run-up is shortened or removed.
 */
export function setLegalReviewMonths(template, months) {
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const next = Math.max(0, Math.floor(Number(months) || 0));
  const current = legalReviewMonths(template);
  if (next === current) return template;
  const delta = next - current;

  // A declared range is the window everything is drawn against, so it has to
  // cover the months the run-up just claimed (or give them back).
  const rangeStart = template?.rangeStart
    ? shiftMonthsISO(template.rangeStart, -delta)
    : template?.rangeStart;

  if (next === 0) {
    return { ...template, rangeStart, stages: stages.filter(st => st?.legalReview !== true) };
  }

  const existing = legalReviewStage(template);
  const dated = template?.positionMode !== 'months';
  const engagement = dated ? engagementStartISO(template) : '';
  const range = engagement
    ? { start: monthStartISO(engagement, -next), end: priorMonthEndISO(engagement) }
    : { start: '', end: '' };

  const stage = makeTimelineStage({
    ...(existing || {}),
    id: existing?.id || makeTimelineId('st'),
    name: existing?.name?.trim() ? existing.name : LEGAL_REVIEW_NAME,
    owner: existing?.owner || 'Both',
    kind: 'timeline',
    preKickoff: true,
    legalReview: true,
    duration: next,
    durationUnit: 'months',
    start: range.start,
    end: range.end,
    // Month × Span is the other way of placing a step, and a stale value
    // there would outrank both the duration and the dates.
    startMonth: '',
    months: '',
  });

  const rest = stages.filter(st => st?.legalReview !== true);
  return { ...template, rangeStart, stages: [stage, ...rest] };
}

// A new timeline for one service, attached to it. The Services popup creates
// this the first time somebody adds a step to a service that has no timeline
// yet; from then on it's an ordinary template, editable on the Timelines tab
// like any other and attachable to further services there.
//
// Drawn in the implementation format rather than the Gantt the Timelines
// tab's "+ New timeline" defaults to. That default is right for a timeline
// nobody has filled in yet, but this one is created for a known shape: a
// numbered sequence of steps that wait on each other. "Implementation" is the
// layout that numbers the steps, and the one that places a step by what it
// waits on (see placeStages) — a Gantt goes by dates, so the steps this popup
// writes, which carry a duration and a predecessor and no dates at all, would
// have nothing to position them. Changeable on the Timelines tab like any
// other setting.
export function makeTimelineForService(serviceName) {
  const name = String(serviceName ?? '').trim();
  return {
    id: makeTimelineId('tl'),
    name: name ? `${name} timeline` : 'Untitled timeline',
    services: name ? [name] : [],
    stages: [],
    positionMode: 'dates',
    format: 'phased',
  };
}

// Coerce a stored stage into the full shape, filling in an id and a valid
// owner so callers never have to defend against half-written records.
function normalizeStage(stage) {
  const owner = TIMELINE_STAGE_OWNERS.includes(stage?.owner) ? stage.owner : DEFAULT_STAGE_OWNER;
  return {
    id: stage?.id || makeTimelineId('st'),
    name: String(stage?.name ?? ''),
    owner,
    timing: String(stage?.timing ?? ''),
    // Optional explicit calendar dates for the Gantt. Left blank, the range
    // is parsed out of `timing` instead — see utils/timelineDates.
    start: String(stage?.start ?? ''),
    end: String(stage?.end ?? ''),
    // How long the step lasts, in the unit it was said in — 3 weeks, 2
    // months, 10 days. Kept as the number and the unit the user picked rather
    // than converted to months on save: "3 weeks" is what the step is, and
    // rewriting it as "1 month" on the way in would lose that. The conversion
    // to month columns happens at placement time, in getStageMonths.
    duration: stage?.duration === '' || stage?.duration == null ? '' : Number(stage.duration),
    durationUnit: STEP_DURATION_UNITS.includes(stage?.durationUnit)
      ? stage.durationUnit
      : DEFAULT_DURATION_UNIT,
    // Does this step happen BEFORE the contract is signed? The run-up to a
    // deal — the proposal, the site walk, legal review — is planning nobody
    // could record here, because every step sat after kickoff by definition.
    //
    // A flag rather than a negative month: whether a step is pre-signature is
    // a fact about the work, not about where it lands on an axis, and tying
    // it to a month would flip it whenever a duration pushed the step across
    // the boundary.
    preKickoff: stage?.preKickoff === true,
    // The contract legal review, if this is it: the optional run-up the
    // Timelines tab offers as a months control rather than as a step to
    // write out. Flagged rather than matched by name so renaming it — "Legal
    // & procurement review", "MSA negotiation" — doesn't lose the control.
    legalReview: stage?.legalReview === true,
    // Implementation format: the phase band this step sits in, and its
    // position in months from kickoff. Blank month/span fall back to the
    // stage's calendar position.
    phase: String(stage?.phase ?? ''),
    startMonth: stage?.startMonth === '' || stage?.startMonth == null ? '' : Number(stage.startMonth),
    months: stage?.months === '' || stage?.months == null ? '' : Number(stage.months),
    // The earlier steps this one waits on, as a comma-separated list of stage
    // ids. Ids rather than positions so reordering the table can't silently
    // repoint one. Normalized on read, so a stored value that grew duplicates
    // or stray whitespace comes back tidy.
    dependsOn: formatDependsOn(stage?.dependsOn),
    description: String(stage?.description ?? ''),
    // 'number' draws the stage position in the marker; anything else selects
    // artwork from STAGE_ICONS in timelineGraphic.
    icon: String(stage?.icon || 'number'),
    kind: TIMELINE_STAGE_KINDS.includes(stage?.kind) ? stage.kind : DEFAULT_STAGE_KIND,
  };
}

// Dates are the standard for placing steps on the implementation chart. A
// timeline saved before the choice existed keeps whatever it was authored
// with: if any step carries a typed month, it was written in months, so
// switching it to dates would move every bar under the user.
function inferPositionMode(tpl) {
  if (tpl?.positionMode === 'months' || tpl?.positionMode === 'dates') return tpl.positionMode;
  const stages = Array.isArray(tpl?.stages) ? tpl.stages : [];
  const anyTypedMonth = stages.some(s => Number(s?.startMonth) >= 1 || Number(s?.months) >= 1);
  return anyTypedMonth ? 'months' : 'dates';
}

function normalizeTemplate(tpl) {
  return {
    positionMode: inferPositionMode(tpl),
    id: tpl?.id || makeTimelineId('tl'),
    // The library entry this timeline was added from (or last saved to), or
    // '' for one that has never been on the shelf. See libraryEntries.
    libraryId: String(tpl?.libraryId ?? ''),
    name: String(tpl?.name ?? ''),
    // The line under the title — what the timeline is FOR, in the words it's
    // presented in ("Building the procurement foundation to move quickly when
    // market opportunities arise"). Optional: a timeline without one draws
    // its header exactly as it always did.
    subtitle: String(tpl?.subtitle ?? ''),
    // Which layout the visual and exports render. Timelines saved before the
    // Gantt existed have no format and pick up the default.
    format: ['milestone', 'phased', 'gantt'].includes(tpl?.format) ? tpl.format : 'gantt',
    // Implementation-format trimmings: who the client workstream belongs to,
    // how many month columns to draw, and the caveat box above the title.
    clientName: String(tpl?.clientName ?? ''),
    monthCount: tpl?.monthCount === '' || tpl?.monthCount == null ? '' : Number(tpl.monthCount),
    note: String(tpl?.note ?? ''),
    // 'numbers' keeps the axis relative to kickoff; 'calendar' pins month 1
    // to anchorMonth ('YYYY-MM') and marks the month we're currently in.
    monthMode: tpl?.monthMode === 'calendar' ? 'calendar' : 'numbers',
    anchorMonth: String(tpl?.anchorMonth ?? ''),
    // The overall window the timeline is drawn against, as ISO dates. Set
    // both and they replace anchorMonth / monthCount on every surface; left
    // blank, the chart fits whichever stages carry dates.
    rangeStart: String(tpl?.rangeStart ?? ''),
    rangeEnd: String(tpl?.rangeEnd ?? ''),
    // What the line between the run-up and the delivery is called on the
    // chart. Every engagement has one; not every one calls it the same thing.
    signatureLabel: String(tpl?.signatureLabel ?? '').trim() || 'Contract signature',
    // Per-group colour overrides, keyed by group (phase) name. Only the ones
    // the user has actually picked — every other group falls back to its
    // palette entry, so this stays empty on a timeline nobody has recoloured.
    phaseColors: (tpl?.phaseColors && typeof tpl.phaseColors === 'object')
      ? Object.fromEntries(
        Object.entries(tpl.phaseColors)
          .filter(([k, v]) => String(k).trim() && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()))
          .map(([k, v]) => [String(k).trim(), v.trim()]),
      )
      : {},
    services: Array.isArray(tpl?.services)
      ? tpl.services.map(s => String(s ?? '').trim()).filter(Boolean)
      : [],
    stages: Array.isArray(tpl?.stages) ? tpl.stages.map(normalizeStage) : [],
  };
}

// Every template, normalized: the user's saved set once they've edited
// anything, otherwise the built-in seeds. An empty saved array is honored —
// that's the user having deleted every timeline, not an absent override.
export function getTimelineTemplates(settings) {
  const raw = settings?.timelineTemplates;
  const source = Array.isArray(raw) ? raw : BUILTIN_TIMELINE_TEMPLATES;
  return source.map(normalizeTemplate);
}

// --- The library ---------------------------------------------------------
//
// A shelf of timelines to start from, offered behind "+ From library" on the
// Timelines tab. Two things sit on it: the timelines that ship with the app,
// and the ones the user puts there themselves.
//
// Why the shelf exists at all: the seeds only show while nobody has saved a
// set of their own, and from the first edit on the page the saved array is
// the whole truth — so a timeline shipped later would never reach anyone
// already using the tab. The library is how it reaches them, as something
// they add when they want it rather than something that appears in their
// list on its own.
//
// And why the user can save to it: a timeline worked out once — the stages,
// the owners, the wording that goes in front of a client — is the thing you
// want to start the NEXT engagement from. Saving puts a copy on the shelf;
// what's on the shelf is a snapshot, so carrying on editing the timeline in
// the list doesn't quietly rewrite the copy.
//
// Saved entries live under settings.timelineLibrary and sync with the other
// dropdown settings. Each carries a `libraryId`, its identity on the shelf:
// a timeline saved a second time updates its own entry rather than growing
// a second one, and an entry added to the list remembers where it came from
// so the same is true of the copy.
export const LIBRARY_ID_PREFIX = 'lib';

// Every entry on the shelf: the built-ins first, then whatever the user has
// saved, each stamped with the `libraryId` that identifies it and whether
// it's one of ours (which can't be removed — it ships with the app).
export function libraryEntries(settings) {
  const saved = Array.isArray(settings?.timelineLibrary) ? settings.timelineLibrary : [];
  return [
    ...BUILTIN_TIMELINE_TEMPLATES.map(tpl => ({
      ...normalizeTemplate(tpl),
      libraryId: String(tpl?.id ?? ''),
      builtIn: true,
    })),
    ...saved.map(tpl => ({
      ...normalizeTemplate(tpl),
      libraryId: String(tpl?.libraryId || tpl?.id || makeTimelineId(LIBRARY_ID_PREFIX)),
      builtIn: false,
    })),
  ];
}

// Put a timeline on the shelf, or update the entry it already came from.
// Returns the next saved-library array, ready to write back to settings.
//
// A snapshot, deliberately: the entry holds the timeline as it is at the
// moment it's saved, so the copy in the working list stays editable without
// the shelf following along behind it.
export function saveToLibrary(settings, template) {
  const saved = Array.isArray(settings?.timelineLibrary) ? settings.timelineLibrary : [];
  const libraryId = String(template?.libraryId || '').trim() || makeTimelineId(LIBRARY_ID_PREFIX);
  const entry = { ...normalizeTemplate(template), libraryId };
  const at = saved.findIndex(t => String(t?.libraryId ?? '') === libraryId);
  if (at === -1) return [...saved, entry];
  return saved.map((t, i) => (i === at ? entry : t));
}

// Take a timeline off the shelf. Built-ins aren't in the saved array to
// begin with, so asking to remove one is a no-op rather than an error.
export function removeFromLibrary(settings, libraryId) {
  const saved = Array.isArray(settings?.timelineLibrary) ? settings.timelineLibrary : [];
  const key = String(libraryId ?? '');
  return saved.filter(t => String(t?.libraryId ?? '') !== key);
}

// A fresh timeline built from a library entry, ready to append to the list.
//
// Every id is regenerated — the timeline's and each stage's — because the
// same entry can be added more than once: one standard plan, instantiated
// per engagement. Two timelines sharing an id would be edited and deleted as
// one. `dependsOn` is a list of stage ids, so it's remapped through the same
// table rather than left pointing at the stages of whichever copy was added
// first.
export function instantiateTimeline(entry) {
  const tpl = normalizeTemplate(entry);
  const idMap = new Map();
  for (const stage of tpl.stages) idMap.set(stage.id, makeTimelineId('st'));
  return {
    ...tpl,
    id: makeTimelineId('tl'),
    // Where this copy came from, so editing it and saving updates that entry
    // instead of leaving a near-duplicate beside it on the shelf.
    libraryId: String(entry?.libraryId || entry?.id || ''),
    stages: tpl.stages.map(stage => ({
      ...stage,
      id: idMap.get(stage.id),
      dependsOn: formatDependsOn(parseDependsOn(stage.dependsOn).map(id => idMap.get(id) || id)),
    })),
  };
}

// Templates attached to a given service name, compared case-insensitively so
// "Budgets" and "budgets" resolve to the same catalog entry.
export function getTimelineTemplatesForService(settings, serviceName) {
  const key = String(serviceName ?? '').trim().toLowerCase();
  if (!key) return [];
  return getTimelineTemplates(settings)
    .filter(tpl => tpl.services.some(s => s.toLowerCase() === key));
}

// Stage counts per owner, for the "2 SE · 1 Client" summary in the card
// header. Owners are always the three known values so the caller can render
// them in a fixed order.
export function summarizeStageOwners(stages) {
  const counts = Object.fromEntries(TIMELINE_STAGE_OWNERS.map(o => [o, 0]));
  for (const stage of (Array.isArray(stages) ? stages : [])) {
    const owner = TIMELINE_STAGE_OWNERS.includes(stage?.owner) ? stage.owner : DEFAULT_STAGE_OWNER;
    counts[owner] += 1;
  }
  return counts;
}

// Short owner label for tight spaces (pills, summaries).
export function shortOwnerLabel(owner) {
  if (owner === 'Schneider Electric') return 'SE';
  if (owner === 'Client') return 'Client';
  if (owner === 'Both') return 'Both';
  return owner || '';
}
