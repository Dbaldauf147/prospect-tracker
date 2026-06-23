// User-scoped localStorage wrapper. Same idea as `setDbUserId` in db.js
// but for `localStorage`. Every key the caller passes in gets prefixed
// with the current user's uid so two accounts sharing a browser don't
// inherit each other's salesperson data (deals roster, commissions
// paste, cached HubSpot emails, etc.).
//
// One-time migration: the first time a signed-in user reads a key that
// has no prefixed entry yet but DOES have legacy un-prefixed data, the
// legacy value is claimed for the current user and the un-prefixed key
// is removed. That covers the existing admin's data without manual
// intervention; subsequent signins on the same browser see a clean
// slate because the legacy keys are gone.

let currentUserId = null;

export function setUserLsUserId(uid) {
  currentUserId = uid || null;
}

function prefixed(key) {
  return currentUserId ? `u:${currentUserId}:${key}` : `u:_anon:${key}`;
}

export function userLsGet(key) {
  try {
    const pk = prefixed(key);
    const v = localStorage.getItem(pk);
    if (v !== null) return v;
    if (currentUserId) {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) {
        try { localStorage.setItem(pk, legacy); } catch {}
        try { localStorage.removeItem(key); } catch {}
        return legacy;
      }
    }
    return null;
  } catch { return null; }
}

export function userLsSet(key, value) {
  try {
    localStorage.setItem(prefixed(key), value);
    // Drop the legacy un-prefixed key on write so a future signin
    // doesn't inherit stale data left over from before scoping.
    if (currentUserId) {
      try { localStorage.removeItem(key); } catch {}
    }
  } catch (err) {
    // Surfaces quota errors etc. so callers can decide whether to warn.
    throw err;
  }
}

export function userLsRemove(key) {
  try { localStorage.removeItem(prefixed(key)); } catch {}
}

export function userLsHas(key) {
  try {
    if (localStorage.getItem(prefixed(key)) !== null) return true;
    if (currentUserId && localStorage.getItem(key) !== null) return true;
    return false;
  } catch { return false; }
}
