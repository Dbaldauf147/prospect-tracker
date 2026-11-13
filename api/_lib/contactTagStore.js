// Dan's Tags, kept in the app's own Firestore rather than in HubSpot.
//
// The tags used to live only in HubSpot's `dans_tags` property: one
// semicolon-joined string per contact, so every write replaced the whole
// list, and tags kept going missing - a write from a stale copy, a bulk
// edit, a portal move. HubSpot is no longer written: the tags are the
// app's, stored here, and HubSpot's value is only ever read once, to seed
// a contact this store has never seen.
//
//   contactTags/{uid}            { tags: { [contactId]: "ESG;Procurement" },
//                                  count, updatedAt }
//   contactTags/{uid}/log/{auto} { contactId, from, to, at, source }
//
// `tags` is one map, written key by key (set with merge), so two edits to
// different contacts never overwrite each other and no edit has to read the
// whole map first. Every change also appends a log row - the before and
// after of that one contact - so a tag that goes missing can be traced and
// put back from here, not just from HubSpot's property history. The whole
// document goes into the nightly backup (api/_lib/dataBackup.js), counted,
// so a drop in tagged contacts is flagged in the backup email.
//
// Rows in, rows out apart from the three Firestore calls, so the overlay
// and the seeding can be tested without a database.

export const CONTACT_TAGS_COLLECTION = 'contactTags';

// The three spellings the contact's tag field has had across HubSpot
// exports. Readers take the first that is set, so an overlay has to set
// them all - a stored '' must not fall through to a stale spelling.
export const TAG_FIELDS = ['dans_tags', 'dan_s_tags', 'dans_tag'];

const clean = (v) => String(v ?? '').split(';').map(s => s.trim()).filter(Boolean).join(';');

/** The contact's tags as HubSpot (or a request body) carries them. */
export function tagsOfProps(props) {
  if (!props || typeof props !== 'object') return undefined;
  for (const f of TAG_FIELDS) {
    if (typeof props[f] === 'string') return props[f];
  }
  return undefined;
}

/** Whether a properties object carries any tag field at all. */
export function hasTagField(props) {
  return !!props && typeof props === 'object' && TAG_FIELDS.some(f => Object.prototype.hasOwnProperty.call(props, f));
}

/** The properties with every tag field taken out (what goes to HubSpot). */
export function withoutTagFields(props) {
  const out = { ...(props || {}) };
  for (const f of TAG_FIELDS) delete out[f];
  return out;
}

/**
 * Contacts with the stored tags laid over HubSpot's. A contact the store
 * has no entry for keeps HubSpot's value (and is reported in `unseen`, so
 * the caller can seed it). Returns { contacts, unseen: [{ id, tags }] }.
 */
export function overlayTags(contacts, stored) {
  const map = stored || {};
  const unseen = [];
  const out = (contacts || []).map((c) => {
    const id = c?.id == null ? '' : String(c.id);
    if (!id) return c;
    if (Object.prototype.hasOwnProperty.call(map, id)) {
      const next = { ...c };
      for (const f of TAG_FIELDS) next[f] = map[id];
      return next;
    }
    unseen.push({ id, tags: clean(tagsOfProps(c)) });
    return c;
  });
  return { contacts: out, unseen };
}

function refFor(db, uid) {
  return db.collection(CONTACT_TAGS_COLLECTION).doc(String(uid));
}

/** The stored map, { [contactId]: tags }. {} when nothing is stored yet. */
export async function loadContactTags(db, uid) {
  if (!db || !uid) return {};
  const snap = await refFor(db, uid).get();
  const data = snap.exists ? snap.data() : null;
  return (data && data.tags && typeof data.tags === 'object') ? { ...data.tags } : {};
}

/**
 * Write tags for some contacts: [{ id, tags }]. Merged key by key into the
 * map, with one log row per contact whose value actually changed. `prev`
 * is the map as the caller last read it (for the log's `from`); omitted, it
 * is read here. Returns the number of contacts changed.
 *
 * `source` names what wrote it ('edit', 'seed', 'restore', ...), for the
 * log. Seeding writes no log rows: it records what HubSpot already said,
 * which changes nothing.
 */
export async function saveContactTags(db, uid, entries, { source = 'edit', prev = null } = {}) {
  if (!db || !uid) throw new Error('Tag store unavailable: no signed-in user.');
  const list = (entries || [])
    .map(e => ({ id: String(e?.id ?? '').trim(), tags: clean(e?.tags) }))
    .filter(e => e.id);
  if (!list.length) return 0;
  const before = prev || await loadContactTags(db, uid);
  const changed = list.filter(e => !Object.prototype.hasOwnProperty.call(before, e.id) || before[e.id] !== e.tags);
  if (!changed.length) return 0;
  const ref = refFor(db, uid);
  const at = new Date().toISOString();
  const patch = {};
  for (const e of changed) patch[e.id] = e.tags;
  const merged = { ...before, ...patch };
  const count = Object.values(merged).filter(Boolean).length;
  // Firestore batches cap at 500 writes; the map write is one of them.
  const logRows = source === 'seed' ? [] : changed;
  for (let i = 0; i < Math.max(1, logRows.length); i += 400) {
    const batch = db.batch();
    if (i === 0) batch.set(ref, { tags: patch, count, updatedAt: at }, { merge: true });
    for (const e of logRows.slice(i, i + 400)) {
      batch.set(ref.collection('log').doc(), {
        contactId: e.id,
        from: Object.prototype.hasOwnProperty.call(before, e.id) ? before[e.id] : null,
        to: e.tags,
        at,
        source,
      });
    }
    await batch.commit();
  }
  for (const e of changed) before[e.id] = e.tags;
  return changed.length;
}

/**
 * Overlay the store onto contacts read from HubSpot, seeding any contact
 * the store hasn't seen with the value HubSpot holds for it. The one place
 * HubSpot's tags are still read, and only for contacts new to the store.
 */
export async function contactsWithStoredTags(db, uid, contacts) {
  const stored = await loadContactTags(db, uid);
  const { contacts: out, unseen } = overlayTags(contacts, stored);
  if (unseen.length) {
    try {
      await saveContactTags(db, uid, unseen, { source: 'seed', prev: stored });
    } catch (e) {
      // A failed seed loses nothing: the contact still shows HubSpot's
      // value, and the next read tries again.
      console.error('contactTagStore: seed failed', e?.message || e);
    }
  }
  return out;
}
