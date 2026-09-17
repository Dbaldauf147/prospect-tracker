// Assertion tests for the service popup's props, derived from settings.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/serviceDetailProps.test.mjs
//
// The popup itself has lived on Dropdowns › Services since that table grew
// twelve columns behind a horizontal scrollbar. What it showed that no cell
// could was the REVERSE lists: which services wait on this one, which ones
// pull it into Scope, which sales mark it N/A. Nothing stores those, so they
// are derived — and they are now derived here rather than inside the page,
// because the Opps Scope board opens the same popup when a service name is
// clicked.
//
// So what is worth pinning is the derivation: each reverse list pointing the
// right way, the bucket coming through, and a name the vocabulary doesn't
// carry still opening a popup rather than nothing at all.
import { buildServiceDetail } from '../src/utils/serviceDetailProps.js';
import { buildServiceRows } from '../src/utils/serviceRows.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const rows = buildServiceRows({});
const [a, b, c] = rows.map(r => r.name);

// Nothing asked for, nothing built: the board renders no popup rather than an
// empty one.
check('no name means no detail', buildServiceDetail({}, ''), null);
check('a blank name means no detail', buildServiceDetail({}, '   '), null);
check('undefined settings still build one', buildServiceDetail(undefined, a)?.service?.name, a);

// The ordinary case: a service off the shipped catalog.
const plain = buildServiceDetail({}, a);
check('the row comes through whole',
  Boolean(plain.service.name === a && plain.service.meta && typeof plain.bucket === 'string'), true);
check('the bucket options are the board boxes', plain.bucketOptions.includes(plain.bucket), true);
check('the dependency picker gets the whole vocabulary', plain.options.length, rows.length);
check('a service nothing is said about has empty reverse lists',
  [plain.dependents.length, plain.autoAddedBy.length, plain.autoNaedBy.length].every(n => n === 0), true);

// Case doesn't have to match: a Scope cell can spell a service the way
// somebody typed it, and it still opens that service's popup rather than a
// blank one made from the typed spelling.
check('a name matches case-insensitively', buildServiceDetail({}, a.toUpperCase()).service.name, a);

// The three reverse lists, each built from another service's row. B waits on
// A, B brings A into Scope, and selling B settles A: from A's popup, all
// three name B.
const settings = {
  serviceOverrides: {
    [b]: { dependsOn: a, autoAdd: a, autoNa: a },
  },
};
const reversed = buildServiceDetail(settings, a);
check('"waiting on this one" names the service that depends on it', reversed.dependents, [b]);
check('"comes into Scope with" names the service that auto-adds it', reversed.autoAddedBy, [b]);
check('"marked N/A by selling" names the service whose sale settles it', reversed.autoNaedBy, [b]);

// And the forward direction stays on B's own row, so the popup can't read one
// list as both.
const forward = buildServiceDetail(settings, b);
check('the forward dependency list is B\'s own', forward.service.meta.dependsOn, a);
check('B has nothing waiting on it', forward.dependents, []);

// Two services naming the same one both show up, in row order.
const twoWays = buildServiceDetail({
  serviceOverrides: { [b]: { dependsOn: a }, [c]: { dependsOn: a } },
}, a);
check('every dependent is listed', twoWays.dependents, [b, c]);

// The hyperlink and the retired flag are read for the service actually shown,
// not for whatever was typed.
check('a saved link comes through',
  buildServiceDetail({ serviceLinks: { [a]: 'https://example.com/a' } }, a).url,
  'https://example.com/a');
check('a service with no link gets an empty one', plain.url, '');
check('a hidden service says so', buildServiceDetail({ hiddenServices: [a] }, a).hidden, true);
check('and one that is not, does not', plain.hidden, false);

// A name the Solutions list doesn't carry — a board-only service, or one
// typed straight into a Scope cell. It opens with empty fields rather than
// leaving a click on the name doing nothing at all.
const stranger = buildServiceDetail({}, 'Something Nobody Listed');
check('an unknown name still opens', stranger?.service?.name, 'Something Nobody Listed');
check('and lands in a bucket the picker can show', typeof stranger.bucket, 'string');
check('and carries no reverse lists', stranger.dependents, []);

console.log(failures === 0 ? '\nAll service-detail tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
