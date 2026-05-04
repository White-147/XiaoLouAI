import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { retireStaticBuildServiceWorkers } from './lib/service-worker-retirement.ts';
import { initializeTheme } from './lib/theme.ts';

initializeTheme();
retireStaticBuildServiceWorkers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
