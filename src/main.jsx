import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './motion'; // mark the document with the device preferences before first paint
import './scale';
import './reading';
import './cues';
import './shell'; // the iOS shell's keyboard inset and page mark, a no-op in a browser
import { applyThemeVariables, themeExists, deviceDefaultTheme } from './themes';

// The theme's variables and body class before anything renders, so the
// first frame is the theme, not the stylesheet's light defaults
try {
  const saved = localStorage.getItem('justtype-theme') || deviceDefaultTheme();
  applyThemeVariables(themeExists(saved) ? saved : deviceDefaultTheme());
} catch { /* storage unavailable */ }

// Offline shell (public/sw.js). Production only: during development the
// dev server must always win, and a worker is exactly how UI goes stale.
// The loader appends this bundle after the manifest fetch, so on a real
// network the load event has usually fired already: register now in that
// case, otherwise wait for it so the first paint is not competing with it.
if (import.meta.env.PROD && !import.meta.env.VITE_APP && 'serviceWorker' in navigator) {
  // This page is the app's, so the worker may open it from cache next time
  const claim = () => {
    const say = () => navigator.serviceWorker.controller?.postMessage({ type: 'app-route', path: window.location.pathname });
    say();
    navigator.serviceWorker.addEventListener('controllerchange', say);
  };
  const register = () => { navigator.serviceWorker.register('/sw.js').then(claim).catch(() => {}); };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
