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

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
