// Collects a full point-in-time snapshot of one user's Firestore data
// for the daily backup job, plus a lightweight summary (counts only)
// used for the notification email and day-over-day anomaly detection.
//
// The snapshot covers the clobber-prone single-document blobs
// (opps2Data is the one that bit us; the rest follow the same one-doc
// shape) and the user's prospects collection. Each section is captured
// independently — a failure on one is recorded in `summary.errors` and
// does not abort the rest, so a partial backup still gets stored.

// Single-document-per-user blobs at `${col}/${uid}`.
const SINGLE_DOC_COLLECTIONS = ['userSettings', 'targetAccounts', 'progressHistory', 'emailCampaigns'];

// The primary account stores prospects in the shared top-level
// `prospects` collection; every other user uses `users/{uid}/prospects`.
// Mirrors peOpps.loadPeFirms / firestoreSync.getCol.
const SHARED_PROSPECTS_EMAIL = 'baldaufdan@gmail.com';

function msg(e) { return String(e?.message || e).slice(0, 200); }

// Reassemble opps2Data/{uid}, joining the chunked JSON when present.
async function loadOpps2Full(db, uid) {
  const ref = db.collection('opps2Data').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const raw = snap.data() || {};
  let json = null;
  if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
    const parts = new Array(raw.chunkCount).fill('');
    const chunks = await ref.collection('chunks').get();
    chunks.forEach(d => {
      const i = Number(d.id);
      if (Number.isFinite(i) && i >= 0 && i < parts.length) parts[i] = String(d.data()?.json || '');
    });
    json = parts.join('');
  } else if (raw.json) {
    json = raw.json;
  }
  if (!json) return null;
  // Keep the raw string if it somehow won't parse — a backup of
  // unparseable data still beats no backup.
  try { return JSON.parse(json); } catch { return { _unparseableJson: json }; }
}

export async function collectUserBackup(db, uid, email) {
  const generatedAt = new Date().toISOString();
  const backup = { uid, email: email || null, generatedAt, schema: 1, collections: {} };
  const summary = { uid, email: email || null, generatedAt, counts: {}, captured: [], errors: [] };

  // opps2Data (the dataset that got clobbered)
  try {
    const opps2 = await loadOpps2Full(db, uid);
    backup.collections.opps2Data = opps2;
    if (opps2) {
      summary.counts.opps2Records = Array.isArray(opps2.records) ? opps2.records.length : 0;
      summary.captured.push('opps2Data');
    }
  } catch (e) { summary.errors.push(`opps2Data: ${msg(e)}`); }

  // Single-document blobs
  for (const col of SINGLE_DOC_COLLECTIONS) {
    try {
      const s = await db.collection(col).doc(uid).get();
      backup.collections[col] = s.exists ? s.data() : null;
      if (s.exists) summary.captured.push(col);
    } catch (e) { summary.errors.push(`${col}: ${msg(e)}`); }
  }

  // Company site lists moved out of the userSettings document into
  // `userSettings/{uid}/companySiteLists/{slug}` — a whole uploaded
  // spreadsheet per company, and the settings blob above no longer
  // carries them. Restored to the same slug → entry map the settings key
  // used to hold.
  try {
    const snap = await db.collection('userSettings').doc(uid).collection('companySiteLists').get();
    const lists = {};
    snap.forEach(d => { lists[d.id] = d.data(); });
    backup.collections.companySiteLists = lists;
    summary.counts.companySiteLists = snap.size;
    if (snap.size) summary.captured.push('companySiteLists');
  } catch (e) { summary.errors.push(`companySiteLists: ${msg(e)}`); }

  // Prospects
  try {
    const useShared = !!email && email.toLowerCase() === SHARED_PROSPECTS_EMAIL;
    const source = useShared ? 'prospects' : `users/${uid}/prospects`;
    const colRef = useShared
      ? db.collection('prospects')
      : db.collection('users').doc(uid).collection('prospects');
    const snap = await colRef.get();
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    backup.collections.prospects = { source, records };
    summary.counts.prospects = records.length;
    summary.captured.push('prospects');
  } catch (e) { summary.errors.push(`prospects: ${msg(e)}`); }

  // Prospect analyses (AI research) live in an `analyses` subcollection
  // under each prospect: `${prospectsSource}/{prospectId}/analyses/{id}`.
  // A collectionGroup query pulls every analyses doc in one read instead
  // of one read per prospect, then we keep only those under this user's
  // prospects path (and store the full path so a restore can re-place
  // each doc under the right prospect).
  try {
    const useShared = !!email && email.toLowerCase() === SHARED_PROSPECTS_EMAIL;
    const prefix = useShared ? 'prospects/' : `users/${uid}/prospects/`;
    const cg = await db.collectionGroup('analyses').get();
    const analyses = [];
    cg.forEach(d => {
      const path = d.ref.path;
      if (path.startsWith(prefix) && path.includes('/analyses/')) {
        analyses.push({ path, id: d.id, ...d.data() });
      }
    });
    backup.collections.prospectAnalyses = analyses;
    summary.counts.prospectAnalyses = analyses.length;
    summary.captured.push('prospectAnalyses');
  } catch (e) { summary.errors.push(`prospectAnalyses: ${msg(e)}`); }

  return { backup, summary };
}

// Compare today's counts against the previous run. Flags any count that
// dropped by `dropFraction` or more — the early-warning a sudden Opps 2
// shrink (1447 → 1200) would have given on this incident.
export function detectAnomalies(prevCounts, counts, dropFraction = 0.10) {
  const alerts = [];
  if (!prevCounts) return alerts;
  for (const key of Object.keys(counts || {})) {
    const prev = Number(prevCounts[key]) || 0;
    const cur = Number(counts[key]) || 0;
    if (prev > 0 && cur < prev) {
      const drop = (prev - cur) / prev;
      if (drop >= dropFraction) {
        alerts.push({ field: key, prev, cur, dropPct: Math.round(drop * 100) });
      }
    }
  }
  return alerts;
}
