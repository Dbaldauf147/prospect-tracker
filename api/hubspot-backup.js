// Full backup of the HubSpot portal the app uses today (HUBSPOT_ACCESS_TOKEN)
// to the private backup bucket, taken before the move to the new portal.
// See api/_lib/hubspotBackup.js for what is captured and how it is cut up.
//
//   POST ?action=start    read the portal's set-up, save schema.json, and
//                         answer the run id and the object types to back up
//   POST ?action=chunk    { portalId, runId, type, after, part }: read one
//                         time-boxed chunk of one type, save it as a part
//                         file, answer how many records and the next cursor
//   POST ?action=finish   { portalId, runId, objectTypes, reported, typeErrors }:
//                         check the part files and HubSpot's own counts,
//                         save manifest.json, answer the verdict
//   GET  ?action=runs     the backups in the bucket, newest first
//
// The browser drives start -> chunk... -> finish one short request at a
// time, the same way the move comparison pages, so a big portal never has
// to fit inside one function call.
//
// Nothing here writes to HubSpot. Admin only: it reads every record in the
// portal, other people's included if the portal is shared.

import { withAuth, isAdminEmail } from './_lib/http.js';
import { hubspotClient, accountDetails, countObjects } from './_lib/hubspotMove.js';
import {
  BACKUP_ROOT, collectSchema, readChunk, newRunId, runPrefix, partName, tallyParts, verifyRun,
} from './_lib/hubspotBackup.js';
import { uploadJsonToGcs, listBackupObjects, downloadGcsObject } from './_lib/gcs.js';

// Under the function's own limit with room to save the part file; the
// browser just asks for the next chunk.
const CHUNK_BUDGET_MS = 40000;

async function handler(req, res, auth, deps = {}) {
  if (!isAdminEmail(auth?.email)) return res.status(403).json({ error: 'Only the admin account can back up the HubSpot portal.' });
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_ACCESS_TOKEN is not configured.' });
  const bucket = process.env.BACKUP_GCS_BUCKET;
  if (!bucket) return res.status(500).json({ error: 'BACKUP_GCS_BUCKET is not configured.' });

  const gcs = deps.gcs || { uploadJsonToGcs, listBackupObjects, downloadGcsObject };
  const client = hubspotClient(token, { fetchImpl: deps.fetchImpl, sleep: deps.sleep });
  const action = req.query.action;
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // The run belongs to one portal. If the token was swapped part-way, the
  // rest of the run would quietly back up a different portal into it.
  const checkPortal = async () => {
    const { portalId } = await accountDetails(client);
    if (String(body.portalId || '') !== portalId) {
      const err = new Error(`This backup run is for portal ${body.portalId}, but the HubSpot token now belongs to portal ${portalId}. Start a new backup.`);
      err.status = 409;
      throw err;
    }
    return runPrefix(portalId, String(body.runId || ''));
  };

  if (action === 'start' && req.method === 'POST') {
    const { portalId } = await accountDetails(client);
    const runId = newRunId(deps.now ? new Date(deps.now()) : new Date());
    const prefix = runPrefix(portalId, runId);
    const { schema, objectTypes } = await collectSchema(client);
    await gcs.uploadJsonToGcs({
      bucket,
      name: `${prefix}schema.json`,
      content: JSON.stringify({ portalId, runId, startedAt: new Date().toISOString(), startedBy: auth.email, schema }),
    });
    return res.json({ portalId, runId, objectTypes, schemaErrors: schema.errors });
  }

  if (action === 'chunk' && req.method === 'POST') {
    const prefix = await checkPortal();
    const type = String(body.type || '');
    const part = Number(body.part) || 1;
    const name = partName(prefix, type, part);
    const chunk = await readChunk(client, type, { after: String(body.after || ''), budgetMs: CHUNK_BUDGET_MS, now: deps.now });
    await gcs.uploadJsonToGcs({
      bucket,
      name,
      content: JSON.stringify({ type, part, after: body.after || '', next: chunk.next, count: chunk.records.length, associationErrors: chunk.associationErrors, records: chunk.records }),
    });
    return res.json({ type, part, records: chunk.records.length, next: chunk.next, associationErrors: chunk.associationErrors });
  }

  if (action === 'finish' && req.method === 'POST') {
    const prefix = await checkPortal();
    const objectTypes = Array.isArray(body.objectTypes) ? body.objectTypes.map(String) : [];
    const files = await gcs.listBackupObjects({ bucket, prefix });
    const partFiles = tallyParts(files.map(f => f.name), prefix);
    const bytes = files.reduce((s, f) => s + (Number(f.size) || 0), 0);

    const expected = {};
    for (const type of objectTypes) {
      try {
        expected[type] = await countObjects(client, type);
      } catch {
        // Not every type can be searched; its count then goes unchecked.
        expected[type] = null;
      }
      await client.pause();
    }
    const verdict = verifyRun({ objectTypes, reported: body.reported || {}, partFiles, expected, typeErrors: body.typeErrors || {} });
    const manifest = {
      portalId: body.portalId, runId: body.runId, finishedAt: new Date().toISOString(), finishedBy: auth.email,
      complete: verdict.complete, rows: verdict.rows, files: files.length + 1, bytes,
    };
    await gcs.uploadJsonToGcs({ bucket, name: `${prefix}manifest.json`, content: JSON.stringify(manifest) });
    return res.json(manifest);
  }

  if (action === 'runs') {
    const files = await gcs.listBackupObjects({ bucket, prefix: BACKUP_ROOT });
    const runs = new Map();
    for (const f of files) {
      const m = f.name.slice(BACKUP_ROOT.length).match(/^([^/]+)\/([^/]+)\//);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      const run = runs.get(key) || { portalId: m[1], runId: m[2], files: 0, bytes: 0, manifest: null, hasManifest: false };
      run.files += 1;
      run.bytes += Number(f.size) || 0;
      if (f.name.endsWith('/manifest.json')) run.hasManifest = true;
      runs.set(key, run);
    }
    const list = [...runs.values()].sort((a, b) => b.runId.localeCompare(a.runId)).slice(0, 20);
    for (const run of list) {
      if (!run.hasManifest) continue;
      try {
        run.manifest = JSON.parse(await gcs.downloadGcsObject({ bucket, name: `${runPrefix(run.portalId, run.runId)}manifest.json` }));
      } catch { /* listed without its verdict */ }
    }
    return res.json({ runs: list });
  }

  return res.status(400).json({ error: 'Missing or invalid action parameter.' });
}

export default withAuth(handler);

// Unwrapped, for scripts/hubspotBackup.test.mjs. Vercel only routes the
// default export.
export { handler as handlerForTests };
