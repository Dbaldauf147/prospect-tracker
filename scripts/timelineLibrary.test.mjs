// Assertion tests for the built-in timeline library and the milestone canvas
// it's drawn on. Plain Node — no test framework (the project has none). Run:
//   node scripts/timelineLibrary.test.mjs
//
// Two things have to hold. First, a timeline that ships with the app has to be
// reachable by someone who already saved a set of their own: the seeds stop
// showing the moment anything on the page is edited, so libraryTimelines is
// what puts a later addition in front of them, and it must offer exactly the
// ones they don't already have.
//
// Second, the milestone canvas is sized to its text rather than the other way
// round — these two implementation timelines carry the paragraph the slide
// prints under each step. So no callout may be ellipsed or run off the edge,
// and a timeline whose text fits the original fixed layout must still be drawn
// on exactly that canvas.
import { getTimelineTemplates, libraryTimelines } from '../src/utils/timelineTemplatesStore.js';
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

// --- the library offers what's missing, and only that ----------------------
check('nothing saved: everything is already showing', libraryTimelines(seeds).length, 0);
check('a saved set without them: both offered', libraryTimelines([{ id: 'tl-budget' }]).length, 2);
check('…in seed order', libraryTimelines([{ id: 'tl-budget' }])[0].id, 'tl-strategic-sourcing');
check('deleting one offers just that one', libraryTimelines(seeds.filter(t => t.id !== 'tl-risk-management'))[0]?.id, 'tl-risk-management');
check('an empty list offers all of them', libraryTimelines([]).length, BUILTIN_TIMELINE_TEMPLATES.length);
check('junk in the saved set is ignored, not crashed on', libraryTimelines([null, {}, 'x']).length, BUILTIN_TIMELINE_TEMPLATES.length);
// What the library hands over is a whole timeline, not a reference to the seed.
const copy = libraryTimelines([])[1];
copy.stages[0].name = 'edited';
check('the copy is detached from the seed', BUILTIN_TIMELINE_TEMPLATES[1].stages[0].name, 'Review current supply agreements and expirations');

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
