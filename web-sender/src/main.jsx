import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker immediately for offline precaching
registerSW({
  immediate: true,
  onOfflineReady() {
    console.log('[Offline Pay] App assets cached. Ready to work completely offline.');
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
