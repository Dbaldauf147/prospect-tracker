const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const VALID_FRAMEWORKS = new Set(['GRESB', 'CDP', 'UN PRI', 'SBT', 'NZAM']);

const COL_MAP = [
  { col: 0, key: 'company' },
  { col: 1, key: 'cdm' },
  { col: 2, key: 'status' },
  { col: 3, key: 'type' },
  { col: 4, key: 'geography' },
  { col: 5, key: 'publicPrivate' },
  { col: 6, key: 'assetTypes', isArray: true },
  { col: 7, key: 'peAum', isNumber: true },
  { col: 8, key: 'reAum', isNumber: true },
  { col: 9, key: 'numberOfSites', isNumber: true },
  { col: 10, key: 'rank' },
  { col: 11, key: 'tier' },
  { col: 12, key: 'hqRegion' },
  { col: 13, key: 'frameworks', isArray: true, validSet: VALID_FRAMEWORKS },
  { col: 14, key: 'notes' },
];

function parseNumber(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function rowToProspect(row) {
  const p = {};
  for (const m of COL_MAP) {
    const val = row[m.col] != null ? String(row[m.col]).trim() : '';
    if (m.isArray) {
      const arr = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
      p[m.key] = m.validSet ? arr.filter(v => m.validSet.has(v)) : arr.filter(v => v.length > 1 && v !== 'Strategic Account' && v !== 'Largest');
    } else if (m.isNumber) {
      p[m.key] = parseNumber(val);
    } else {
      p[m.key] = val;
    }
  }
  return p;
}

function prospectToRow(p) {
  return COL_MAP.map(m => {
    const val = p[m.key];
    if (m.isArray) return (val || []).join(', ');
    if (m.isNumber) return val != null ? val : '';
    return val || '';
  });
}

// Get OAuth2 access token from service account
async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: SCOPES.join(' '),
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
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

async function sheetsApi(accessToken, method, url, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const spreadsheetId = req.query.spreadsheetId || req.body?.spreadsheetId;
  const sheetName = req.query.sheetName || req.body?.sheetName || 'Accounts';

  if (!spreadsheetId) {
    return res.status(400).json({ error: 'Missing spreadsheetId parameter' });
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ error: 'Server not configured: missing GOOGLE_SERVICE_ACCOUNT_KEY' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const accessToken = await getAccessToken(credentials);
    const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

    if (req.method === 'GET') {
      const range = encodeURIComponent(`${sheetName}!A:O`);
      const data = await sheetsApi(accessToken, 'GET', `${BASE}/values/${range}`);
      const rows = data.values || [];
      if (rows.length < 2) return res.json({ prospects: [] });

      const prospects = [];
      for (let i = 1; i < rows.length; i++) {
        const company = (rows[i][0] || '').trim();
        if (!company) continue;
        prospects.push(rowToProspect(rows[i]));
      }
      return res.json({ prospects, rowCount: rows.length - 1 });
    }

    if (req.method === 'POST') {
      const { prospects, mode } = req.body;
      if (!prospects || !Array.isArray(prospects)) {
        return res.status(400).json({ error: 'Missing prospects array in body' });
      }

      if (mode === 'replace') {
        // Only clear columns A-O (data columns), leave formula columns P+ untouched
        const clearRange = encodeURIComponent(`${sheetName}!A2:O`);
        await sheetsApi(accessToken, 'POST', `${BASE}/values/${clearRange}:clear`, {});

        // Write all prospects to columns A-O only
        const dataRows = prospects.map(p => prospectToRow(p));
        if (dataRows.length > 0) {
          const writeRange = encodeURIComponent(`${sheetName}!A2:O`);
          await sheetsApi(accessToken, 'PUT', `${BASE}/values/${writeRange}?valueInputOption=RAW`, { values: dataRows });
        }

        return res.json({ success: true, written: dataRows.length, mode: 'replace' });
      }

      if (mode === 'merge') {
        // Read existing sheet data
        const range = encodeURIComponent(`${sheetName}!A:O`);
        const existingData = await sheetsApi(accessToken, 'GET', `${BASE}/values/${range}`);
        const existingRows = existingData.values || [];

        const sheetMap = new Map();
        for (let i = 1; i < existingRows.length; i++) {
          const company = (existingRows[i][0] || '').trim().toLowerCase();
          if (company) sheetMap.set(company, i + 1);
        }

        const updates = [];
        const appends = [];
        let updated = 0, added = 0;

        for (const p of prospects) {
          const key = (p.company || '').toLowerCase();
          const row = prospectToRow(p);
          const existingRowNum = sheetMap.get(key);

          if (existingRowNum) {
            updates.push({
              range: `${sheetName}!A${existingRowNum}:O${existingRowNum}`,
              values: [row],
            });
            updated++;
          } else {
            appends.push(row);
            added++;
          }
        }

        if (updates.length > 0) {
          await sheetsApi(accessToken, 'POST', `${BASE}/values:batchUpdate`, {
            valueInputOption: 'RAW',
            data: updates,
          });
        }

        if (appends.length > 0) {
          const appendRange = encodeURIComponent(`${sheetName}!A:O`);
          await sheetsApi(accessToken, 'POST', `${BASE}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: appends });
        }

        return res.json({ success: true, updated, added, mode: 'merge' });
      }

      return res.status(400).json({ error: 'Invalid mode. Use "replace" or "merge".' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Sheets API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
