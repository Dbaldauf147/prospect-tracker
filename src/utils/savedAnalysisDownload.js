// Download a company's saved Master Analysis workbook straight to the
// user's machine, without opening its popup. The same file the popup's
// Download button fetches: the chunks are only read on the click, so a
// table showing hundreds of "saved" ticks costs nothing until one is used.
import { loadIndicativeAnalysis } from './firestoreSync';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Base64 to bytes, or null when there is nothing in it. */
export function analysisBytes(dataBase64) {
  if (!dataBase64) return null;
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Fetch and save the workbook. Throws with a message fit to show when
 * there is no analysis, or it is empty.
 */
export async function downloadSavedAnalysis(prospectId, { fallbackName = 'Master Analysis.xlsx' } = {}) {
  const saved = await loadIndicativeAnalysis(prospectId);
  const bytes = analysisBytes(saved?.dataBase64);
  if (!bytes) throw new Error('The saved analysis is empty: re-save it from Utility Lookup.');
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = saved.fileName || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
