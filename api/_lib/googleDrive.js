// Minimal Google Drive client for the daily backup job.
//
// Reuses the same service-account-JWT → OAuth-token pattern as
// sheets-sync.js (GOOGLE_SERVICE_ACCOUNT_KEY), so no extra credentials
// are needed. The service account uploads into a folder that the user
// has shared with the service-account email (BACKUP_DRIVE_FOLDER_ID);
// the drive.file scope lets it create, list, and delete only the files
// it created — i.e. our backups — and nothing else in the user's Drive.

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

// Cache the access token for its lifetime so a run that touches many
// users mints it once, not per call.
let cachedToken = null;
let cachedTokenExp = 0;

async function getDriveToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExp - 60) return cachedToken;

  const credentials = loadServiceAccount();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(credentials.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Drive auth failed: ' + JSON.stringify(data).slice(0, 200));
  cachedToken = data.access_token;
  cachedTokenExp = now + (Number(data.expires_in) || 3600);
  return cachedToken;
}

// Upload a UTF-8 string as a file into the backup folder. Multipart
// upload so metadata (name + parent folder) and content go in one call.
export async function uploadTextToDrive({ folderId, name, content, mimeType = 'application/json' }) {
  const token = await getDriveToken();
  const boundary = `pt-backup-${Date.now()}`;
  const metadata = { name, mimeType, ...(folderId ? { parents: [folderId] } : {}) };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// List backup files in the folder whose name starts with `prefix`,
// newest first. Only returns files the service account created.
export async function listBackupFiles({ folderId, prefix }) {
  const token = await getDriveToken();
  // `name contains` is a substring match; we further guard with a
  // startsWith filter below since the prefix embeds the uid.
  const q = `'${folderId}' in parents and name contains '${prefix}' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.files || []).filter(f => String(f.name || '').startsWith(prefix));
}

// Metadata (name + createdTime) for one file the service account owns.
export async function getDriveFileMeta(id) {
  const token = await getDriveToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,createdTime`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Raw file contents as a UTF-8 string.
export async function downloadDriveFile(id) {
  const token = await getDriveToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

export async function deleteDriveFile(id) {
  const token = await getDriveToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete ${res.status}`);
}
