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
// The inner assertion is not always ca9. The Opps auto-save hit the same
// wall with `(ID: b7de) CONTEXT: {"batchId":5526}` inside it — a mutation
// batch the local store could not find while acknowledging it — and the
// aftermath was identical: b815 on everything afterwards. Which assertion
// tripped first says nothing useful to a caller, which is why the check
// below matches the family rather than an id.
//
// So a save that hits this has not hit a database problem. The database is
// fine, and the same document can still be written over HTTPS (see
// firestoreRest). What the caller needs to know is (a) that retrying
// through the SDK is pointless, and (b) that the page has stopped syncing
// and needs reloading, whatever happens to this one write.

let wedged = false;
let firstError = null;
let announced = false;
const listeners = new Set();

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
  for (const fn of [...listeners]) {
    try { fn(firstError); } catch { /* a listener must not stop the others */ }
  }
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

// What to tell someone whose save just landed on this.
//
// `saved` says whether the work itself survived (the HTTPS fallback took
// it) — that is the first thing they want to know, and it changes the
// instruction from "do it again" to "carry on, but reload".
//
// `detail` is for the third case, and the reason this isn't a boolean: the
// client is dead AND the fallback was refused on its own terms (a quota, a
// rules rejection, a blocked host). That status is the useful half of the
// message and the SDK crash is the other half, so it says both. A lost save
// with no detail means no fallback ran at all — which is what an SDK
// assertion reaching the caller means, since a failed fallback throws its
// own HTTP error rather than the assertion.
export function wedgedClientMessage(saved, detail = '') {
  if (saved) {
    return 'Saved — but the live database connection in this tab has crashed '
      + '(a Firebase SDK bug, not your data). This change was written over a direct connection instead. '
      + 'Reload the page to start syncing again; until you do, changes made in other tabs '
      + 'or on other devices won\'t show up here.';
  }
  return 'This change could not be saved: the live database connection in this tab has crashed '
    + '(a Firebase SDK bug, not your data). '
    + (detail ? `The direct connection was refused too — ${detail}. ` : '')
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

// Be told when the client crashes, rather than finding out at the next
// save. A view whose live updates have just stopped needs to say so while
// the user is still reading the screen — the crash itself is the event, not
// the failed write that eventually follows it. Fires immediately when the
// client is already dead, so a view mounted afterwards is not left silent.
export function subscribeToClientWedged(fn) {
  if (typeof fn !== 'function') return () => {};
  if (wedged) { try { fn(firstError); } catch { /* caller's problem */ } }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// `sdk`, falling back to `rest` when the Firestore SDK has crashed.
//
// The two halves must be equivalent, because which one runs is not the
// caller's choice: once the async queue is dead every SDK call rejects, so
// a step with no HTTPS twin is a step that can no longer happen. Running
// `rest` up front when the client is already known dead saves the doomed
// round-trip; the catch is for the save that is the first to find out.
//
// Not for a read-modify-write that has no honest single-request form (a
// transaction): there the right answer is to skip the fallback, not fake it.
export async function viaSdkOrRest(sdk, rest) {
  if (wedged) return rest();
  try {
    return await sdk();
  } catch (err) {
    if (!isClientWedgedError(err)) throw err;
    noteClientWedged(err);
    return rest();
  }
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
  listeners.clear();
}
