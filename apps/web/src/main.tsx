import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import './i18n.ts';
import { registerSW } from 'virtual:pwa-register';

// Register the PWA service worker for offline support.
registerSW({
  onNeedRefresh: () => {
    // A new service worker is waiting to be installed.
    // The page will reload automatically on next visit or when the SW takes over.
  },
  onOfflineReady: () => {
    // The app is ready to work offline.
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
