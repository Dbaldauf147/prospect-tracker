// The Prospecting ladder — the ranked steps that page renders, and the
// user's edits to them.
//
// The order used to be a constant in ProspectingView, which meant changing
// it was a code change. It's a playbook, so it belongs to the user: the
// steps can be reordered, retitled, re-pointed at a different tab, added to
// and removed. This module owns the defaults and the merge, and the page
// owns the rendering.
//
// What CAN'T move into settings is the behaviour attached to five of the
// steps — the overdue-opps count, the renewals count, the service-coverage
// and Top-PC lists, and the market-updates step going red once the ladder
// reaches it. Those are wired to a step's `key`, so a stored step is
// a thin overlay: it carries the key plus whatever text the user changed,
// and the code-side default supplies the rest. Retitling "Follow up on
// current opps" therefore keeps its count; a step the user adds has no key
// the code knows, so it's hand-marked like the other untracked steps.
//
// Storage follows the Keith agenda's rule: an untouched playbook stores
// nothing and renders the defaults below. The first edit materializes the
// whole ordered list, and from then on the stored array IS the ladder —
// `[]` means the user emptied it, absent means they never touched it.

import { RENEWAL_WARNING_DAYS } from './renewalWindow.js';

// The tabs a step can send the user to, labelled as the sidebar labels
// them. Doubles as the picker's options and as the lookup that names the
// action button, so re-pointing a step can't leave a stale label behind.
export const STEP_VIEW_OPTIONS = [
  { view: 'accounts', label: 'My Accounts' },
  { view: 'prospecting', label: 'Prospecting' },
  { view: 'lists', label: 'Lists' },
  { view: 'opps2', label: 'Opps' },
  { view: 'dropdowns', label: 'Dropdowns' },
  { view: 'clients', label: 'Clients' },
  { view: 'issues', label: 'Issues' },
  { view: 'activity', label: 'Activity' },
  { view: 'agents', label: 'Agents' },
  { view: 'pe', label: 'PE Portfolio' },
  { view: 'contacts', label: 'Contacts' },
  { view: 'drafts', label: 'Draft Emails' },
  { view: 'recordings', label: 'Call Recordings' },
  { view: 'charts', label: 'Charts' },
  { view: 'pricing', label: 'Pricing' },
  { view: 'bfo', label: 'BFO Activity' },
];

const VIEW_LABELS = new Map(STEP_VIEW_OPTIONS.map(o => [o.view, o.label]));

// Name the button for a step's target tab. Falls back to the step's own
// label (then the raw view key) so a step pointed at a tab that isn't in
// the list above still reads as something.
export function viewLabelFor(view, fallback) {
  return VIEW_LABELS.get(view) || fallback || view || '';
}

// The shipped ladder. `workLabel` marks a step as counted — the ones
// without it are marked caught up by hand. Those functions and the
// tooltips beside them are behaviour, not content: they stay here and are
// re-attached by key after a user's stored text is merged in.
export const DEFAULT_STEPS = [
  {
    key: 'opps',
    title: 'Follow up on current opps',
    detail: 'Opportunities already in flight. Nothing new gets worked until these are moving.',
    view: 'opps2',
    viewLabel: 'Opps',
    workLabel: n => `${n} overdue`,
    // Opps marked "No Further Action Today" are settled for the day, so
    // they're left out of the count — same rule the sidebar's Opps badge
    // uses. The tooltips say so, since a number that skips rows the user
    // can see on the Opps tab is otherwise just wrong-looking.
    workTitle: n => `${n} open ${n === 1 ? 'opp is' : 'opps are'} past their Call In date, not counting any marked "No Further Action Today"`,
    clearTitle: 'No open opp is past its Call In date, other than ones marked "No Further Action Today"',
  },
  {
    key: 'market-updates',
    title: 'Reach out to contacts with market updates',
    detail: 'Give the contacts you already know a reason to reply: what the market is doing right now.',
    view: 'contacts',
    viewLabel: 'Contacts',
    // Nothing counts this step, but it is not optional either: once the
    // steps above it are clear it is the work owed today, so it goes red
    // rather than staying the same grey "Mark caught up" it wears while
    // there is warmer work in front of it — and the sidebar dots
    // Prospecting while it stands. Marking it caught up is what clears
    // it, for the day. Behaviour, like the counts: never stored, always
    // re-attached by key.
    dueWhenReached: true,
  },
  {
    key: 'renewals',
    title: 'Follow up with current client renewals',
    detail: 'Contracts coming up on clients you already hold — the shortest path to the next conversation.',
    view: 'clients',
    viewLabel: 'Clients',
    workLabel: n => `${n} to work`,
    // Named the same way the Clients tab names its red rows, because they
    // are the same rows.
    workTitle: n => `${n} client${n === 1 ? '' : 's'} whose soonest contract expires within ${RENEWAL_WARNING_DAYS} days (or already has) with the Status column still blank`,
    clearTitle: `No client with a contract expiring within ${RENEWAL_WARNING_DAYS} days is missing a Status`,
  },
  {
    key: 'targeted-services',
    title: 'Reach out to existing clients for targeted services',
    detail: 'Services an existing client has not explored yet. The relationship is already there.',
    view: 'clients',
    viewLabel: 'Clients',
    workLabel: n => `${n} service${n === 1 ? '' : 's'}`,
    workTitle: n => `${n} tracked ${n === 1 ? 'service is' : 'services are'} below 100% coverage across your active clients`,
    clearTitle: 'Every tracked service has been explored by all of your active clients',
  },
  {
    key: 'pe-intros',
    title: 'Reach out to PE partners about intros for top PCs',
    detail: 'Warm intros through the PE relationship into their highest-scoring portfolio companies.',
    view: 'pe',
    viewLabel: 'PE Portfolio',
    workLabel: n => `${n} to ask`,
    workTitle: n => `${n} Top ${n === 1 ? 'PC is' : 'PCs are'} not at Qualifying yet — an intro still to ask the PE partner for`,
    clearTitle: 'Every PE firm\'s Top PC is already at Qualifying',
  },
  {
    key: 'cold',
    title: 'Cold prospect outreach',
    detail: 'Names with no relationship yet. Last, because everything above has a warmer way in.',
    view: 'accounts',
    viewLabel: 'My Accounts',
  },
];

const DEFAULTS_BY_KEY = new Map(DEFAULT_STEPS.map(s => [s.key, s]));

export const PROSPECTING_STEPS_SETTING = 'prospectingSteps';

// Keys for steps the user adds. Prefixed so a custom step can never
// collide with a built-in key — including one added to DEFAULT_STEPS
// later, which would otherwise silently inherit a count that isn't its.
const CUSTOM_PREFIX = 'ps_';
export const isCustomStep = (key) => String(key || '').startsWith(CUSTOM_PREFIX);
export function newStepKey() {
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Settings → the steps to render, in order. Anything malformed is dropped
// rather than thrown on: a half-written array from an older shape
// shouldn't blank the page.
//
// A stored entry only overrides the fields it actually carries, so text
// the user never edited keeps tracking the default — a later copy fix
// reaches them instead of being frozen at whatever shipped the day they
// first dragged a row.
export function readSteps(settings) {
  const raw = settings?.[PROSPECTING_STEPS_SETTING];
  if (!Array.isArray(raw)) return DEFAULT_STEPS;
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const key = str(it.key);
    // A duplicate key would give two rows the same caught-up mark and the
    // same React key; first one wins.
    if (!key || seen.has(key)) continue;
    const base = DEFAULTS_BY_KEY.get(key);
    // An unknown key that isn't one of ours is a step from a version that
    // knew something we don't — keep it as plain text rather than dropping
    // the user's row.
    if (!base && !str(it.title)) continue;
    seen.add(key);
    const step = { ...(base || { key }) };
    if (str(it.title)) step.title = str(it.title);
    if (typeof it.detail === 'string') step.detail = it.detail.trim();
    // `typeof`, not truthiness: a stored empty string is the user having
    // taken a step's target tab away, and has to survive the round trip.
    if (typeof it.view === 'string') step.view = str(it.view);
    // Derived, never stored: re-pointing a step at another tab has to
    // rename its button too.
    step.viewLabel = step.view ? viewLabelFor(step.view, base?.viewLabel) : '';
    out.push(step);
  }
  return out;
}

// The steps as they go into settings: the key, plus only the fields that
// differ from the code-side default. Behaviour (the workLabel / workTitle
// functions) is never stored — readSteps re-attaches it by key.
export function serializeSteps(steps) {
  const out = [];
  for (const s of (Array.isArray(steps) ? steps : [])) {
    const key = str(s?.key);
    if (!key) continue;
    const base = DEFAULTS_BY_KEY.get(key);
    const entry = { key };
    if (str(s.title) && s.title !== base?.title) entry.title = str(s.title);
    if (typeof s.detail === 'string' && s.detail.trim() !== (base?.detail || '')) entry.detail = s.detail.trim();
    if (str(s.view) !== (base?.view || '')) entry.view = str(s.view);
    out.push(entry);
  }
  return out;
}

// Has the user touched the ladder? Drives the "Reset to defaults" control —
// there's nothing to reset to before the first edit.
export function isCustomized(settings) {
  return Array.isArray(settings?.[PROSPECTING_STEPS_SETTING]);
}

// Move the step at `index` one place up (-1) or down (+1). Returns the
// same array when the move would run off either end, so a caller can
// commit unconditionally without writing a no-op to settings.
export function moveStep(steps, index, delta) {
  const list = Array.isArray(steps) ? steps : [];
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
