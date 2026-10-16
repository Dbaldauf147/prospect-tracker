// Module resolve hook that swaps src/utils/db.js for the in-memory
// idbStore.mjs next door. See idbStore.mjs.
const STORE = new URL('./idbStore.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)\.\/db(\.js)?$/.test(specifier) && context.parentURL?.includes('/src/utils/')) {
    return { url: STORE, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
