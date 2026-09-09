// Assertion tests for the PE Stage fallback. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/peStageLead.test.mjs
//
// Every PE board, the Portfolio table's stage column and the emailed
// workbook bucket a firm through peStageOf. The rule they all depend on is
// that a firm with nothing stored is a Lead — not a bucket of its own, and
// never dropped. Three ways that could quietly break:
//
//   - Lead sliding out of first place in PE_STAGES, which reorders the
//     board columns and the table's stage sort;
//   - a blank (or a stage retired from the enum) falling through to
//     undefined, which would hand the boards a group key nothing owns;
//   - a stage losing its palette entry, so its column paints with whatever
//     the lookup's fallback happens to be.
import { PE_STAGES } from '../src/data/enums.js';
import { PE_STAGE_META, PE_DEFAULT_STAGE, peStageOf, peStageMeta } from '../src/utils/peStages.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// ---- the enum ---------------------------------------------------------------

check('Lead is the first stage', PE_STAGES[0], 'Lead');
check('and is the default', PE_DEFAULT_STAGE, 'Lead');
check('the pipeline is Lead → Not Sold', PE_STAGES,
  ['Lead', 'Discovery', 'Piloting', 'Existing Partnership', 'Not Sold']);
check('nothing is bucketed outside the enum',
  PE_STAGE_META.map(m => m.stage), PE_STAGES);

// ---- the fallback -----------------------------------------------------------

check('a firm with no stage is a Lead', peStageOf(''), 'Lead');
check('undefined too', peStageOf(undefined), 'Lead');
check('null too', peStageOf(null), 'Lead');
check('and a stage retired from the enum', peStageOf('Unassigned'), 'Lead');
check('a stored stage is used verbatim', peStageOf('Piloting'), 'Piloting');
check('including Not Sold, which is a real stage not an absence',
  peStageOf('Not Sold'), 'Not Sold');
// Case matters: the field is written from a fixed dropdown, so a
// near-miss is bad data rather than a stage to guess at.
check('a near-miss is not guessed at', peStageOf('piloting'), 'Lead');

// ---- the palette ------------------------------------------------------------

for (const stage of PE_STAGES) {
  check(`${stage} paints as itself`, peStageMeta(stage).stage, stage);
}
check('a blank paints as Lead', peStageMeta('').stage, 'Lead');
const colors = PE_STAGE_META.map(m => m.accent);
check('every stage has its own accent', new Set(colors).size, colors.length);
check('every stage carries a full palette',
  PE_STAGE_META.every(m => /^#[0-9A-F]{6}$/i.test(m.accent) && /^#[0-9A-F]{6}$/i.test(m.bg) && /^#[0-9A-F]{6}$/i.test(m.border)),
  true);

console.log(failures === 0 ? '\nAll PE stage tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
