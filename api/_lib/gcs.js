// Google Cloud Storage client for backups. Unlike Drive, a service
// account *can* own objects in a GCS bucket in its own project (storage
// is billed to the project, not the account), so this sidesteps the
// "service accounts have no storage quota" limitation entirely. Reuses
// the same service-account-JWT pattern as sheets-sync.js — no new
// credentials, just the BACKUP_GCS_BUCKET env var.

const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

let cachedToken = null;
let cachedTokenExp = 0;

async function getStorageToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExp - 60) return cachedToken;

  const credentials = loadServiceAccount();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: STORAGE_SCOPE,
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
  if (!data.access_token) throw new Error('GCS auth failed: ' + JSON.stringify(data).slice(0, 200));
  cachedToken = data.access_token;
  cachedTokenExp = now + (Number(data.expires_in) || 3600);
  return cachedToken;
}

// Upload a UTF-8 string as an object. Simple media upload.
export async function uploadJsonToGcs({ bucket, name, content }) {
  const token = await getStorageToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  });
  if (!res.ok) throw new Error(`GCS upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// List objects whose name starts with `prefix`, newest first.
export async function listBackupObjects({ bucket, prefix }) {
  const token = await getStorageToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?prefix=${encodeURIComponent(prefix)}&fields=items(name,timeCreated,size)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS list ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.items || [])
    .map(o => ({ name: o.name, createdTime: o.timeCreated, size: o.size }))
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
}

export async function downloadGcsObject({ bucket, name }) {
  const token = await getStorageToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS download ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

export async function deleteGcsObject({ bucket, name }) {
  const token = await getStorageToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) throw new Error(`GCS delete ${res.status}`);
}
