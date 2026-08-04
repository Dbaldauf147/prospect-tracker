// Reading call recordings from a folder on this computer.
//
// Two mechanisms, because browser support is split:
//
//   File System Access API (Chrome / Edge) — showDirectoryPicker() hands
//     back a FileSystemDirectoryHandle. Handles are structured-cloneable,
//     so we stash one in IndexedDB and the folder is remembered across
//     sessions; the browser asks for permission again on return, which is
//     a single click rather than re-picking the folder.
//
//   <input type="file" webkitdirectory> (Safari / Firefox) — the user
//     picks the folder each time and we get a flat FileList. No
//     persistence is possible; the files live only as long as the page.
//
// Both paths produce the same record shape as /api/onedrive-recordings so
// the page renders either source without branching, except that a local
// record carries a `file` (a File object) instead of a `downloadUrl`.

import { dbGet, dbPut, dbDelete } from './db';

const STORE = 'local-recordings';
const HANDLE_KEY = 'folder-handle';

// Same list the OneDrive endpoint filters on. Deliberately duplicated
// rather than shared — that one runs on the server, this in the browser,
// and they have no common module. Keep them in step.
const MEDIA_EXTENSIONS = new Set([
  'mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'wma', 'flac', 'amr',
  'mp4', 'm4v', 'mov', 'wmv', 'avi', 'mkv', 'webm',
]);

// Walking a folder the user picked is cheap, but a mis-click on a huge
// tree (Documents, or a whole drive) shouldn't hang the page.
const MAX_DEPTH = 3;
const MAX_FILES = 500;

export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

export function isMediaFileName(name) {
  return MEDIA_EXTENSIONS.has(extensionOf(name));
}

// Build the record the page renders. `path` is relative to the picked
// folder and is what the company link is keyed on — stable across
// re-picking the folder and across edits to the file itself, which a
// size/mtime-based key would not be.
function toRecord(file, path) {
  return {
    id: `local:${path}`,
    name: file.name,
    path,
    size: file.size || 0,
    created: null,
    modified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    mimeType: file.type || '',
    extension: extensionOf(file.name),
    // Duration would mean decoding metadata for every file up front; the
    // player shows it once a recording is opened.
    durationSeconds: null,
    isLocal: true,
    file,
  };
}

// ---- persisted folder handle -----------------------------------------------

export async function saveFolderHandle(handle) {
  try {
    await dbPut(STORE, handle, HANDLE_KEY);
    return true;
  } catch {
    // Private-mode / storage-disabled browsers: the folder still works
    // for this session, it just won't be remembered.
    return false;
  }
}

export async function loadFolderHandle() {
  try {
    return (await dbGet(STORE, HANDLE_KEY)) || null;
  } catch {
    return null;
  }
}

export async function forgetFolderHandle() {
  try { await dbDelete(STORE, HANDLE_KEY); } catch { /* nothing to forget */ }
}

// 'granted' | 'prompt' | 'denied'. A handle restored from IndexedDB comes
// back in 'prompt' until the user re-grants, which is why the page shows a
// "Reconnect folder" button rather than silently failing to list.
export async function folderPermission(handle, { request = false } = {}) {
  if (!handle?.queryPermission) return 'denied';
  const opts = { mode: 'read' };
  const current = await handle.queryPermission(opts);
  if (current === 'granted' || !request) return current;
  try {
    return await handle.requestPermission(opts);
  } catch {
    return 'denied';
  }
}

export async function pickFolder() {
  // Must be called from a user gesture or the browser rejects it.
  const handle = await window.showDirectoryPicker({ id: 'call-recordings', mode: 'read' });
  await saveFolderHandle(handle);
  return handle;
}

// ---- listing ---------------------------------------------------------------

// Depth-first walk of the picked folder. Returns { recordings, skipped,
// truncated } — `skipped` counts non-media files so the page can say
// "folder found, nothing playable in it", matching the OneDrive wording.
export async function listFolderRecordings(handle) {
  const recordings = [];
  let skipped = 0;
  let truncated = false;

  async function walk(dir, prefix, depth) {
    if (truncated) return;
    for await (const [name, entry] of dir.entries()) {
      if (recordings.length >= MAX_FILES) { truncated = true; return; }
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') {
        if (depth < MAX_DEPTH) await walk(entry, path, depth + 1);
        continue;
      }
      if (!isMediaFileName(name)) { skipped += 1; continue; }
      try {
        recordings.push(toRecord(await entry.getFile(), path));
      } catch {
        // File vanished or is locked by another app mid-walk — skip it
        // rather than failing the whole listing.
        skipped += 1;
      }
    }
  }

  await walk(handle, '', 1);
  recordings.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return { recordings, skipped, truncated };
}

// The <input webkitdirectory> fallback. `fileList` is what the input's
// change event hands over; webkitRelativePath includes the picked folder
// as its first segment, which we strip so paths match the picker's.
export function recordsFromFileList(fileList) {
  const files = Array.from(fileList || []);
  const recordings = [];
  let skipped = 0;
  for (const file of files) {
    if (recordings.length >= MAX_FILES) break;
    if (!isMediaFileName(file.name)) { skipped += 1; continue; }
    const rel = file.webkitRelativePath || file.name;
    const path = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
    recordings.push(toRecord(file, path));
  }
  recordings.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return { recordings, skipped, truncated: files.length > MAX_FILES };
}
