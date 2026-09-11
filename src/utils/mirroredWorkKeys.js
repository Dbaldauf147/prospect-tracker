// The localStorage keys that hold WORK — things the user typed or decided —
// rather than view state, given a Firestore copy so they follow the user to
// their other machine.
//
// The distinction that matters: a collapsed panel or an active subtab is
// worth nothing on another laptop, but a rewritten agent prompt, a supplier
// decision, or a list of pairs marked "not duplicates" is real effort, and
// losing it to "which browser am I on" is the kind of thing you only notice
// when the app quietly behaves differently.
//
// Storage shape is deliberately unchanged: each key stays exactly where and
// how it already was, so nothing existing is stranded. All this adds is the
// cloud copy — see utils/localMirrorSync for the newest-wins rules, and note
// that hydration fires each group's event, which is how a view that's already
// open picks the value up without a reload.
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';
import { userLsGet, userLsSet, userLsRemove } from './userLs.js';

// One event per feature area, so a view only re-reads for its own keys.
export const AGENT_SETTINGS_EVENT = 'agent-settings-changed';
export const OPPS_TODO_EVENT = 'opps-todo-changed';
export const UTILITY_LOOKUP_EVENT = 'utility-lookup-changed';
export const VIBE_PRESETS_EVENT = 'vibe-presets-changed';
export const CHART_PREFS_EVENT = 'chart-prefs-changed';
export const DEDUPE_DISMISSED_EVENT = 'dedupe-dismissed-changed';
export const BLOCKED_NAMES_EVENT = 'blocked-names-changed';
export const BULK_CONTACT_RULES_EVENT = 'bulk-contact-rules-changed';
export const CONTRACT_SERVICES_EVENT = 'contract-services-changed';

const GROUPS = [
  {
    // The Agents tab. The eleven AI prompts are the ones worth having here —
    // a rewritten prompt on one machine and the stock wording on the other
    // means the same button does two different things. The four decision
    // lists below them are the same class of thing: which recipients,
    // emails and meetings to leave out, and the BFO tags chosen for the
    // activity rows that didn't auto-match.
    event: AGENT_SETTINGS_EVENT,
    keys: [
      'agents-ai-prompt',
      'agents-ai-prompt-new-bfo-opp',
      'agents-ai-prompt-close-dates',
      'agents-ai-prompt-amount-updates',
      'agents-ai-prompt-stage-change',
      'agents-ai-prompt-close-not-solds',
      'agents-ai-prompt-update-bfo-activity',
      'agents-ai-prompt-bfo-prep',
      'agents-ai-prompt-import-marketing-leads',
      'agents-ai-prompt-marketing-leads',
      'agents-ai-prompt-marketing-lead-status-update',
      'agents-ai-prompt-duplicate-leads',
      'agents-bfo-overrides',
      'agents-excluded-recipients',
      'agents-ignored-emails',
      'agents-ignored-meetings',
      'agents-hide-activity-on-date',
    ],
  },
  // The free-text to-do note on the Opps 2 tab. A note you wrote.
  { event: OPPS_TODO_EVENT, keys: ['opps2:todo'] },
  // Sites: which supplier a utility name maps to, the vendor calls, and the
  // property-type map. Judgements made once per utility, not preferences.
  {
    event: UTILITY_LOOKUP_EVENT,
    keys: [
      'utility-lookup:supplier-overrides',
      'utility-lookup:vendor-decisions',
      'utility-lookup:property-type-map',
    ],
  },
  // Vibe Prospecting: the searches run and the title presets built up.
  { event: VIBE_PRESETS_EVENT, keys: ['vibe-prospecting-history', 'vibe-title-presets'] },
  // Progress and YOY: pinned charts, renamed titles, saved views, and which
  // charts are hidden — a dashboard the user arranged.
  {
    event: CHART_PREFS_EVENT,
    keys: [
      'progress:chart-pins',
      'progress:chart-titles',
      'progress:chart-views',
      'progress:hidden-charts',
      'yoy-hidden-charts',
    ],
  },
  // Pairs judged not to be duplicates. Re-deciding these is the work.
  { event: DEDUPE_DISMISSED_EVENT, keys: ['dedupe-dismissed'] },
  // Names blocked from an uploaded list's account matching.
  { event: BLOCKED_NAMES_EVENT, keys: ['target-accounts:blocked-names'] },
  // Bulk Add Contacts: the company-name rules taught to the importer.
  { event: BULK_CONTACT_RULES_EVENT, keys: ['bulk-contacts-company-rules'] },
  // The Clients tab's contract-services analysis (the analysis only — the
  // uploaded file's bytes were never kept).
  { event: CONTRACT_SERVICES_EVENT, keys: ['clients-view:contract-services'] },
];

const EVENT_FOR_KEY = new Map();
for (const group of GROUPS) {
  for (const key of group.keys) {
    registerMirroredKey(key, group.event);
    EVENT_FOR_KEY.set(key, group.event);
  }
}

/** Every key this module mirrors — for tests and the backup tooling. */
export const MIRRORED_WORK_KEYS = [...EVENT_FOR_KEY.keys()];

export function isMirroredWorkKey(key) {
  return EVENT_FOR_KEY.has(key);
}

export function readWorkKey(key) {
  return userLsGet(key);
}

/**
 * Write a mirrored key and queue its push. Call sites use this instead of
 * userLsSet so the cloud copy can't be forgotten at one of them.
 */
export function writeWorkKey(key, value) {
  userLsSet(key, value);
  queueMirrorPush(key);
}

/**
 * Clear one. `allowEmpty` matters: an empty payload is how the mirror says
 * "cleared on another device" — without it the clear would stay local and
 * the other machine would push the old value straight back.
 */
export function clearWorkKey(key) {
  userLsRemove(key);
  queueMirrorPush(key, { allowEmpty: true });
}
