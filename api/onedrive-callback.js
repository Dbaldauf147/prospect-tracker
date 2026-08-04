// OAuth callback for the personal-OneDrive connection. Exchanges the
// code for tokens and hands them to the opener window, which stores
// them under `onedrive-*` keys — separate from the `outlook-*` keys, so
// connecting a personal OneDrive never signs you out of work Outlook.
const SCOPE = 'Files.Read offline_access User.Read';

// The payload and target origin are interpolated into an inline
// <script>, so both go through JSON.stringify — it produces a valid JS
// literal and escapes the quotes/backslashes that would otherwise break
// out of it. Escaping "<" on top of that closes the one remaining hole,
// a "</script>" inside an error message Microsoft handed back.
function jsLiteral(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function respond(res, status, origin, payload, visibleText) {
  return res.status(status).send(
    '<html><body><script>'
    + `window.opener?.postMessage(${jsLiteral(payload)}, ${jsLiteral(String(origin))});`
    + 'window.close();'
    + `</script><p>${visibleText}</p></body></html>`
  );
}

export default async function handler(req, res) {
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const { code, error, error_description: errorDescription } = req.query;

  if (error || !code) {
    return respond(res, 400, origin, {
      type: 'onedrive-auth-error',
      error: errorDescription || error || 'No authorization code returned',
    }, 'Sign-in failed. You can close this window.');
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI || `${origin}/api/onedrive-callback`;

  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: SCOPE,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) {
      return respond(res, 400, origin, {
        type: 'onedrive-auth-error',
        error: tokens.error_description || tokens.error,
      }, 'Sign-in failed. You can close this window.');
    }
    return respond(res, 200, origin, {
      type: 'onedrive-auth-success',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      expiresIn: tokens.expires_in || 3600,
    }, 'Connected. You can close this window.');
  } catch (err) {
    return respond(res, 500, origin, {
      type: 'onedrive-auth-error',
      error: err?.message || String(err),
    }, 'Sign-in failed. You can close this window.');
  }
}
