import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@cdevi/design-system/css';
import { ThemeProvider } from '@cdevi/design-system';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme="system">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
