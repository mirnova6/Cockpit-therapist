import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/App';
import './app/theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
