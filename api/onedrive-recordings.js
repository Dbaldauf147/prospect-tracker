// Lists call recordings from a folder in the user's personal OneDrive.
//
// The caller's Firebase ID token goes in Authorization (verified by
// withAuth); the user's own Microsoft Graph token goes in X-MS-Token,
// exactly like /api/outlook-calendar. The folder is a path the user
// configures on the Call Recordings page, e.g. "/Recordings".
import { withAuth } from './_lib/http.js';

// Extensions we treat as a call recording. Graph reports a `file.mimeType`
// too, but personal OneDrive is inconsistent about it for the formats
// dialers and meeting apps produce, so the extension is the reliable test
// and the mime type is a fallback.
const MEDIA_EXTENSIONS = new Set([
  'mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'wma', 'flac', 'amr',
  'mp4', 'm4v', 'mov', 'wmv', 'avi', 'mkv', 'webm',
]);

function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

function isMedia(item) {
  if (!item?.file) return false; // folders and packages
  if (MEDIA_EXTENSIONS.has(extensionOf(item.name))) return true;
  const mime = String(item.file.mimeType || '').toLowerCase();
  return mime.startsWith('audio/') || mime.startsWith('video/');
}

// "/Recordings/Calls" -> "/me/drive/root:/Recordings/Calls:/children".
// An empty path means the drive root, which has its own URL shape.
function childrenUrl(folderPath) {
  const clean = String(folderPath || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const select = '$select=id,name,size,createdDateTime,lastModifiedDateTime,file,audio,video,webUrl,parentReference'
    + '&$expand=thumbnails'
    + '&$top=200'
    + '&$orderby=lastModifiedDateTime desc';
  if (!clean) {
    return `https://graph.microsoft.com/v1.0/me/drive/root/children?${select}`;
  }
  // Each segment is encoded separately so the path separators survive.
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${encoded}:/children?${select}`;
}

// Duration comes back in milliseconds on the audio/video facets when
// OneDrive has managed to index the file; it is frequently absent.
function durationSeconds(item) {
  const ms = item?.audio?.duration ?? item?.video?.duration;
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const accessToken = req.headers['x-ms-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-MS-Token (OneDrive access token)' });
  }
  const folder = String(req.query?.folder || '');

  try {
    const resp = await fetch(childrenUrl(folder), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.status === 401) {
      return res.status(401).json({ error: 'OneDrive token expired or invalid — reconnect OneDrive.' });
    }
    if (resp.status === 404) {
      return res.status(404).json({
        error: `No folder "${folder || '/'}" in this OneDrive. Check the folder path — it is case-sensitive and relative to the drive root.`,
      });
    }
    if (!resp.ok) {
      const body = await resp.text();
      return res.status(resp.status).json({ error: `Microsoft Graph error: ${body}` });
    }
    const data = await resp.json();
    const all = Array.isArray(data.value) ? data.value : [];
    const recordings = all.filter(isMedia).map((item) => ({
      id: item.id,
      name: item.name,
      size: Number(item.size) || 0,
      created: item.createdDateTime || null,
      modified: item.lastModifiedDateTime || null,
      mimeType: item.file?.mimeType || '',
      extension: extensionOf(item.name),
      durationSeconds: durationSeconds(item),
      webUrl: item.webUrl || '',
      // Pre-authenticated, short-lived (~1 hour) direct link. It is what
      // the inline player streams from and what the transcription job is
      // handed, so neither path proxies the media through this function.
      downloadUrl: item['@microsoft.graph.downloadUrl'] || '',
      thumbnailUrl: item.thumbnails?.[0]?.medium?.url || '',
    }));
    return res.status(200).json({
      folder: folder || '/',
      recordings,
      // How many non-media files were skipped, so the page can say
      // "folder found, just nothing playable in it".
      skipped: all.length - recordings.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

export default withAuth(handler);
