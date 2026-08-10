// Recover what's still readable from a damaged xlsx.
//
// An xlsx is a zip, and each sheet is its own entry inside it. Damage that
// lands in one entry — a save that didn't finish, a file truncated in
// transit — leaves every other entry perfectly intact, but the strict
// reader SheetJS uses refuses the whole workbook the moment one entry's
// recorded byte counts don't match its data ("Bad compressed size: …").
// A file whose Site List survived is then unreadable for the sake of a
// sheet nobody asked for.
//
// JSZip decompresses entries one at a time, so it can tell which ones are
// actually broken. This drops those and rebuilds a workbook from the rest,
// which the strict reader then accepts.
//
// This is lossy by definition: dropped sheets are gone, and a workbook
// whose damage sits in the sheet you wanted comes back without your rows.
// Callers get the list of casualties so they can say which.

import JSZip from 'jszip';

// Zip-level failures, as opposed to "this isn't a spreadsheet at all".
// Only these are worth a salvage attempt.
const ZIP_DAMAGE_RE = /Bad (compressed|uncompressed) size|Bad CRC32|Unsupported ZIP|end of central directory|Corrupted zip|invalid (distance|block|stored block|code)|unexpected end of file/i;

export function looksLikeZipDamage(err) {
  return ZIP_DAMAGE_RE.test(String(err?.message || err || ''));
}

/**
 * Rebuild a workbook from the entries that still decompress.
 *
 * Returns { bytes, lost, kept } — `bytes` a Uint8Array of the rebuilt
 * workbook, `lost` the entry names that couldn't be inflated, `kept` how
 * many made it. Throws when the zip is damaged past the point of listing
 * its entries at all, or when nothing survives.
 */
export async function salvageWorkbook(input) {
  const zip = await JSZip.loadAsync(input);
  const out = new JSZip();
  const lost = [];
  let kept = 0;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (!entry || entry.dir) continue;
    try {
      out.file(name, await entry.async('uint8array'));
      kept += 1;
    } catch {
      lost.push(name);
    }
  }
  if (kept === 0) throw new Error('Nothing in that workbook could be read.');
  const bytes = await out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, lost, kept };
}

// Entry paths are internal ("xl/worksheets/sheet3.xml"), which tells the
// user nothing. Map each casualty back to the sheet it holds so the
// message can name tabs. Sheet order in workbook.xml is what ties
// sheetN.xml to a name, and that mapping is exactly what a damaged
// workbook may have lost — so this is best-effort, and falls back to the
// raw path when it can't do better.
export function describeLostEntries(lost, sheetNames = []) {
  return (lost || []).map((path) => {
    const m = /(?:^|\/)sheet(\d+)\.xml$/i.exec(path);
    if (m) {
      const idx = Number(m[1]) - 1;
      const name = sheetNames[idx];
      if (name) return `the "${name}" tab`;
      return `sheet ${m[1]}`;
    }
    if (/sharedStrings/i.test(path)) return 'the shared text table';
    if (/styles/i.test(path)) return 'cell formatting';
    return path.replace(/^xl\//, '');
  });
}
