// Assertion tests for the chunk splitter behind the large-payload stores.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/chunkedDoc.test.mjs
//
// This is the part that was already wrong once, in two places. Both
// listBackupSync and oppRfpTemplate split their payload across `chunk0`,
// `chunk1`, … fields on ONE document, on the belief that Firestore's 1 MB
// cap applies per field. It applies to the document, so every write that
// needed a second chunk was rejected — and both callers treat the backup
// as best-effort, so the failure was a console warning nobody was reading.
// The lists big enough to hurt to lose were the only ones affected.
//
// So what is tested is the invariant that mistake broke: every piece must
// fit under the cap MEASURED IN BYTES, and the pieces must rejoin into
// exactly the original string. Byte length is the whole point — a chunk of
// 700,000 characters of Japanese or emoji is 2.1 MB on the wire, and
// "safely under 1 MB" by character count is how you get a rejected write
// that looks like a successful save.
import { __test__ } from '../src/utils/chunkedDoc.js';

const { splitByUtf8Bytes, utf8Len } = __test__;

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// Split `s` and assert the two things that matter, together.
function splits(label, s, maxBytes, { allowOversize = false } = {}) {
  const parts = splitByUtf8Bytes(s, maxBytes);
  if (!allowOversize) {
    const over = parts.filter(p => utf8Len(p) > maxBytes);
    check(`${label}: every piece fits the byte budget`, over.length, 0);
  }
  check(`${label}: the pieces rejoin exactly`, parts.join(''), s);
  check(`${label}: no piece is empty`, parts.some(p => p.length === 0), false);
  return parts;
}

// --- ASCII -----------------------------------------------------------------

check('a string under the limit is one piece', splitByUtf8Bytes('hello', 100).length, 1);
check('an empty string is no pieces at all', splitByUtf8Bytes('', 100).length, 0);
const ascii = splits('ascii', 'a'.repeat(10_000), 1000);
check('ascii packs to the byte budget', ascii.length, 10);

// --- multi-byte text -------------------------------------------------------

// Three bytes each: a character-count split would put 1000 of these in a
// "1000-byte" chunk and write 3 KB.
const jp = splits('japanese', 'あ'.repeat(3000), 1000);
check('multi-byte text is split by bytes, not characters', jp[0].length <= 333, true);

// A company name with an accent inside otherwise-ASCII JSON — the shape
// this actually meets in the wild.
splits('mixed', JSON.stringify([{ name: 'Société Générale', note: 'x'.repeat(5000) }]), 700);

// --- surrogate pairs -------------------------------------------------------

// An emoji is two UTF-16 code units. Cutting between them leaves half a
// character on each side, and what comes back from UTF-8 is not what went
// in — so a chunk boundary must never land inside one.
const emoji = '📊'.repeat(500);
const parts = splits('emoji', emoji, 101);   // deliberately not a multiple of 4
check('no piece ends on a lone high surrogate',
  parts.some((p) => {
    const last = p.charCodeAt(p.length - 1);
    return last >= 0xd800 && last <= 0xdbff;
  }), false);
check('no piece starts on a lone low surrogate',
  parts.some((p) => {
    const first = p.charCodeAt(0);
    return first >= 0xdc00 && first <= 0xdfff;
  }), false);
check('the emoji all survive', parts.join('').length, emoji.length);

// A budget too small to hold even one character. Nothing this module does
// gets near it, but the first draft of the splitter hung the process here:
// it emitted an empty piece and never advanced. Going over the budget is
// the right answer; spinning forever is not.
const tiny = splits('tiny budget', '📊ab', 2, { allowOversize: true });
check('an over-budget piece is a whole character, not half of one', tiny[0], '📊');
check('and the rest still splits normally', tiny.slice(1).join(''), 'ab');

// --- the real budget -------------------------------------------------------

// A 3 MB payload — the size at which the old inline-field layout silently
// stopped working.
const big = 'x'.repeat(3 * 1024 * 1024);
const realParts = splits('3 MB payload', big, __test__.CHUNK_BYTES);
check('it needs more than one document', realParts.length > 1, true);
check('and every one is under Firestore\'s per-document cap',
  realParts.every(p => utf8Len(p) < 1024 * 1024), true);

// --- how the chunks are committed ------------------------------------------

// The second cap, and the one the splitter alone does not satisfy: chunks
// that each fit a document can still be too much for ONE commit. Firestore
// refuses a write request over 11 MiB outright, so a 16 MB list — CDP,
// GRESB — had all of its chunks rejected together while every individual
// piece was the right size.
const { planBatches, BATCH_LIMIT, BATCH_MAX_BYTES } = __test__;

// Sum of `sizes` over one [from, to) range.
function batchBytes(sizes, [from, to]) {
  let n = 0;
  for (let i = from; i < to; i++) n += sizes[i];
  return n;
}

// Plan `sizes` and assert what every plan has to be true of.
function plans(label, sizes) {
  const batches = planBatches(sizes);
  check(`${label}: every chunk is written exactly once, in order`,
    batches.flatMap(([from, to]) => Array.from({ length: to - from }, (_, k) => from + k)).join(','),
    sizes.map((_, i) => i).join(','));
  // A batch of one is allowed over budget — it cannot be divided further.
  const overBudget = batches.filter(b => b[1] - b[0] > 1 && batchBytes(sizes, b) > BATCH_MAX_BYTES);
  check(`${label}: no multi-chunk commit exceeds the request cap`, overBudget.length, 0);
  check(`${label}: no commit exceeds the write count cap`,
    batches.some(([from, to]) => to - from > BATCH_LIMIT), false);
  return batches;
}

check('nothing to write is no commits', planBatches([]).length, 0);
check('one chunk is one commit', planBatches([700 * 1024]).length, 1);

// The shape that was losing data: a 16 MB list at 700 KB a chunk.
const listSizes = new Array(24).fill(700 * 1024);
const listBatches = plans('16 MB list', listSizes);
check('a 16 MB list no longer goes up in a single commit', listBatches.length > 1, true);

// Packing stays tight — the fix must not turn one commit into one per chunk.
check('chunks are packed, not sent one at a time', listBatches.length, 3);

// Uneven pieces (the tail chunk is always short) still pack legally.
plans('uneven pieces', [700 * 1024, 700 * 1024, 12, 700 * 1024, 3 * 1024 * 1024]);

// Small chunks hit the write-count cap long before the byte cap.
const many = new Array(BATCH_LIMIT * 2 + 5).fill(64);
const manyBatches = plans('many tiny chunks', many);
check('the count cap is what bounds tiny chunks', manyBatches.length, 3);

// A single chunk over the byte budget cannot be split from here, so it is
// sent alone rather than dropped or bundled.
const lone = plans('one oversized chunk', [64, 9 * 1024 * 1024, 64]);
check('an oversized chunk travels alone', lone.length, 3);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
