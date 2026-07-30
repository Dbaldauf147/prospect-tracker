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
    description: String(stage?.description ?? ''),
  };
}

function normalizeTemplate(tpl) {
  return {
    id: tpl?.id || makeTimelineId('tl'),
    name: String(tpl?.name ?? ''),
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
