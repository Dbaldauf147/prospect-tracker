// Redirects user to Microsoft OAuth login.
//
// The redirect only makes sense when this deployment actually has an
// Azure app registration behind it. Without OUTLOOK_CLIENT_ID the URL
// below used to be built anyway, and a template literal turns a missing
// variable into the four letters "undefined" - so Microsoft was asked to
// find an app by that name and answered:
//
//   AADSTS700016: Application with identifier 'undefined' was not found
//   in the directory ...
//
// which reads like the tenant refusing us, and sends the user to their
// IT department over a variable that was never set. The popup reports
// the real reason instead, the same way the callback reports a failed
// token exchange, and the page that opened it shows the message.

// A message back to the opener, then close. Both values go through
// JSON.stringify rather than into quotes directly: an apostrophe in a
// message would otherwise end the string and leave a blank popup with a
// syntax error behind it.
function reportError(res, origin, message, status = 500) {
  const payload = JSON.stringify({ type: 'outlook-auth-error', error: message });
  return res.status(status).send(
    `<html><body><script>window.opener?.postMessage(${payload},${JSON.stringify(origin)});window.close();</script>`
    + `<p>${message}</p></body></html>`,
  );
}

// Which variables this deployment is missing, by NAME, never by value.
// "Not configured" has several causes that look identical from the
// browser: saved against Preview but not Production, a near miss on the
// name, or the wrong project entirely, so the environment that answered
// is worth saying too.
function missingConfig() {
  const missing = ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET']
    .filter(name => !String(process.env[name] || '').trim());
  return missing;
}

export default function handler(req, res) {
  const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
  const clientId = String(process.env.OUTLOOK_CLIENT_ID || '').trim();
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI || `${origin}/api/outlook-callback`;

  // The secret is checked here as well as in the callback. It is not
  // needed until the code is exchanged, but finding out then means
  // signing in, consenting, and only then failing, so say it up front.
  const missing = missingConfig();
  if (missing.length > 0) {
    const environment = String(process.env.VERCEL_ENV || '').trim() || 'this deployment';
    return reportError(
      res,
      origin,
      `Outlook is not connected to an Azure app registration: ${missing.join(' and ')} `
      + `${missing.length > 1 ? 'are' : 'is'} not set in ${environment}. `
      + 'Register an app in Azure with the Mail.ReadWrite and Calendars.Read permissions, '
      + 'then set those variables and redeploy.',
      501,
    );
  }

  const scope = encodeURIComponent('Mail.ReadWrite Calendars.Read offline_access');
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_mode=query`;

  res.redirect(302, url);
}
