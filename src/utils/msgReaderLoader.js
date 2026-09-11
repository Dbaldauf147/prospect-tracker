// Loads @kenjiuno/msgreader on demand.
//
// The package pulls in a DataStream implementation plus `buffer` and
// `iconv-lite`'s codec tables — around 200 kB of JS that only matters
// once someone actually drops an Outlook .msg file on a drop zone. Both
// call sites (the Opportunity form's meeting drop and the Drafts tab's
// email drop) are already async, so a dynamic import costs them nothing
// and keeps that weight out of the chunk the modal loads with.
//
// Depending on how the bundler resolves this CJS/ESM package the class
// lands at either .default or one level further down, so unwrap here —
// once — rather than in each caller.
let cached = null;

export async function loadMsgReader() {
  if (!cached) {
    cached = import('@kenjiuno/msgreader').then(
      mod => mod?.default?.default || mod?.default || mod,
      // A failed load must not be remembered as a resolved value, or a
      // transient network blip would break the drop zone for the session.
      (err) => { cached = null; throw err; },
    );
  }
  return cached;
}
