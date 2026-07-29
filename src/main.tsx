import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/App';
import { bootstrapPlatform } from './core/platform/bootstrap';
import './app/theme.css';

// Bind native storage / OS keystore before anything opens a database.
// No-op in the browser build (IndexedDB + passphrase unlock unchanged).
bootstrapPlatform();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
