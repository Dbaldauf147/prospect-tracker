// Starts the Microsoft OAuth flow for the personal-OneDrive connection
// used by the Call Recordings page.
//
// Deliberately separate from /api/outlook-auth even though both go
// through the same app registration: the recordings live in a personal
// Microsoft account, which is usually NOT the work account the Outlook
// calendar/mail integration is signed into. A separate endpoint (and a
// separate token in the browser, see onedrive-callback) lets both
// connections exist side by side instead of overwriting each other.
//
// `prompt=select_account` matters here — without it Microsoft silently
// reuses whichever account the browser is already signed into, which is
// exactly the wrong one.
const SCOPE = 'Files.Read offline_access User.Read';

export default function handler(req, res) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('OUTLOOK_CLIENT_ID is not configured on the server.');
  }
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI || `${origin}/api/onedrive-callback`;

  const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
    + `?client_id=${encodeURIComponent(clientId)}`
    + '&response_type=code'
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&scope=${encodeURIComponent(SCOPE)}`
    + '&response_mode=query'
    + '&prompt=select_account';

  res.redirect(302, url);
}
