// Which HubSpot portal the token belongs to, and whose records the app may
// treat as its own there.
//
// The app was built against a personal portal, where every record belonged
// to the one person using it: it lists every contact, every logged email,
// and will delete or merge any contact it is handed. In a shared corporate
// portal each of those reaches other people's records. Two settings make
// the server safe to point at one:
//
//   HUBSPOT_PORTAL_ID    the portal the token is expected to belong to. If
//                        the token turns out to belong to another portal,
//                        every HubSpot route refuses instead of acting on
//                        the wrong one. This is what catches a token swapped
//                        without the rest of the settings.
//   HUBSPOT_OWNER_EMAIL  the HubSpot user whose records are "yours". When
//                        set, reads are limited to records with that
//                        hubspot_owner_id, new records are created with it,
//                        edits to records owned by anyone else are refused,
//                        and delete / merge are switched off.
//
// With neither set, nothing changes and no extra request is made: that is
// the personal-portal behaviour the app has always had.
//
// Fails closed: when a setting is present but can't be confirmed (HubSpot
// unreachable, missing scope, owner not found), the caller gets an error
// rather than an unscoped answer.

const BASE = 'https://api.hubapi.com';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export class HubSpotScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HubSpotScopeError';
    this.status = 409;
  }
}

async function getJson(fetchImpl, token, path) {
  const res = await fetchImpl(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HubSpot ${res.status}: ${String(text).slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Resolve the scope for this token. Returns
 *   { scoped, portalId, ownerId, ownerUserId, ownerEmail }
 * where `scoped` means "limit everything to ownerId".
 * Throws HubSpotScopeError when a configured check fails.
 */
export async function hubspotScope(token, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const pinned = String(env.HUBSPOT_PORTAL_ID || '').trim();
  const ownerEmail = String(env.HUBSPOT_OWNER_EMAIL || '').trim().toLowerCase();
  if (!pinned && !ownerEmail) return { scoped: false, portalId: '', ownerId: '', ownerUserId: '', ownerEmail: '' };

  const key = `${token}|${pinned}|${ownerEmail}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.scope;

  let portalId = '';
  if (pinned) {
    let details;
    try {
      details = await getJson(fetchImpl, token, '/account-info/v3/details');
    } catch (err) {
      throw new HubSpotScopeError(
        `Couldn't confirm which HubSpot portal the token belongs to (${err.message}). `
        + 'Nothing was read or written. HUBSPOT_PORTAL_ID is set, so HubSpot calls stay off until this check passes.',
      );
    }
    portalId = String(details.portalId ?? '');
    if (portalId !== pinned) {
      throw new HubSpotScopeError(
        `The HubSpot token belongs to portal ${portalId || '(unknown)'}, but HUBSPOT_PORTAL_ID is ${pinned}. `
        + 'Nothing was read or written. If the token was changed on purpose, update HUBSPOT_PORTAL_ID '
        + '(and HUBSPOT_OWNER_EMAIL for a shared portal) to match.',
      );
    }
  }

  let ownerId = '';
  let ownerUserId = '';
  if (ownerEmail) {
    let owners;
    try {
      owners = await getJson(fetchImpl, token, `/crm/v3/owners?email=${encodeURIComponent(ownerEmail)}&limit=100`);
    } catch (err) {
      throw new HubSpotScopeError(
        `Couldn't look up the HubSpot user ${ownerEmail} (${err.message}). Nothing was read or written. `
        + 'The token needs the crm.objects.owners.read scope.',
      );
    }
    const owner = (owners.results || []).find(o => String(o.email || '').toLowerCase() === ownerEmail);
    if (!owner) {
      throw new HubSpotScopeError(
        `HUBSPOT_OWNER_EMAIL is ${ownerEmail}, but this HubSpot portal has no user with that email. Nothing was read or written.`,
      );
    }
    ownerId = String(owner.id);
    ownerUserId = owner.userId != null ? String(owner.userId) : '';
  }

  const scope = { scoped: !!ownerId, portalId, ownerId, ownerUserId, ownerEmail };
  cache.set(key, { at: now(), scope });
  return scope;
}

// The search filter that limits a query to the owner's records, or none.
export function ownerFilters(scope) {
  return scope?.scoped && scope.ownerId
    ? [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(scope.ownerId) }]
    : [];
}

// For the tests: forget cached lookups.
export function clearHubspotScopeCache() {
  cache.clear();
}
