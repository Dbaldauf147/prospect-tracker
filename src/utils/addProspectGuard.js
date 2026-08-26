// Deciding whether an account already exists before creating one.
//
// The check used to be a lookup in the live subscription's array, which
// has two blind spots:
//
//   * Before the first snapshot lands that array is EMPTY, so anything
//     added in the opening moment of a page load sees an empty roster,
//     concludes the company is new, and mints a second record — with a
//     fresh document id and so none of the first one's Target Account,
//     divisions or HQ mappings.
//   * A record just created is not in it either, until the snapshot
//     echoes back. The bulk "add to Table View" loops in Marketing
//     Leads, ZoomInfo and Events call add once per company in sequence,
//     so two spellings of one company in one list could both pass the
//     check and both be created.
//
// So the guard waits for the roster before deciding, and remembers what
// it has already created until the roster confirms it. Dependencies are
// injected rather than imported so the races can be exercised directly
// in scripts/addProspectGuard.test.mjs — they are impossible to provoke
// reliably through Firestore.
//
//   keyOf(record)      → the identity two records must share, or '' if
//                        the record has no usable company name
//   getRoster()        → the subscription's current array
//   whenRosterReady()  → resolves once the first snapshot has landed;
//                        rejects if it never does
//   readRoster()       → an authoritative read, used only when the wait
//                        above fails
//   create(record)     → writes the record, resolves to its id
export function createAddProspectGuard({ keyOf, getRoster, whenRosterReady, readRoster, create }) {
  // key → promise of the id being created for it. An entry lives until
  // the roster reports that company, so a second caller in the same
  // moment waits for the first rather than creating its own copy.
  const pending = new Map();

  async function rosterFor(key) {
    try {
      await whenRosterReady();
      return getRoster() || [];
    } catch (err) {
      // The subscription never delivered. An authoritative read is
      // slower but it is the difference between a correct answer and a
      // duplicate — and if it fails too, failing the add is better than
      // silently creating a second copy.
      console.warn('addProspect: roster unavailable, reading it directly', err?.message || err);
      return (await readRoster(key)) || [];
    }
  }

  return {
    async add(record) {
      const key = keyOf(record);
      // No usable company name: nothing to compare it against, so it
      // cannot be deduped either way.
      if (!key) return create(record);

      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const roster = await rosterFor(key);
      const existing = roster.find(p => keyOf(p) === key);
      if (existing) return existing.id;

      // Re-check: awaiting the roster above yields, and another caller
      // may have claimed this key while we did.
      const claimed = pending.get(key);
      if (claimed) return claimed;

      const promise = Promise.resolve(create(record)).catch((err) => {
        // A failed write must not leave the key claimed forever, or a
        // retry would return the same rejection instead of writing.
        pending.delete(key);
        throw err;
      });
      pending.set(key, promise);
      return promise;
    },

    // Called with each snapshot: anything the roster now carries no
    // longer needs remembering.
    noteRoster(roster) {
      if (!pending.size) return;
      const live = new Set();
      for (const p of roster || []) {
        const k = keyOf(p);
        if (k) live.add(k);
      }
      for (const k of [...pending.keys()]) if (live.has(k)) pending.delete(k);
    },

    // Test/diagnostic view of what is still unconfirmed.
    pendingKeys() { return [...pending.keys()]; },
  };
}
