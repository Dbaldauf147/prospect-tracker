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

import { BUILTIN_TIMELINE_TEMPLATES } from '../data/timelineTemplates';

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
    // Implementation format: the phase band this step sits in, and its
    // position in months from kickoff. Blank month/span fall back to the
    // stage's calendar position.
    phase: String(stage?.phase ?? ''),
    startMonth: stage?.startMonth === '' || stage?.startMonth == null ? '' : Number(stage.startMonth),
    months: stage?.months === '' || stage?.months == null ? '' : Number(stage.months),
    description: String(stage?.description ?? ''),
    // 'number' draws the stage position in the marker; anything else selects
    // artwork from STAGE_ICONS in timelineGraphic.
    icon: String(stage?.icon || 'number'),
    kind: TIMELINE_STAGE_KINDS.includes(stage?.kind) ? stage.kind : DEFAULT_STAGE_KIND,
  };
}

function normalizeTemplate(tpl) {
  return {
    id: tpl?.id || makeTimelineId('tl'),
    name: String(tpl?.name ?? ''),
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
