// Stands in for src/firebase.js, which reads import.meta.env and THROWS
// while it is still evaluating outside a Vite build. The stub database
// handle is only ever passed to the stubbed firestore functions; the app
// and auth shapes are the ones the REST fallback reads (project id and a
// signed ID token).
export const db = { __stub: true, app: { options: { projectId: 'test-project' } } };
export const auth = {
  app: { options: { projectId: 'test-project' } },
  currentUser: { uid: 'u1', getIdToken: async () => 'test-token' },
};
export const googleProvider = {};
