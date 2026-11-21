// Assertion tests for the Ikigai page's scoring. Plain Node, no test
// framework (the project has none). Run:
//   node scripts/ikigai.test.mjs
//
// What's worth holding: an unrated circle has no score rather than a zero,
// an overlap is as strong as its weaker circle, the reading names the right
// gap, and a paste from the spreadsheet lands on the right questions.
import {
  CIRCLES, sanitizeAnswers, scoreIkigai, readStanding, markerOffset, parsePastedAnswers,
} from '../src/utils/ikigai.js';

let failures = 0;
function same(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  const ok = a === b;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${b}`}`);
}

// Rate every question of each circle with the given rating (null = leave it).
function rated(byCircle) {
  const out = {};
  for (const c of CIRCLES) {
    const r = byCircle[c.id];
    if (r == null) continue;
    for (const q of c.questions) out[q.id] = { text: '', rating: r };
  }
  return out;
}

const ids = CIRCLES.flatMap(c => c.questions.map(q => q.id));
same('question ids are unique', new Set(ids).size, ids.length);

// --- sanitizing ---------------------------------------------------------------

same('garbage reads as no answers', sanitizeAnswers('nope'), {});
same('unknown questions and bad ratings are dropped',
  sanitizeAnswers({ 'love-flow': { text: 'tools', rating: 9 }, bogus: { text: 'x', rating: 3 }, 'good-soft': { rating: 0 } }),
  { 'love-flow': { text: 'tools', rating: null } });

// --- scoring ------------------------------------------------------------------

const empty = scoreIkigai({});
same('nothing rated: no circle score', empty.circles.love.score, null);
same('nothing rated: no ikigai score', empty.ikigai, null);
same('nothing rated: no marker', markerOffset(empty), null);

const notesOnly = scoreIkigai({ 'love-flow': { text: 'designing a tool', rating: null } });
same('notes without a rating are answered but not scored',
  [notesOnly.circles.love.answered, notesOnly.circles.love.rated, notesOnly.circles.love.score], [1, 0, null]);

const mixed = scoreIkigai({ 'love-flow': { text: '', rating: 5 }, 'love-free': { text: '', rating: 1 } });
same('a circle averages only its rated questions (5 and 1 is 50)', mixed.circles.love.score, 50);

const s = scoreIkigai(rated({ love: 5, good: 4, needs: 2, paid: 3 }));
same('circle scores', CIRCLES.map(c => s.circles[c.id].score), [100, 75, 25, 50]);
same('overlaps take the weaker circle', s.overlaps, { passion: 75, mission: 25, profession: 50, vocation: 25 });
same('ikigai takes the weakest of the four', s.ikigai, 25);

const partial = scoreIkigai(rated({ love: 5, good: 4 }));
same('an overlap with an unrated circle stays blank', [partial.overlaps.passion, partial.overlaps.mission, partial.ikigai], [75, null, null]);

// --- reading ------------------------------------------------------------------

const read = (byCircle) => readStanding(scoreIkigai(rated(byCircle)));
same('not started', read({}).headline, 'Not started');
same('in progress names the first unrated circle', [read({ love: 5 }).headline, read({ love: 5 }).focus], ['In progress', 'good']);
same('all strong is Ikigai', read({ love: 5, good: 4, needs: 4, paid: 5 }).headline, 'Ikigai');
same('one weak circle is named, and is the focus',
  [read({ love: 5, good: 4, needs: 4, paid: 2 }).headline, read({ love: 5, good: 4, needs: 4, paid: 2 }).focus],
  ['Missing: What You Can Be Paid For', 'paid']);
same('two neighbouring strong circles read as their pairing', read({ love: 5, good: 5, needs: 2, paid: 1 }).headline, 'Passion');
same('two opposite strong circles read as split', read({ love: 5, good: 2, needs: 2, paid: 5 }).headline, 'Split');
same('one strong circle', read({ love: 5, good: 2, needs: 2, paid: 1 }).headline, 'Anchored in What You Love');
same('no strong circle', read({ love: 2, good: 2, needs: 2, paid: 1 }).headline, 'Searching');

// --- marker -------------------------------------------------------------------

same('balanced scores sit dead center', markerOffset(scoreIkigai(rated({ love: 4, good: 4, needs: 4, paid: 4 }))), { x: 0, y: 0 });
const pulled = markerOffset(scoreIkigai(rated({ love: 5, good: 5, needs: 2, paid: 2 })));
same('strong Love and Good At pull the marker up and left', [pulled.x < 0, pulled.y < 0], [true, true]);

// --- paste --------------------------------------------------------------------

const sheet = [
  'Pillar\tFocus Area\tReflection Question\tYour Answer / Notes',
  '1. PASSION\tWhat You Love\tWhat tasks do you perform where you completely lose track of time?\tWhen I am designing a system or tool',
  // Straight apostrophe here, curly in the app: still the same question.
  "1. PASSION\tWhat You Love\tIf you didn't need the money, which parts of your job would you still do for free?\tI am not sure",
  '2. VOCATION\tWhat You Are Good At\tWhat do coworkers or friends constantly ask for your help with?\t',
].join('\n');
same('pasted rows land on their questions, blanks skipped', parsePastedAnswers(sheet),
  { 'love-flow': 'When I am designing a system or tool', 'love-free': 'I am not sure' });
same('a paste with no questions finds nothing', parsePastedAnswers('hello\tworld'), {});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
