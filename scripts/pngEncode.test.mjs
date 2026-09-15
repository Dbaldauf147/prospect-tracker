// The PNG encoder the Weekly Report's coverage charts are drawn with.
//
// It exists because the email that matters is built on a serverless runner
// with no canvas (see the module's own header), which means nothing here
// can be checked by looking at a browser. So the deflate stream it writes
// is inflated back with Node's own zlib - a decoder that had no part in
// writing it - and the pixels are compared with what went in. A stream
// this rejects is a broken-image placeholder in somebody's inbox.
//
// Run: node scripts/pngEncode.test.mjs
import zlib from 'node:zlib';
import { encodePng, deflateFixed, toBase64, pngDataUrl } from '../src/utils/pngEncode.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

// Pull the one IDAT back out of a PNG and inflate it.
function scanlines(png) {
  const buf = Buffer.from(png);
  const at = buf.indexOf('IDAT');
  const len = buf.readUInt32BE(at - 4);
  return zlib.inflateSync(buf.subarray(at + 4, at + 4 + len));
}

// ---- Deflate -------------------------------------------------------------
{
  // The cases that break a hand-rolled fixed-Huffman writer: the 9-bit
  // literals above 143, a run long enough to need a length symbol from the
  // 8-bit end of the alphabet (280+), and a run that would otherwise leave
  // a tail too short to be a match.
  const cases = {
    'empty input': new Uint8Array(0),
    'one byte': Uint8Array.from([7]),
    'literals either side of the 8/9-bit boundary': Uint8Array.from([0, 143, 144, 255, 1]),
    'a run just too short to quote': Uint8Array.from([9, 9, 9]),
    'a run worth quoting': Uint8Array.from(new Array(64).fill(3)),
    'a run past one match, with an awkward tail': Uint8Array.from(new Array(260).fill(200)),
    'a run of exactly one match': Uint8Array.from(new Array(259).fill(1)),
    'a long run, many matches': Uint8Array.from(new Array(5000).fill(0)),
  };
  for (const [name, input] of Object.entries(cases)) {
    let out = null;
    try { out = zlib.inflateRawSync(Buffer.from(deflateFixed(input))); } catch (err) {
      out = `threw: ${err.message}`;
    }
    eq(Array.isArray(out) || Buffer.isBuffer(out) ? [...out] : out, [...input], `deflate: ${name}`);
  }

  // Mixed content, the shape a real scanline has: flat stretches broken by
  // a few changed pixels where a line crosses.
  const mixed = new Uint8Array(4000);
  for (let i = 0; i < mixed.length; i += 1) mixed[i] = i % 700 === 0 ? (i % 256) : 0;
  eq([...zlib.inflateRawSync(Buffer.from(deflateFixed(mixed)))], [...mixed], 'deflate: flat runs broken by pixels');
  ok(deflateFixed(mixed).length < mixed.length / 8, 'deflate: a mostly flat row costs a fraction of its size');
}

// ---- PNG -----------------------------------------------------------------
const PALETTE = [[255, 255, 255], [220, 38, 38], [59, 130, 246]];
{
  const pixels = Uint8Array.from([
    0, 1, 1, 0,
    0, 1, 1, 0,
    2, 2, 0, 1,
  ]);
  const png = encodePng({ width: 4, height: 3, palette: PALETTE, pixels });

  eq([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'png: the signature every decoder checks first');
  const buf = Buffer.from(png);
  ok(buf.indexOf('IHDR') === 12, 'png: IHDR comes first');
  ok(buf.indexOf('PLTE') > 0 && buf.indexOf('PLTE') < buf.indexOf('IDAT'), 'png: the palette precedes the pixels');
  ok(buf.indexOf('IEND') > buf.indexOf('IDAT'), 'png: IEND comes last');
  eq([buf.readUInt32BE(16), buf.readUInt32BE(20)], [4, 3], 'png: the size in the header is the size asked for');
  eq([buf[24], buf[25]], [8, 3], 'png: eight bits a pixel, colour type 3 (indexed)');

  // Every chunk carries a CRC the decoder checks; one wrong byte in the
  // length or the type and the image is discarded outright.
  let at = 8;
  const chunks = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const crcAt = at + 8 + len;
    const want = buf.readUInt32BE(crcAt);
    const got = zlib.crc32
      ? zlib.crc32(buf.subarray(at + 4, crcAt))
      : want; // older Node: the inflate below still proves the stream
    chunks.push([type, got === want]);
    at = crcAt + 4;
  }
  eq(chunks.map(c => c[0]), ['IHDR', 'PLTE', 'IDAT', 'IEND'], 'png: exactly the four chunks, in order');
  ok(chunks.every(c => c[1]), 'png: every chunk checksums');

  // Each row is filtered against the row above it, so an unchanged row is
  // a row of zeroes - which is what makes a chart cheap to store.
  const raw = scanlines(png);
  eq(raw.length, (4 + 1) * 3, 'png: one filter byte plus one byte a pixel, every row');
  eq([...raw.subarray(0, 5)], [2, 0, 1, 1, 0], 'png: the first row filters against nothing and keeps its pixels');
  eq([...raw.subarray(5, 10)], [2, 0, 0, 0, 0], 'png: a row identical to the one above it costs zeroes');

  // Unfilter it back and check we get the picture that went in - the whole
  // round trip, through a decoder this code did not write.
  const back = new Uint8Array(12);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      back[y * 4 + x] = (raw[y * 5 + 1 + x] + (y === 0 ? 0 : back[(y - 1) * 4 + x])) & 0xFF;
    }
  }
  eq([...back], [...pixels], 'png: the pixels survive the round trip');

  // The palette is stored as flat RGB triples in index order.
  const plteAt = buf.indexOf('PLTE');
  eq([...buf.subarray(plteAt + 4, plteAt + 4 + 9)], [255, 255, 255, 220, 38, 38, 59, 130, 246],
    'png: the palette is the colours, in the order the pixels index them');
}

{
  // A size mismatch is a corrupt file rather than a smaller picture, so it
  // fails here instead of in a mail client.
  const bad = (fn) => { try { fn(); return ''; } catch (err) { return err.message; } };
  ok(bad(() => encodePng({ width: 2, height: 2, palette: PALETTE, pixels: new Uint8Array(3) })).includes('pixel count'),
    'png: pixels that do not fill the frame are refused');
  ok(bad(() => encodePng({ width: 0, height: 2, palette: PALETTE, pixels: new Uint8Array(0) })).includes('width'),
    'png: a zero dimension is refused');
  ok(bad(() => encodePng({ width: 1, height: 1, palette: [], pixels: new Uint8Array(1) })).includes('palette'),
    'png: an empty palette is refused');
}

// ---- Base64 --------------------------------------------------------------
{
  // Written by hand because btoa is the browser's and Buffer is Node's, so
  // it is checked against the one this environment happens to have.
  const samples = [[], [0], [0, 255], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [...Array(300).keys()].map(n => n % 256)];
  for (const s of samples) {
    eq(toBase64(Uint8Array.from(s)), Buffer.from(s).toString('base64'), `base64: ${s.length} bytes`);
  }
  const url = pngDataUrl({ width: 1, height: 1, palette: [[0, 0, 0]], pixels: Uint8Array.from([0]) });
  ok(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url), 'base64: the data URL is the form the snapshot stores');
  ok(Buffer.from(url.split(',')[1], 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'base64: and it decodes back to a PNG');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
