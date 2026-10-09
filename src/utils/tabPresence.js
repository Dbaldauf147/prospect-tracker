// Is this app already open in another tab of this browser?
//
// Firestore's persistent cache has ONE owner tab (see src/firebase.js). A
// tab opened while another holds it falls back to an in-memory cache and
// reads the whole company roster from the server on load: thousands of
// reads against the Spark plan's 50K/day. Two or three of those a day is
// what ran the project out of reads, so the late tab says so.
//
// Protocol over a BroadcastChannel: a tab announces itself with `hello`;
// every tab already open answers `here`. Hearing `here` means "I arrived
// second", which is the tab that paid. `bye` on pagehide lets the late tab
// know the other one closed. The first tab never shows anything: it holds
// the cache and costs nothing extra.
//
// Pure apart from the channel, which is injected so the protocol can be
// asserted without a browser: scripts/tabPresence.test.mjs.

export const TAB_CHANNEL_NAME = 'prospect-tracker-tabs';

/**
 * Start listening. `onChange(count)` gets the number of OTHER tabs that
 * were already open when this one arrived (and are still open). Returns a
 * stop function that says `bye` and closes the channel.
 */
export function watchEarlierTabs(onChange, {
  channel = (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(TAB_CHANNEL_NAME) : null),
  id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
} = {}) {
  if (!channel) return () => {};
  const earlier = new Set();
  const emit = () => onChange(earlier.size);
  const post = (type, extra = {}) => {
    try { channel.postMessage({ type, id, ...extra }); } catch { /* channel closed */ }
  };

  channel.onmessage = (e) => {
    const m = e?.data;
    if (!m || m.id === id) return;
    if (m.type === 'hello') post('here', { to: m.id });
    else if (m.type === 'here' && m.to === id) { earlier.add(m.id); emit(); }
    else if (m.type === 'bye' && earlier.delete(m.id)) emit();
  };
  post('hello');

  let stopped = false;
  return function stop() {
    if (stopped) return;
    stopped = true;
    post('bye');
    try { channel.close(); } catch { /* already closed */ }
  };
}
