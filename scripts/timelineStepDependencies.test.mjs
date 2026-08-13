// Assertion tests for multi-predecessor timeline step dependencies. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/timelineStepDependencies.test.mjs
//
// A step can wait on more than one earlier step. The list is stored as a
// comma-separated string of stage ids, which is also the shape a single id
// was stored in before — so the thing most worth pinning down is that a
// timeline authored back then still reads, and that every consumer draws one
// link per predecessor rather than only the first.
import {
  parseDependsOn, formatDependsOn, getTimelineTemplates,
} from '../src/utils/timelineTemplatesStore.js';
import { placeStages } from '../src/utils/timelineDates.js';
import { buildDealTimeline } from '../src/utils/dealTimeline.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// ---- parsing ---------------------------------------------------------------

same('a single id reads as a one-element list', parseDependsOn('st-a'), ['st-a']);
same('a comma list reads as its ids', parseDependsOn('st-a, st-b'), ['st-a', 'st-b']);
same('whitespace and empties are dropped', parseDependsOn(' st-a ,, st-b ,'), ['st-a', 'st-b']);
same('a repeat is only counted once', parseDependsOn('st-a, st-b, st-a'), ['st-a', 'st-b']);
same('nothing reads as no dependencies', parseDependsOn(''), []);
same('and so does null', parseDependsOn(null), []);
same('an array is accepted too', parseDependsOn(['st-b', 'st-b']), ['st-b']);
check('formatting round-trips', formatDependsOn([' st-b ', 'st-a', 'st-b']), 'st-b, st-a');

// ---- reading a timeline authored before a step could wait on two ----------

const legacy = getTimelineTemplates({
  timelineTemplates: [{
    id: 'tl-1', name: 'Legacy', services: ['S'], format: 'phased',
    stages: [{ id: 'st-a', name: 'A' }, { id: 'st-b', name: 'B', dependsOn: 'st-a' }],
  }],
})[0];
check('a legacy single id survives normalization', legacy.stages[1].dependsOn, 'st-a');
same('and parses to the one step it named', parseDependsOn(legacy.stages[1].dependsOn), ['st-a']);

const messy = getTimelineTemplates({
  timelineTemplates: [{
    id: 'tl-2', name: 'Messy', services: ['S'],
    stages: [{ id: 'st-a', name: 'A', dependsOn: 'st-x,  st-y ,st-x' }],
  }],
})[0];
check('a stored list is tidied on read', messy.stages[0].dependsOn, 'st-x, st-y');

// ---- the deal composer namespaces every predecessor, not just the first ---

// Two prerequisites feeding one step, inside a single service's band.
const overrides = { 'Rollout': { rolloutTime: '12' } };
const templates = [{
  id: 'tl-3', name: 'Rollout plan', services: ['Rollout'], format: 'phased',
  positionMode: 'months',
  stages: [
    { id: 'st-1', name: 'Survey', owner: 'Schneider Electric', startMonth: 1, months: 1, dependsOn: '' },
    { id: 'st-2', name: 'Approval', owner: 'Client', startMonth: 2, months: 1, dependsOn: '' },
    { id: 'st-3', name: 'Install', owner: 'Schneider Electric', startMonth: 3, months: 1, dependsOn: 'st-1, st-2' },
  ],
}];
const plan = buildDealTimeline({
  scopeServices: ['Rollout'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2026-08',
  clientName: 'Acme',
});
const install = plan.template.stages.find(s => s.name === 'Install');
same('both predecessors are carried into the deal plan',
  parseDependsOn(install.dependsOn), ['rollout::st-1', 'rollout::st-2']);
check('and each is namespaced to its service band',
  parseDependsOn(install.dependsOn).every(id => id.startsWith('rollout::')), true);

// ---- the chart draws one connector per predecessor ------------------------
//
// buildTimelineSvg pulls in the Schneider lockup, which imports without a
// file extension and so can't be loaded by plain Node. The connector pass is
// the part under test and it's driven entirely by parseDependsOn against the
// stage ids, so it's asserted here in the same terms the renderer uses.
function linksDrawn(stages) {
  const indexById = new Map(stages.map((st, i) => [st.id, i]));
  let n = 0;
  stages.forEach((stage, i) => {
    for (const id of parseDependsOn(stage.dependsOn)) {
      const from = indexById.get(id);
      if (from == null || from === i) continue;
      n += 1;
    }
  });
  return n;
}
const three = [{ id: 'st-a' }, { id: 'st-b' }, { id: 'st-c' }];
check('no dependency draws nothing', linksDrawn(three.map(s => ({ ...s, dependsOn: '' }))), 0);
check('one predecessor draws one link',
  linksDrawn([three[0], three[1], { ...three[2], dependsOn: 'st-a' }]), 1);
check('two predecessors draw two links',
  linksDrawn([three[0], three[1], { ...three[2], dependsOn: 'st-a, st-b' }]), 2);
check('an id naming no step is skipped, the real one still drawn',
  linksDrawn([three[0], three[1], { ...three[2], dependsOn: 'st-a, st-gone' }]), 1);
check('a step waiting on itself is skipped',
  linksDrawn([three[0], three[1], { ...three[2], dependsOn: 'st-c' }]), 0);
check('and skipping itself does not lose its real predecessor',
  linksDrawn([three[0], three[1], { ...three[2], dependsOn: 'st-c, st-b' }]), 1);

// ---- a dependency places the step, when nothing else did -----------------
//
// The Services popup writes a step as a duration plus the steps it waits on,
// and never a month. Placed one at a time, every such step fell back to
// month 1: the whole implementation drew as bars stacked at kickoff with the
// arrows running backwards out of steps that hadn't finished.
const months = (stages, mode = 'dates') => placeStages(stages, 1, mode).map(p => p.month);
const spans = (stages, mode = 'dates') => placeStages(stages, 1, mode).map(p => p.span);

const chain = [
  { id: 'a', duration: 2, durationUnit: 'months' },
  { id: 'b', duration: 1, durationUnit: 'months', dependsOn: 'a' },
  { id: 'c', duration: 1, durationUnit: 'months', dependsOn: 'b' },
];
same('a chain runs one after another', months(chain), [1, 3, 4]);
same('and each keeps the length it was given', spans(chain), [2, 1, 1]);
same('a step waiting on two starts after the later one',
  months([chain[0], { id: 'b', duration: 3, durationUnit: 'months' },
    { id: 'c', duration: 1, durationUnit: 'months', dependsOn: 'a, b' }]), [1, 1, 4]);
same('independent steps all start at kickoff',
  months([{ id: 'a', duration: 1 }, { id: 'b', duration: 1 }]), [1, 1]);
same('order in the list does not matter, the dependency does',
  months([{ id: 'b', duration: 1, durationUnit: 'months', dependsOn: 'a' },
    { id: 'a', duration: 2, durationUnit: 'months' }]), [3, 1]);

// A month the author typed is the plan. Re-sequencing it would hide a
// conflict the renderers deliberately draw in red.
same('a typed month is left where it was put',
  months([{ id: 'a', startMonth: 1, months: 4 },
    { id: 'b', startMonth: 2, months: 1, dependsOn: 'a' }], 'months'), [1, 2]);
// Dated stages are measured against the timeline's earliest dated month, the
// same base the renderers pass in (placementBaseMonth).
const JAN_2026 = 2026 * 12 + 0;
const datedMonths = (stages) => placeStages(stages, JAN_2026, 'dates').map(p => p.month);
same('a dated step is left where its dates put it',
  datedMonths([{ id: 'a', start: '2026-01-01', end: '2026-02-28' },
    { id: 'b', start: '2026-01-01', end: '2026-01-31', dependsOn: 'a' }]), [1, 1]);
same('but an undated step still sequences behind a dated one',
  datedMonths([{ id: 'a', start: '2026-01-01', end: '2026-02-28' },
    { id: 'b', duration: 1, durationUnit: 'months', dependsOn: 'a' }]), [1, 3]);

same('an id naming no step places nothing',
  months([{ id: 'a', duration: 1, durationUnit: 'months', dependsOn: 'gone' }]), [1]);
same('a step waiting on itself stays at kickoff',
  months([{ id: 'a', duration: 1, durationUnit: 'months', dependsOn: 'a' }]), [1]);
same('a cycle settles nothing rather than inventing an order',
  months([{ id: 'a', duration: 1, durationUnit: 'months', dependsOn: 'b' },
    { id: 'b', duration: 1, durationUnit: 'months', dependsOn: 'a' }]), [1, 1]);
same('and the steps behind a cycle are not dragged into it',
  months([{ id: 'a', duration: 1, durationUnit: 'months', dependsOn: 'b' },
    { id: 'b', duration: 1, durationUnit: 'months', dependsOn: 'a' },
    { id: 'c', duration: 1, durationUnit: 'months' }]), [1, 1, 1]);
same('nothing to place is not an error', months([]), []);

// ---- and the deal plan draws the same sequence ---------------------------
//
// The composer measures each service's band with the same placement, so a
// chain of steps makes the band as long as the chain — and a service waiting
// on that one starts after it really finishes, not after its first step.
const seqTemplates = [{
  id: 'tl-4', name: 'Bill payment timeline', services: ['Bill payment'], format: 'phased',
  positionMode: 'dates',
  stages: [
    { id: 'k', name: 'Kickoff', owner: 'Schneider Electric', duration: 1, durationUnit: 'months' },
    { id: 'setup', name: 'ERP System Setup', owner: 'Client', duration: 2, durationUnit: 'months', dependsOn: 'k' },
    { id: 'live', name: 'Go Live', owner: 'Schneider Electric', duration: 1, durationUnit: 'months', dependsOn: 'setup' },
  ],
}];
const seqPlan = buildDealTimeline({
  scopeServices: ['Bill payment', 'Reporting'],
  templates: seqTemplates,
  serviceOverrides: { 'Reporting': { dependsOn: 'Bill payment', rolloutTime: '4' } },
  anchorMonth: '2026-08',
});
const monthOf = (name) => seqPlan.template.stages.find(s => s.name === name)?.startMonth;
check('the first step is at kickoff', monthOf('Kickoff'), 1);
check('the step waiting on it follows it', monthOf('ERP System Setup'), 2);
check('and the one after that follows in turn', monthOf('Go Live'), 4);
check('the band is as long as the chain it draws',
  seqPlan.services.find(s => s.name === 'Bill payment').months, 4);
check('so a service waiting on it starts after the whole chain',
  seqPlan.services.find(s => s.name === 'Reporting').startMonth, 5);
check('and the plan is as long as the two together', seqPlan.monthsNeeded, 5);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
