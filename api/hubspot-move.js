// Read-only comparison of the current HubSpot portal with the one the app
// is moving to. See api/_lib/hubspotMove.js for what is compared and why.
//
//   GET ?action=overview           both portals' identity, counts, and the
//                                  custom-property comparison
//   GET ?action=compare-contacts   one page of source contacts, classified
//   GET ?action=compare-companies  one page of source companies, classified
//
// The compare actions page (`after` in, `next` out) so the browser drives a
// long comparison one short request at a time instead of one request that
// outlives the function.
//
// Env:
//   HUBSPOT_ACCESS_TOKEN         the portal the app uses today (source)
//   HUBSPOT_TARGET_ACCESS_TOKEN  the portal being moved to (target); only
//                                read scopes are needed for this
//
// Nothing here writes to either portal. Admin only: the comparison reads
// every record in the source portal.

import { withAuth, isAdminEmail } from './_lib/http.js';
import {
  DAY_MS, hubspotClient, accountDetails, findOwnerByEmail, inventoryCounts,
  customProperties, compareCustomProperties, CONTACT_FIELDS, COMPANY_FIELDS,
  classifyContact, classifyCompany, sourcePage, companyNames,
  targetContactsByEmail, targetCompanyCandidates,
} from './_lib/hubspotMove.js';

const DEFAULT_RECENT_DAYS = 5;

function recentSinceFrom(req, now = Date.now()) {
  const days = Number(req.query.recentDays);
  const d = Number.isFinite(days) && days >= 0 && days <= 365 ? days : DEFAULT_RECENT_DAYS;
  return d > 0 ? now - d * DAY_MS : 0;
}

// The custom property names to compare record by record: the source's
// custom properties that also exist in the target. One the target lacks is
// already reported in the property table, and would otherwise flag every
// single record that carries a value for it.
async function sharedCustomNames(source, target, objectType) {
  const [s, t] = await Promise.all([customProperties(source, objectType), customProperties(target, objectType)]);
  const have = new Set(t.map(p => p.name));
  return s.map(p => p.name).filter(n => have.has(n));
}

async function handler(req, res, auth, { fetchImpl, sleep, now } = {}) {
  if (!isAdminEmail(auth?.email)) return res.status(403).json({ error: 'Only the admin account can run the HubSpot move comparison.' });

  const sourceToken = process.env.HUBSPOT_ACCESS_TOKEN;
  const targetToken = process.env.HUBSPOT_TARGET_ACCESS_TOKEN;
  if (!sourceToken) return res.status(500).json({ error: 'HUBSPOT_ACCESS_TOKEN is not configured.' });

  const source = hubspotClient(sourceToken, { fetchImpl, sleep });
  const target = targetToken ? hubspotClient(targetToken, { fetchImpl, sleep }) : null;
  const action = req.query.action;
  const ownerEmail = String(req.query.ownerEmail || '').trim();
  const recentSince = recentSinceFrom(req, now ? now() : Date.now());

  if (action === 'overview') {
    const out = { recentSince, source: {}, target: { configured: !!target }, properties: null };
    try {
      out.source.account = await accountDetails(source);
    } catch (err) {
      out.source.error = String(err?.message || err);
    }
    out.source.counts = await inventoryCounts(source, { since: recentSince });

    if (target) {
      try {
        out.target.account = await accountDetails(target);
      } catch (err) {
        out.target.error = String(err?.message || err);
      }
      // Same token on both sides would make every comparison come back
      // perfect, which is the most misleading answer this could give.
      if (out.source.account?.portalId && out.source.account.portalId === out.target.account?.portalId) {
        out.target.samePortal = true;
      }
      let owner = null;
      if (ownerEmail) {
        try {
          owner = await findOwnerByEmail(target, ownerEmail);
          out.target.owner = owner || { notFound: true, email: ownerEmail };
        } catch (err) {
          out.target.owner = { error: String(err?.message || err), email: ownerEmail };
        }
      }
      out.target.counts = await inventoryCounts(target, { ownerId: owner?.id || '' });

      out.properties = {};
      for (const type of ['contacts', 'companies']) {
        try {
          const [s, t] = await Promise.all([customProperties(source, type), customProperties(target, type)]);
          out.properties[type] = compareCustomProperties(s, t);
        } catch (err) {
          out.properties[type] = { error: String(err?.message || err) };
        }
      }
    }
    return res.json(out);
  }

  if (action === 'compare-contacts' || action === 'compare-companies') {
    if (!target) return res.status(400).json({ error: 'HUBSPOT_TARGET_ACCESS_TOKEN is not configured, so there is nothing to compare against yet.' });
    const owner = ownerEmail ? await findOwnerByEmail(target, ownerEmail) : null;
    const ownerId = owner?.id || '';
    const after = req.query.after || '';

    if (action === 'compare-contacts') {
      const custom = await sharedCustomNames(source, target, 'contacts');
      const fields = [...new Set([...CONTACT_FIELDS, ...custom])];
      const props = [...new Set(['email', 'createdate', 'associatedcompanyid', ...fields])];
      const page = await sourcePage(source, 'contacts', props, after);
      const matches = await targetContactsByEmail(target, page.results.map(c => c.properties?.email), [...props, 'hubspot_owner_id']);
      const [srcNames, tgtNames] = await Promise.all([
        companyNames(source, page.results.map(c => c.properties?.associatedcompanyid)),
        companyNames(target, [...matches.values()].map(c => c.properties?.associatedcompanyid)),
      ]);
      const rows = page.results.map(c => {
        const match = matches.get(String(c.properties?.email || '').trim().toLowerCase()) || null;
        return classifyContact(c, match, {
          ownerId, fields, recentSince,
          sourceCompanyName: srcNames.get(String(c.properties?.associatedcompanyid || '')) || '',
          targetCompanyName: match ? (tgtNames.get(String(match.properties?.associatedcompanyid || '')) || '') : '',
        });
      });
      return res.json({ rows, next: page.next, ownerFound: !!owner });
    }

    const custom = await sharedCustomNames(source, target, 'companies');
    const fields = [...new Set([...COMPANY_FIELDS, ...custom])];
    const props = [...new Set(['createdate', ...fields])];
    const page = await sourcePage(source, 'companies', props, after);
    const candidates = await targetCompanyCandidates(target, page.results, [...props, 'hubspot_owner_id']);
    const rows = page.results.map(c => classifyCompany(c, candidates, { ownerId, fields, recentSince }));
    return res.json({ rows, next: page.next, ownerFound: !!owner });
  }

  return res.status(400).json({ error: 'Missing or invalid action parameter.' });
}

export default withAuth(handler);

// Unwrapped, for scripts/hubspotMove.test.mjs. Vercel only routes the
// default export.
export { handler as handlerForTests };
