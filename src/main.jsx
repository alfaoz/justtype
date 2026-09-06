import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Offline shell (public/sw.js). Production only: during development the
// dev server must always win, and a worker is exactly how UI goes stale.
// The loader appends this bundle after the manifest fetch, so on a real
// network the load event has usually fired already: register now in that
// case, otherwise wait for it so the first paint is not competing with it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
