import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './print.css';
import { AuthProvider } from './contexts/AuthContext';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import App from './App';

// A view here can pull in ninety files at once, so the default 250-entry
// resource timing buffer fills and drops exactly the record a failed
// chunk load needs (see diagnoseChunk in utils/lazyView).
try { performance.setResourceTimingBufferSize(2000); } catch { /* not supported, no matter */ }

// The boundary wraps the provider, not just App: AuthProvider renders too, and
// a throw there would otherwise escape to the blank-page case.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
