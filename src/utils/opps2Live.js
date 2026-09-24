// One shared, live copy of the Opps 2 records for the hooks App keeps
// mounted all day (the Issues badge, the Opps call-in badge, the Prospecting
// ladder and tag debt).
//
// Each of those used to read the whole `opps2-cache` record out of IndexedDB
// on its own, on every window focus and after every Opps 2 save. IndexedDB
// hands back a fresh structured clone on every read, so four reads meant four
// new arrays, and every one of them re-ran its hook's full pass over the
// prospects (computeIssues, service gaps, roster coverage, the ladder) and
// re-rendered App. Clicking back into the browser tab did all of that even
// when nothing had changed.
//
// So there is one reader here:
//   - reads are shared: a trigger that lands while a read is in flight asks
//     for one more read after it, rather than starting its own,
//   - a read that comes back with the `_updatedAt` already held keeps the
//     object already held (saveOpps2Cache stamps every write, and it is the
//     only writer), so nothing downstream sees a change that isn't one,
//   - the 10-minute tick still publishes a new snapshot regardless, because
//     Call In and the ladder are relative to today and have to roll over at
//     midnight without an edit.
//
// No imports: the loaders are handed in, so this runs in plain Node for its
// test.

export function createOpps2Live({ loadCache, loadNewest, tickMs = 10 * 60 * 1000 }) {
  let current = null;
  // Matches no real id (not even undefined), so the first start loads.
  let userId = {};
  let readId = 0;
  let inflight = null;
  let again = false;
  let refs = 0;
  let timer = null;
  const listeners = new Set();

  function emit() { for (const l of listeners) l(); }

  function publish(data, { force = false } = {}) {
    if (!data || !Array.isArray(data.records)) return;
    const same = current
      && data._updatedAt != null
      && data._updatedAt === current._updatedAt;
    if (same && !force) return;
    // A forced publish of unchanged data still hands out a new records
    // array: the consumers memoize on it, and the date math is the point.
    current = same ? { ...current, records: current.records.slice() } : data;
    emit();
  }

  function run(loader, opts) {
    const id = readId;
    const p = Promise.resolve()
      .then(loader)
      .then(d => { if (id === readId) publish(d, opts); })
      .catch(() => { /* keep what we have rather than blanking the badges */ })
      .finally(() => {
        // A read left over from the previous account neither clears the
        // current one's slot nor queues a follow-up.
        if (inflight !== p) return;
        inflight = null;
        if (again) { again = false; run(loadCache); }
      });
    inflight = p;
    return p;
  }

  function refresh(opts) {
    if (inflight) {
      // A save can land after the in-flight read started; read once more
      // after it so the newest write is never the one that's missed.
      again = true;
      if (opts?.force) inflight.then(() => { if (current) publish(current, opts); });
      return inflight;
    }
    return run(loadCache, opts);
  }

  const onFocus = () => { refresh(); };
  const onSaved = () => { refresh(); };
  const onTick = () => { refresh({ force: true }); };

  return {
    getSnapshot: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Started by every hook that reads the records; the listeners and the
    // timer are attached once and dropped when the last one unmounts.
    start(uid) {
      refs += 1;
      if (uid !== userId) {
        // A different account: what's held belongs to the last one.
        userId = uid;
        readId += 1;
        if (current) { current = null; emit(); }
        inflight = null;
        again = false;
        run(() => loadNewest(uid));
      } else if (refs === 1) {
        // Remounted for the same account: catch up on anything saved while
        // nothing was listening.
        refresh();
      }
      if (refs === 1 && typeof window !== 'undefined') {
        window.addEventListener('focus', onFocus);
        window.addEventListener('opps2-cache-updated', onSaved);
        timer = setInterval(onTick, tickMs);
      }
      return () => {
        refs -= 1;
        if (refs === 0 && typeof window !== 'undefined') {
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('opps2-cache-updated', onSaved);
          clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh,
    tick: onTick,
  };
}
