// Assertion tests for the timeline library and the milestone canvas its
// timelines are drawn on. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/timelineLibrary.test.mjs
//
// Two things have to hold. First the shelf: it carries both the timelines
// that ship with the app — which is how one added later reaches someone who
// already saved a set of their own — and the ones the user saves from their
// list. Saving twice must update one entry rather than grow a second, what's
// on the shelf must be a snapshot that later edits don't rewrite, and taking
// a copy off it must be a genuinely separate timeline: same plan, its own
// ids, its own step dependencies.
//
// Second, the milestone canvas is sized to its text rather than the other way
// round — the two implementation timelines carry the paragraph the slide
// prints under each step. So no callout may be ellipsed or run off the edge,
// and a timeline whose text fits the original fixed layout must still be drawn
// on exactly that canvas.
import {
  getTimelineTemplates, libraryEntries, saveToLibrary, removeFromLibrary,
  instantiateTimeline, parseDependsOn,
} from '../src/utils/timelineTemplatesStore.js';
import { BUILTIN_TIMELINE_TEMPLATES } from '../src/data/timelineTemplates.js';
import { buildTimelineSvg } from '../src/utils/timelineGraphic.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const seeds = getTimelineTemplates({});
const sourcing = seeds.find(t => t.id === 'tl-strategic-sourcing');
const risk = seeds.find(t => t.id === 'tl-risk-management');

// --- the two implementation timelines are there and shaped right -----------
check('Strategic Sourcing seeded', sourcing?.name, 'Strategic Sourcing Implementation');
check('…with five steps', sourcing?.stages.length, 5);
check('…drawn as milestones', sourcing?.format, 'milestone');
check('…and carries its slide subtitle', sourcing?.subtitle.startsWith('Building the procurement foundation'), true);
check('Risk Management seeded', risk?.name, 'EP and NG Risk Management Implementation');
check('…with five steps', risk?.stages.length, 5);
check('…every one of which states its months', risk?.stages.every(s => /Month \d/.test(s.timing)), true);
check('…and none of which is dated', risk?.stages.every(s => !s.start && !s.end), true);

// --- the shelf: what's on it ----------------------------------------------
check('an untouched library is the built-ins', libraryEntries({}).length, BUILTIN_TIMELINE_TEMPLATES.length);
check('…each keyed by its own id', libraryEntries({})[1].libraryId, 'tl-strategic-sourcing');
check('…and marked as shipped, so it can\u2019t be removed', libraryEntries({}).every(e => e.builtIn), true);
check('junk in the saved library is ignored, not crashed on', libraryEntries({ timelineLibrary: null }).length, BUILTIN_TIMELINE_TEMPLATES.length);
// What the shelf hands over is a whole timeline, not a reference to the seed.
const shelfCopy = libraryEntries({})[1];
shelfCopy.stages[0].name = 'edited';
check('the entry is detached from the seed', BUILTIN_TIMELINE_TEMPLATES[1].stages[0].name, 'Review current supply agreements and expirations');

// --- the shelf: saving your own onto it -----------------------------------
const mine = { ...seeds[0], id: 'tl-mine', libraryId: 'lib-mine', name: 'Client onboarding' };
const lib1 = saveToLibrary({}, mine);
check('saving adds an entry', lib1.length, 1);
check('…under the id it was given', lib1[0].libraryId, 'lib-mine');
check('…and it shows up on the shelf', libraryEntries({ timelineLibrary: lib1 }).length, BUILTIN_TIMELINE_TEMPLATES.length + 1);
check('…as the user\u2019s, so it can be removed', libraryEntries({ timelineLibrary: lib1 }).at(-1).builtIn, false);

const lib2 = saveToLibrary({ timelineLibrary: lib1 }, { ...mine, name: 'Client onboarding v2' });
check('saving the same timeline again updates its entry', lib2.length, 1);
check('…to how it reads now', lib2[0].name, 'Client onboarding v2');
const lib3 = saveToLibrary({ timelineLibrary: lib2 }, { ...mine, libraryId: 'lib-other', name: 'Another' });
check('a different timeline gets its own entry', lib3.length, 2);
check('saving without an id still stores one', saveToLibrary({}, { ...mine, libraryId: '' })[0].libraryId.startsWith('lib-'), true);

// The entry is a snapshot: editing the timeline afterwards must not reach it.
const working = { ...mine, stages: mine.stages.map(st => ({ ...st })) };
const snapshot = saveToLibrary({}, working);
working.stages[0].name = 'edited after saving';
check('the entry is a snapshot, not a live reference', snapshot[0].stages[0].name, 'Agreement signed');

check('removing takes it off the shelf', removeFromLibrary({ timelineLibrary: lib3 }, 'lib-mine').length, 1);
check('…and only the one named', removeFromLibrary({ timelineLibrary: lib3 }, 'lib-mine')[0].libraryId, 'lib-other');
check('removing a built-in is a no-op, not an error', removeFromLibrary({ timelineLibrary: lib3 }, 'tl-budget').length, 2);

// --- taking a copy off the shelf ------------------------------------------
const entry = libraryEntries({})[1];
const first = instantiateTimeline(entry);
const second = instantiateTimeline(entry);
check('a copy is a new timeline', first.id === entry.id, false);
check('…and two copies are different timelines', first.id === second.id, false);
check('…with their own steps', first.stages.every((st, i) => st.id !== entry.stages[i].id && st.id !== second.stages[i].id), true);
check('…that read the same', first.stages.map(st => st.name).join('|'), entry.stages.map(st => st.name).join('|'));
check('…and remember where they came from', first.libraryId, entry.libraryId);

// Step dependencies are stage ids, so they have to travel through the same
// remap — a copy whose steps waited on the ORIGINAL's steps would be placed
// off the timeline it belongs to.
const chained = instantiateTimeline({
  ...entry,
  stages: [
    { ...entry.stages[0], id: 'st-a' },
    { ...entry.stages[1], id: 'st-b', dependsOn: 'st-a' },
    { ...entry.stages[2], id: 'st-c', dependsOn: 'st-a, st-b' },
  ],
});
check('a copied step waits on its own copy of the earlier step',
  parseDependsOn(chained.stages[1].dependsOn)[0], chained.stages[0].id);
check('…including when it waits on several', parseDependsOn(chained.stages[2].dependsOn).join(','),
  [chained.stages[0].id, chained.stages[1].id].join(','));
check('…and none of them points at the original', 
  chained.stages.some(st => parseDependsOn(st.dependsOn).some(id => id === 'st-a' || id === 'st-b')), false);

// --- the canvas fits the text ---------------------------------------------
function svgFor(tpl) {
  const svg = buildTimelineSvg(tpl);
  const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  // Where every left-aligned text run starts, so nothing can sit outside the
  // drawing. The legend's closing note is anchored to the right edge and is
  // measured from the other end, so it's left out.
  const runs = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"([^>]*)>/g)]
    .filter(m => !m[3].includes('text-anchor="end"'));
  return {
    svg, w, h,
    maxX: Math.max(...runs.map(m => Number(m[1]))),
    maxY: Math.max(...runs.map(m => Number(m[2]))),
  };
}
for (const tpl of [sourcing, risk]) {
  const { svg, w, h, maxX, maxY } = svgFor(tpl);
  check(`${tpl.name}: no step is cut off with an ellipsis`, svg.includes('…'), false);
  // The widest column of text starts at maxX and runs 246px; the canvas has to
  // cover it, plus the padding the header and legend are drawn in.
  check(`${tpl.name}: text stays inside the canvas`, maxX + 246 <= w, true);
  check(`${tpl.name}: nothing is drawn below the canvas`, maxY <= h, true);
  // Every step's description survives the wrap, word for word.
  const words = svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check(`${tpl.name}: descriptions are drawn in full`,
    tpl.stages.every(s => s.description.split(/\s+/).every(word => words.includes(word.replace(/&/g, '&amp;')))), true);
}

// A timeline whose callouts fit the original fixed layout is drawn on exactly
// the canvas it always was — growing is for the ones that need it.
const legacy = buildTimelineSvg({ ...seeds[0], format: 'milestone' });
check('a short milestone timeline keeps its axis at 322', /y1="322"/.test(legacy), true);
check('…and its legend at 606', /y="606"/.test(legacy), true);
check('…and its 646px canvas', /viewBox="0 0 \d+ 646"/.test(legacy), true);

console.log(failures === 0 ? '\nAll timeline library tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
