import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Progress subtab (and the list-backup util) import a few functions
// straight from `firebase/firestore` to persist per-user settings. This
// export is fully offline, so we alias that import to a local no-op stub
// (src/stubs/firestore.js). Nothing else from the firebase SDK is used —
// `firebase.js` is a stub — so `firebase` isn't a dependency at all.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'firebase/firestore': fileURLToPath(new URL('./src/stubs/firestore.js', import.meta.url)),
    },
  },
});
