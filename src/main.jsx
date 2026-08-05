import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './print.css';
import { AuthProvider } from './contexts/AuthContext';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import App from './App';

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
