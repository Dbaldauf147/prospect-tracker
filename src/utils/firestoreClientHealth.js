// When the Firestore SDK crashes itself.
//
// This is the error the Utility Lookup company mapping surfaced:
//
//   Failed to save: FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED:
//   Unexpected state (ID: b815) CONTEXT: {"Pc":"Error: FIRESTORE (12.11.0)
//   INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) CONTEXT:
//   {\"ve\":-1}"}
//
// Two assertions, and the order matters. ca9 is `pendingResponses >= 0` in
// the watch-change aggregator: the SDK received an acknowledgement for a
// listen target it wasn't waiting on, so its count of outstanding responses
// went to -1. It is a known SDK bug rather than anything the caller did —
// it shows up on rapid listen/unlisten cycles and on multi-tab persistence,
// both of which this app has (a settings doc listener, a per-company site
// list listener, an analysis listener that re-targets as the mapped company
// changes, and persistentMultipleTabManager in src/firebase.js).
//
// b815 is the aftermath: `AsyncQueue is already failed`. That first
// assertion escaped inside the SDK's async queue, so the queue is now in a
// permanent failed state and EVERY later operation — the stale-check read
// and the write in this save, and every read, write and snapshot for the
// rest of the tab's life — rejects with it, quoting the original error in
// its context. Nothing reconnects it; only a reload builds a new client.
//
// So a save that hits this has not hit a database problem. The database is
// fine, and the same document can still be written over HTTPS (see
// firestoreRest). What the caller needs to know is (a) that retrying
// through the SDK is pointless, and (b) that the page has stopped syncing
// and needs reloading, whatever happens to this one write.

let wedged = false;
let firstError = null;
let announced = false;

// True for the assertion pair above, however it was re-thrown. Matching on
// the text is deliberate: the SDK's minified assertion carries no code, no
// `name` worth reading, and no class to instanceof against — the string is
// the only stable part of it. `ID: b815` is matched too, since after the
// first crash that is the only one a caller ever sees.
export function isClientWedgedError(err) {
  const msg = String(err?.message || err || '');
  return /INTERNAL ASSERTION FAILED/i.test(msg)
    || /AsyncQueue is already failed/i.test(msg);
}

/** Record that the SDK crashed. Returns true the first time. */
export function noteClientWedged(err) {
  if (wedged) return false;
  wedged = true;
  firstError = err || null;
  console.error(
    'The Firestore client in this tab has crashed (an internal SDK assertion). '
    + 'Live updates have stopped and every SDK call will fail until the page is reloaded; '
    + 'saves fall back to plain HTTPS in the meantime.',
    err,
  );
  return true;
}

/** Whether the SDK is known to be dead in this tab. */
export const isClientWedged = () => wedged;

/** The assertion that killed it, for a message that wants to quote it. */
export const wedgedClientError = () => firstError;

// What to tell someone whose save just landed on this. `saved` says whether
// the work itself survived (the REST fallback took it) — that is the first
// thing they want to know, and it changes the instruction from "do it
// again" to "carry on, but reload".
export function wedgedClientMessage(saved) {
  return saved
    ? 'Saved — but the live database connection in this tab has crashed '
      + '(a Firebase SDK bug, not your data). This change was saved over a direct connection. '
      + 'Reload the page to start syncing again; until you do, changes made in other tabs won\'t show up here.'
    : 'The live database connection in this tab has crashed (a Firebase SDK bug, not your data), '
      + 'and the fallback save didn\'t get through either. '
      + 'Reload the page and try again — a backup of your pre-save state was saved locally.';
}

// Whether the UI has yet said anything about the crash. A save that still
// landed over HTTPS is worth mentioning once — the tab needs reloading —
// but not on every keystroke-sized save for the rest of the session. A save
// that was LOST is a different matter and always speaks up, which is why
// this is the caller's decision rather than a rule in here.
export function shouldAnnounceWedgedClient() {
  if (announced) return false;
  announced = true;
  return true;
}

// Catch the crash where it actually happens, not just where it surfaces.
// The assertion is thrown inside the SDK's own async queue, so it reaches
// the page as an unhandled rejection (or a window error) with no call of
// ours anywhere near it. Marking the client wedged there means the first
// save afterwards already knows to go straight to HTTPS instead of spending
// a round-trip discovering it.
export function watchForClientCrash() {
  if (typeof window === 'undefined') return () => {};
  const onRejection = (e) => { if (isClientWedgedError(e?.reason)) noteClientWedged(e.reason); };
  const onError = (e) => { if (isClientWedgedError(e?.error || e?.message)) noteClientWedged(e?.error || e?.message); };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError);
  };
}

// Test seam. Nothing in the app clears this — a crashed client stays
// crashed until the tab reloads.
export function __resetClientHealth() {
  wedged = false;
  firstError = null;
  announced = false;
}
