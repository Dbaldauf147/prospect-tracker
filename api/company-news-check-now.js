// Authenticated "check this company now" route - backs the "Check for deals
// now" button on a company's Portfolio > Acquisitions & Dispositions page.
// Runs the weekly digest's research for that one company over a recent
// window and logs what it finds onto the record, without sending anything.
//
// Body: { prospectId, lookbackDays? }  (lookbackDays 1-60, default 30)
//
// The record is looked up in the caller's own collection (auth.uid /
// auth.email), so nobody can log onto a record that isn't theirs.

import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import { adminDb } from './_lib/firebaseAdmin.js';
import { checkCompanyNow, ResearchHaltedError } from './_lib/companyNews.js';
import { researchBudgetMs } from './_lib/researchBudget.js';

async function handler(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, auth.uid, 'company-news-check-now', 20, 30 * 60 * 1000))) return;

  const { prospectId, lookbackDays } = req.body || {};
  if (!prospectId || typeof prospectId !== 'string') return res.status(400).json({ error: 'prospectId is required' });
  const days = Number(lookbackDays);
  const window = Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 60) : 30;

  try {
    const out = await checkCompanyNow(adminDb(), auth.uid, auth.email, prospectId, {
      lookbackDays: window,
      budgetMs: researchBudgetMs(),
    });
    if (out.notFound) return res.status(404).json({ error: 'Company not found' });
    return res.json({ success: true, lookbackDays: window, ...out });
  } catch (err) {
    if (err instanceof ResearchHaltedError) return res.status(503).json({ error: err.reason || String(err.message) });
    console.error('company-news-check-now error:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

export default withAuth(handler);
