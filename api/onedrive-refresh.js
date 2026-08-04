// Exchanges the stored OneDrive refresh token for a fresh access token.
// Graph access tokens last about an hour; without this the page would
// pop the Microsoft sign-in window every time you came back to it.
import { withAuth } from './_lib/http.js';

const SCOPE = 'Files.Read offline_access User.Read';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const refreshToken = req.headers['x-ms-refresh-token'];
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing X-MS-Refresh-Token' });
  }
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Microsoft app credentials are not configured on the server.' });
  }
  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPE,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      // The refresh token itself is dead (revoked, expired, password
      // change) — 401 tells the page to send the user back through the
      // full sign-in rather than retrying.
      return res.status(401).json({ error: tokens.error_description || tokens.error });
    }
    return res.status(200).json({
      accessToken: tokens.access_token,
      // Microsoft may hand back a rotated refresh token; when it doesn't,
      // the existing one stays valid.
      refreshToken: tokens.refresh_token || '',
      expiresIn: tokens.expires_in || 3600,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

export default withAuth(handler);
