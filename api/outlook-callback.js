// Handles OAuth callback from Microsoft, exchanges code for tokens
export default async function handler(req, res) {
  const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
  const { code, error } = req.query;
  if (error || !code) {
    return res.status(400).send(`<html><body><script>window.opener?.postMessage({type:'outlook-auth-error',error:'${error || 'no code'}'},'${origin}');window.close();</script><p>Auth failed. You can close this window.</p></body></html>`);
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
      return res.status(400).send(`<html><body><script>window.opener?.postMessage({type:'outlook-auth-error',error:'${tokens.error_description || tokens.error}'},'${origin}');window.close();</script><p>Auth failed.</p></body></html>`);
    }

    // Send tokens back to the opener window via postMessage
    return res.status(200).send(`
      <html><body><script>
        window.opener?.postMessage({
          type: 'outlook-auth-success',
          accessToken: '${tokens.access_token}',
          refreshToken: '${tokens.refresh_token || ''}',
          expiresIn: ${tokens.expires_in || 3600}
        }, '${origin}');
        window.close();
      </script><p>Connected! You can close this window.</p></body></html>
    `);
  } catch (err) {
    return res.status(500).send(`<html><body><script>window.opener?.postMessage({type:'outlook-auth-error',error:'${err.message}'},'${origin}');window.close();</script><p>Error.</p></body></html>`);
  }
}
