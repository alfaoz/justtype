import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Offline shell (public/sw.js). Production only: during development the
// dev server must always win, and a worker is exactly how UI goes stale.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
