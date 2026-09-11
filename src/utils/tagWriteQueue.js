// One write per burst of tag clicks.
//
// dans_tags is a single semicolon-joined string, so every tag click sends
// the WHOLE list, and the write is not cheap: it reads the contact's live
// tags from HubSpot first (see mergeTagEdit), then PATCHes, then rewrites
// the local contacts cache and broadcasts that so every open table
// re-reads it. Firing that per click is what made tagging somebody feel
// like wading through treacle — six ticks meant six round trips, six cache
// rewrites and six app-wide re-renders, each one landing mid-click.
//
// A burst of clicks is one intention, and each click's list already
// contains every earlier click's tags. So hold a click for `delayMs`, let
// the next one replace it, and send only the last — with the list that
// carries them all. `maxWaitMs` is the backstop for somebody clicking
// steadily without pause: the queue stops deferring once the oldest
// unsent click is that old, so work still reaches HubSpot during a long
// run rather than piling up in a timer.
//
// Writes never overlap: they run one after another, so HubSpot decides
// nothing about ordering and a write always reads the result of the one
// before it. Every caller gets a promise resolving to whether the write
// carrying its click succeeded, so an optimistic tick can still be rolled
// back on a refusal.
//
// Pure and timer-injectable — no React, no DOM.

const DEFAULT_DELAY_MS = 600;
const DEFAULT_MAX_WAIT_MS = 2500;

/**
 * @param write      (value) => Promise<boolean|void> — the actual save.
 *                   Resolving false (or throwing) counts as refused.
 * @param delayMs    how long a click waits for the next one.
 * @param maxWaitMs  how long the oldest unsent click may wait in total.
 * @param timers     { setTimeout, clearTimeout, now } — injected for tests.
 */
export function createTagWriter({
  write,
  delayMs = DEFAULT_DELAY_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  timers = {},
} = {}) {
  const setT = timers.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = timers.clearTimeout || (id => clearTimeout(id));
  const now = timers.now || (() => Date.now());

  // The click waiting to be sent: its value (the newest list) and everyone
  // waiting to hear how it went. `since` is when the first still-unsent
  // click arrived, which is what maxWaitMs is measured from.
  let queued = null;
  let timer = null;
  let inflight = 0;
  let chain = Promise.resolve();

  function cancelTimer() {
    if (timer === null) return;
    clearT(timer);
    timer = null;
  }

  function send() {
    cancelTimer();
    if (!queued) return chain;
    const job = queued;
    queued = null;
    inflight += 1;
    // Runs on the tail of whatever is already going out, whether that
    // succeeded or not: a failed write must not swallow the next one.
    chain = chain.then(() => write(job.value), () => write(job.value)).then(
      (ok) => {
        inflight -= 1;
        const accepted = ok !== false;
        for (const resolve of job.waiting) resolve(accepted);
        return accepted;
      },
      () => {
        inflight -= 1;
        for (const resolve of job.waiting) resolve(false);
        return false;
      },
    );
    return chain;
  }

  function arm() {
    const waited = queued ? now() - queued.since : 0;
    // Steady clicking with no pause: send now rather than letting the
    // timer be pushed back for ever.
    if (waited >= maxWaitMs) { send(); return; }
    cancelTimer();
    timer = setT(() => { timer = null; send(); }, Math.max(0, Math.min(delayMs, maxWaitMs - waited)));
  }

  return {
    /**
     * Record a click. Resolves true when the write carrying this click's
     * list was accepted, false when it was refused.
     */
    push(value) {
      return new Promise((resolve) => {
        if (queued) {
          queued.value = value;
          queued.waiting.push(resolve);
        } else {
          queued = { value, since: now(), waiting: [resolve] };
        }
        arm();
      });
    },

    /**
     * Send what's waiting immediately — for a popup closing, or anything
     * else that must not leave a click in a timer. Resolves when the queue
     * has drained.
     */
    flush() {
      send();
      return chain.then(() => undefined, () => undefined);
    },

    /**
     * How many clicks this queue still owes HubSpot: one for a click
     * waiting in the timer, plus any write in the air. Never dips to zero
     * between a click and its write, which is what lets a caller tell
     * "my own state is newer than the record" from "nothing pending".
     */
    pending() {
      return inflight + (queued ? 1 : 0);
    },
  };
}
