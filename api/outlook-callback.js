// Handles OAuth callback from Microsoft, exchanges code for tokens.
//
// Every dynamic value on this page goes into a <script> block, and until
// now each one was dropped between single quotes and hoped for. Several
// of them are not ours: `error` comes off the query string, so a crafted
// link to
//
//   /api/outlook-callback?error=x',alert(document.domain),'
//
// closed the string, ran as an argument, and executed on the app's own
// origin. That is reflected XSS on the one page in the app that handles
// OAuth tokens, which is the worst place to have it: script running here
// can read the tokens below and post them wherever it likes.
//
// The rest were the same shape of bug waiting for a different input. An
// apostrophe in a Microsoft error description broke the page; a
// non-numeric expires_in was interpolated unquoted and would have run as
// code.
//
// So nothing is interpolated by hand any more. The whole message is one
// object through jsonForScript, and the visible text is escaped for HTML
// separately, because a <script> block and a <p> need different escaping
// and using either one in the other place is its own bug.

// A value as a JavaScript literal that is safe to drop inside a <script>
// block.
//
// JSON.stringify alone is not enough here. The string "</script>" inside
// a JSON string is still "</script>" to the HTML parser, which ends the
// block early and leaves the remainder as markup, so the angle brackets
// have to go as escapes. U+2028 and U+2029 are legal in JSON strings but
// are line terminators in JavaScript source, which is a syntax error
// rather than an injection, and costs nothing to escape alongside.
function jsonForScript(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Text as HTML, for the sentence the user sees while the popup closes.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The popup's only job: hand the result to the page that opened it and
// close. `message` is what the user reads in the half second before it
// does, and it is escaped as HTML rather than reused from the payload,
// which is escaped as JavaScript.
function reply(res, status, origin, payload, message) {
  return res.status(status).send(
    '<html><body><script>'
    + `window.opener?.postMessage(${jsonForScript(payload)},${jsonForScript(origin)});`
    + 'window.close();'
    + `</script><p>${escapeHtml(message)}</p></body></html>`,
  );
}

export default async function handler(req, res) {
  const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
  const { code, error } = req.query;
  if (error || !code) {
    return reply(
      res, 400, origin,
      { type: 'outlook-auth-error', error: String(error || 'no code') },
      'Auth failed. You can close this window.',
    );
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI || `${origin}/api/outlook-callback`;

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
        scope: 'Mail.ReadWrite Calendars.Read offline_access',
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      return reply(
        res, 400, origin,
        { type: 'outlook-auth-error', error: String(tokens.error_description || tokens.error) },
        'Auth failed.',
      );
    }

    // Send tokens back to the opener window via postMessage.
    return reply(
      res, 200, origin,
      {
        type: 'outlook-auth-success',
        accessToken: String(tokens.access_token || ''),
        refreshToken: String(tokens.refresh_token || ''),
        // A number, because the opener does arithmetic on it to work out
        // the expiry stamp. Anything that isn't one falls back to the
        // hour Microsoft issues by default rather than reaching the page
        // as NaN, which would expire the token on arrival.
        expiresIn: Number(tokens.expires_in) > 0 ? Number(tokens.expires_in) : 3600,
      },
      'Connected! You can close this window.',
    );
  } catch (err) {
    return reply(
      res, 500, origin,
      { type: 'outlook-auth-error', error: String(err?.message || err) },
      'Error.',
    );
  }
}
