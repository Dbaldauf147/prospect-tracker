import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ClientsApp from './ClientsApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClientsApp />
  </StrictMode>
);
