// A PNG, written by hand, so a chart can be drawn where there is no canvas.
//
// The Weekly Report email carries pictures of two charts. The tab could
// rasterise them the way it rasterises the funnel (utils/svgToPng, via a
// canvas), but the email that actually lands in an inbox on Monday is
// rebuilt on a serverless runner with no DOM at all - which is exactly why
// the funnel arrives there as a table of figures rather than as the chart.
// A picture that only appears when somebody happened to have the tab open
// is not a picture the report can be said to carry.
//
// So the encoder is here instead: no canvas, no Buffer, no zlib, nothing
// from Node or the browser. The same bytes come out of the cron, out of a
// test send, and out of the tab's own preview.
//
// It writes an indexed-colour PNG, which is the whole reason this is a
// tractable amount of code. A chart is a handful of flat colours, so one
// byte per pixel against a small palette is both smaller and simpler than
// RGBA, and the rows that carry no line at all end up identical to the row
// above them - which the deflate below turns into almost nothing.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// The checksum zlib puts on the end of the stream, over the UNCOMPRESSED
// bytes. A decoder that inflates to something else stops there rather than
// handing a mail client half a chart.
function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ---- Deflate --------------------------------------------------------------
//
// One fixed-Huffman block (RFC 1951 §3.2.6), with the only back-reference
// this needs: a run of the same byte, quoted from one byte earlier. That is
// the shape of the data by construction - the rows are filtered against the
// row above (see encodePng), so a band of chart that does not change turns
// into a long run of zeroes, and a run is what deflate compresses best.
//
// Nothing here searches for a longer match at a further distance. A real
// compressor would; it would also be several hundred lines, and the gain
// over "the row above was the same" on a line chart is small enough that
// the extra code would be the more expensive thing.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

function bitWriter() {
  const out = [];
  let bitBuf = 0;
  let bitCount = 0;
  return {
    // Extra bits and block headers: least significant bit first.
    bits(value, len) {
      for (let i = 0; i < len; i += 1) {
        bitBuf |= ((value >>> i) & 1) << bitCount;
        bitCount += 1;
        if (bitCount === 8) { out.push(bitBuf); bitBuf = 0; bitCount = 0; }
      }
    },
    // Huffman codes: most significant bit first, which is the one rule in
    // this format that runs the other way from everything around it.
    code(value, len) {
      for (let i = len - 1; i >= 0; i -= 1) {
        bitBuf |= ((value >>> i) & 1) << bitCount;
        bitCount += 1;
        if (bitCount === 8) { out.push(bitBuf); bitBuf = 0; bitCount = 0; }
      }
    },
    finish() {
      if (bitCount > 0) out.push(bitBuf);
      return Uint8Array.from(out);
    },
  };
}

// The fixed literal/length alphabet, straight out of the spec's table.
function literalCode(w, v) {
  if (v <= 143) w.code(0x30 + v, 8);
  else if (v <= 255) w.code(0x190 + v - 144, 9);
  else if (v <= 279) w.code(v - 256, 7);
  else w.code(0xC0 + v - 280, 8);
}

export function deflateFixed(data) {
  const w = bitWriter();
  w.bits(1, 1);  // BFINAL: this is the only block
  w.bits(1, 2);  // BTYPE 01: fixed Huffman codes

  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 259) run += 1;
    literalCode(w, data[i]);
    i += 1;
    // The first byte of the run is the literal; everything after it is
    // quoted from one byte back. Below four the match costs more bits than
    // the literals it replaces, so it is left alone.
    let left = run - 1;
    while (left >= 3) {
      let take = Math.min(258, left);
      // Never leave a tail of one or two bytes: a match has to be at least
      // three long, so the remainder would have to go out as literals and
      // the split would cost more than it saved.
      const after = left - take;
      if (after > 0 && after < 3) take -= (3 - after);
      if (take < 3) break;
      let li = 0;
      while (li < LEN_BASE.length - 1 && LEN_BASE[li + 1] <= take) li += 1;
      // A length symbol is drawn from the same alphabet as a literal, so
      // it goes out through the same encoder: symbols 280 and up are eight
      // bits wide, not seven, and writing them as seven is a stream that
      // inflates to "invalid distance too far back" rather than a chart.
      literalCode(w, 257 + li);
      w.bits(take - LEN_BASE[li], LEN_EXTRA[li]);
      w.code(0, 5);                            // distance code 0 = one byte back
      left -= take;
      i += take;
    }
    while (left > 0) { literalCode(w, data[i]); i += 1; left -= 1; }
  }

  w.code(0, 7);  // end of block
  return w.finish();
}

// ---- PNG ------------------------------------------------------------------

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Base64 by hand for the same reason as everything else here: btoa is the
// browser's and Buffer is Node's, and this module belongs to both.
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

/**
 * An indexed-colour PNG from one byte per pixel.
 *
 * `palette` is up to 256 `[r, g, b]` entries and `pixels` indexes into it,
 * row by row from the top left.
 */
export function encodePng({ width, height, palette, pixels }) {
  if (!(width > 0 && height > 0)) throw new Error('png: width and height are required');
  if (pixels.length !== width * height) throw new Error('png: pixel count does not match the size');
  if (!palette.length || palette.length > 256) throw new Error('png: palette must hold 1 to 256 colours');

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // colour type 3: each pixel is a palette index
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // the only filter method there is
  ihdr[12] = 0;  // not interlaced

  const plte = new Uint8Array(palette.length * 3);
  palette.forEach(([r, g, b], i) => {
    plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b;
  });

  // Every row is filtered against the row above it (filter type 2, "Up"),
  // which is what makes a chart cheap to store: the bands where nothing is
  // drawn come out as rows of zeroes, and the run matcher above swallows
  // them whole. Row 0's absent predecessor counts as zeroes, so it filters
  // to itself.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * (width + 1);
    raw[at] = 2;
    for (let x = 0; x < width; x += 1) {
      const here = pixels[y * width + x];
      const above = y === 0 ? 0 : pixels[(y - 1) * width + x];
      raw[at + 1 + x] = (here - above) & 0xFF;
    }
  }

  const deflated = deflateFixed(raw);
  const zlib = new Uint8Array(deflated.length + 6);
  zlib[0] = 0x78;  // CM 8, 32K window
  zlib[1] = 0x01;  // no preset dictionary, and (0x7801 % 31) === 0
  zlib.set(deflated, 2);
  new DataView(zlib.buffer).setUint32(deflated.length + 2, adler32(raw));

  return concat([
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// The form the snapshot stores and an <img> renders directly.
export const pngDataUrl = (image) => `data:image/png;base64,${toBase64(encodePng(image))}`;
