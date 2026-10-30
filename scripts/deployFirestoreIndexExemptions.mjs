// Releases the single-field index exemptions in
// firestore.field-exemptions.json to the Firebase project.
//
// Why this exists: Firestore indexes every field of a document, every key
// of a map included, and caps a document at 40,000 index entries. The
// userSettings document holds maps keyed by company (targetMap and the
// like), so it grows an index entry or two per company per map, and the
// Targets List's "Map 1,021 suggested matches" was refused with "too many
// index entries for entity". Nothing queries those fields (settings are
// read whole, by id), so their indexes are pure cost. Exempting them is a
// project setting rather than code, and a setting somebody has to remember
// to make in the console is one that drifts, so it rides the production
// build the way the security rules do (scripts/deployFirestoreRules.mjs,
// whose credential and token code this reuses).
//
//   npm run deploy:exemptions        release now, and FAIL loudly
//   node …/deployFirestoreIndexExemptions.mjs --build   the build hook
//
// --build does nothing unless VERCEL_ENV is 'production', and never fails
// the build, for the same reasons as the rules hook.
//
// Idempotent: each field's current index config is read first, and a field
// that is already exempt is left alone. A change starts a long-running
// operation in Firestore (it can take minutes to drop the old entries);
// this starts it and moves on rather than holding the build.
//
// Needs the service account to hold "Cloud Datastore Index Admin"
// (roles/datastore.indexAdmin) on the project, on top of the rules role.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { accessToken, environment, projectIdFrom, serviceAccountFrom } from './deployFirestoreRules.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------
// Pure helpers, exported for scripts/deployFirestoreIndexExemptions.test.mjs.
// ---------------------------------------------------------------------

// A plain field name, or dotted path of them. Anything else (a key with a
// space or a dash) needs backtick quoting in a field path, and none of
// ours do, so it is refused rather than half-supported.
const SIMPLE_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** The exemptions out of the JSON file, checked: [{ collectionGroup, fieldPath }]. */
export function exemptionsFrom(json) {
  const list = Array.isArray(json?.fieldOverrides) ? json.fieldOverrides : [];
  const out = [];
  const seen = new Set();
  for (const o of list) {
    const collectionGroup = String(o?.collectionGroup || '').trim();
    const fieldPath = String(o?.fieldPath || '').trim();
    if (!SIMPLE_PATH.test(collectionGroup) || collectionGroup.includes('.') || !SIMPLE_PATH.test(fieldPath)) {
      throw new Error(`Bad exemption ${JSON.stringify(o)}: needs a collectionGroup and a plain fieldPath.`);
    }
    const k = `${collectionGroup}/${fieldPath}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ collectionGroup, fieldPath });
  }
  return out;
}

/** The Firestore Admin API name of a field's index config. */
export function fieldName(projectId, { collectionGroup, fieldPath }) {
  return `projects/${projectId}/databases/(default)/collectionGroups/${collectionGroup}/fields/${fieldPath}`;
}

/**
 * Whether a field (as the Admin API returns it) is already exempt: it has
 * its own config, not the database default, and that config has no
 * indexes. A field still being changed reads as exempt too, so a build
 * that lands mid-operation doesn't start a second one.
 */
export function isExempt(field) {
  const cfg = field?.indexConfig;
  if (!cfg) return false;
  if (cfg.reverting) return false;
  if (cfg.usesAncestorConfig) return false;
  return !Array.isArray(cfg.indexes) || cfg.indexes.length === 0;
}

/** A Firestore Admin API failure, in terms of what to do about it. */
export function describeApiError(status, body, projectId) {
  const detail = typeof body === 'string' ? body.trim() : JSON.stringify(body);
  if (status === 403) {
    return `Firestore refused the request (HTTP 403). The service account needs the `
      + `"Cloud Datastore Index Admin" role (roles/datastore.indexAdmin) on project ${projectId}.\n${detail}`;
  }
  return `Firestore Admin API returned HTTP ${status}.\n${detail}`;
}

// ---------------------------------------------------------------------
// The release itself.
// ---------------------------------------------------------------------

async function api(token, path, { method = 'GET', body, projectId, query = '' } = {}) {
  const res = await fetch(`${FIRESTORE_API}/${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(describeApiError(res.status, text, projectId));
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function deployExemptions(log) {
  const projectId = projectIdFrom(JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')));
  if (!projectId) throw new Error('No default project in .firebaserc.');
  const exemptions = exemptionsFrom(JSON.parse(readFileSync(resolve(ROOT, 'firestore.field-exemptions.json'), 'utf8')));
  if (!exemptions.length) { log('no exemptions listed - nothing to do.'); return; }

  const serviceAccount = serviceAccountFrom(environment());
  if (!serviceAccount) {
    throw new Error('No service-account credential. Set FIREBASE_SERVICE_ACCOUNT_KEY to the JSON key '
      + `(raw or base64) of a service account holding roles/datastore.indexAdmin on project ${projectId}.`);
  }
  const token = await accessToken(serviceAccount);

  const changed = [];
  const already = [];
  for (const ex of exemptions) {
    const name = fieldName(projectId, ex);
    const field = await api(token, name, { projectId });
    if (isExempt(field)) { already.push(ex.fieldPath); continue; }
    // An empty index list is "index nothing" for the field and, on a map,
    // for every key under it.
    await api(token, name, {
      method: 'PATCH', projectId, query: '?updateMask=indexConfig',
      body: { indexConfig: { indexes: [] } },
    });
    changed.push(`${ex.collectionGroup}.${ex.fieldPath}`);
  }
  if (changed.length) log(`exempted ${changed.join(', ')} on ${projectId} (Firestore finishes this in the background, usually within minutes).`);
  if (already.length) log(`already exempt: ${already.join(', ')}.`);
}

async function main() {
  const buildHook = process.argv.includes('--build');
  const say = (message) => console.log(`firestore index exemptions: ${message}`);

  if (buildHook && process.env.VERCEL_ENV !== 'production') {
    if (process.env.VERCEL_ENV) say(`skipped - VERCEL_ENV is "${process.env.VERCEL_ENV}", not production.`);
    return;
  }

  try {
    await deployExemptions(say);
  } catch (err) {
    const message = err?.message || String(err);
    if (buildHook) {
      console.warn(`\nfirestore index exemptions: NOT RELEASED - large settings saves may still be refused.\n${message}\n`);
      return;
    }
    console.error(`firestore index exemptions: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
