import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Opps view imports `doc`, `collection`, `getDocs` and `onSnapshot`
// straight from `firebase/firestore` for its real-time cross-device sync.
// This export is fully offline, so we alias that import to a local no-op
// stub (src/stubs/firestore.js). Nothing else from the firebase SDK is
// used, so `firebase` is not a dependency at all.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'firebase/firestore': fileURLToPath(new URL('./src/stubs/firestore.js', import.meta.url)),
    },
  },
});
