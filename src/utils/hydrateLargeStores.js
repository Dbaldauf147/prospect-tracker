// Signin-time restore for the stores whose payloads are too big to ride
// the localStorage mirror.
//
// localMirrorSync hydrates the small keyed stores by walking its registry.
// The big ones — captured Quoted Projections rows, Market Update emails
// with their attachments — keep a document per entry instead, and share
// one problem: nothing on the page knows to go and fetch an entry it has
// never heard of. A cleared browser opens the Market Updates tab, finds
// an empty list, and has no reason to ask Firestore whether that is true.
// So they are pulled once per signin, the same way and at the same moment.
//
// Not everything needs to be here. The per-opp files (an RFP workbook, a
// saved SIA) are fetched lazily when the opp that owns them is opened —
// the opp record itself carries the metadata that says the file exists,
// so the page always knows to ask.

export async function hydrateLargeStores(userId) {
  if (!userId) return;
  const results = await Promise.allSettled([
    import('./quotedMonthRows.js').then(m => m.hydrateQuotedMonthRows(userId)),
    import('./marketUpdatesStore.js').then(m => m.hydrateMarketUpdates(userId)),
  ]);
  results.forEach((r) => {
    if (r.status === 'rejected') console.warn('largeStores: hydrate failed', r.reason);
  });
}
