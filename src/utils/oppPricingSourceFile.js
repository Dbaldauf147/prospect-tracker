// Per-opp source-file storage. When the user clicks "Save to Opp" on
// the Pricing tab, the uploaded SIA workbook's bytes are copied here
// keyed by oppId so the Opps 2 detail popup can offer a download
// later — even after the Pricing tab has been cleared or a different
// workbook loaded.
//
// Local-only: lives in IndexedDB on the device where Save to Opp was
// clicked. Cross-device sync would require Firebase Storage; not
// wired up yet.

import { dbGet, dbPut, dbDelete } from './db';

const STORE = 'pricing-source-files';

// Persist a copy of the workbook's raw bytes under this opp's key.
// `bytes` may be ArrayBuffer, Uint8Array, or Blob — IndexedDB stores
// each natively, but Blob is the friendliest shape for the
// download-as-file flow on the reading side.
export async function saveOppSourceFile(oppId, bytes, fileName) {
  if (oppId == null || !bytes) return;
  const blob = bytes instanceof Blob
    ? bytes
    : new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
  await dbPut(STORE, {
    blob,
    fileName: String(fileName || 'workbook.xlsx'),
    savedAt: new Date().toISOString(),
  }, String(oppId));
}

export async function loadOppSourceFile(oppId) {
  if (oppId == null) return null;
  try {
    const rec = await dbGet(STORE, String(oppId));
    if (!rec || !rec.blob) return null;
    return rec;
  } catch {
    return null;
  }
}

export async function deleteOppSourceFile(oppId) {
  if (oppId == null) return;
  try { await dbDelete(STORE, String(oppId)); }
  catch { /* best-effort */ }
}

// Light metadata to embed in the Pricing-Option snapshot on the opp.
// The actual bytes live in IDB under the per-opp key above; this
// summary just tells the popup whether to render a Download button.
export function sourceFileMeta(fileName, bytes) {
  if (!bytes) return null;
  const size = typeof bytes.size === 'number'
    ? bytes.size
    : (bytes.byteLength ?? 0);
  return {
    fileName: String(fileName || 'workbook.xlsx'),
    sizeBytes: size,
    savedAt: new Date().toISOString(),
  };
}
