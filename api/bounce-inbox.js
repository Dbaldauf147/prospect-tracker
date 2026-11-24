// GET /api/bounce-inbox?days=30
//
// The bounce notices forwarded to the app's mailbox (api/_lib/bounceInbox.js),
// for the browser to flag as bad emails (src/utils/bounceScan.js). Also says
// where to forward them, so the page can show the address.
//   -> { bounces: [{ address, at, subject, reason, messageId }], read,
//        skipped, unread, labels, missing, forwardTo, label }
import { withAuth } from './_lib/http.js';
import { fetchForwardedBounces, bounceForwardAddress, bounceLabels } from './_lib/bounceInbox.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const forwardTo = bounceForwardAddress();
  const label = bounceLabels().join(', ');
  const days = Number(req.query?.days);
  try {
    const out = await fetchForwardedBounces({ days: Number.isFinite(days) && days > 0 ? days : 30 });
    return res.status(200).json({ ...out, forwardTo, label });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Unknown error', forwardTo, label });
  }
}

export default withAuth(handler);
