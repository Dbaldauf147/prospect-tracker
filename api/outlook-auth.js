// Redirects user to Microsoft OAuth login
export default function handler(req, res) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/outlook-callback`;

  const scope = encodeURIComponent('Mail.ReadWrite Calendars.Read offline_access');
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_mode=query`;

  res.redirect(302, url);
}
