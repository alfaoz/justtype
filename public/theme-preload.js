// Paints the page ground from the stored theme before the app bundle parses,
// so a dark-theme user does not get a white first frame (and a white
// overscroll band during it).
//
// This lives in its own file rather than inline in index.html because the CSP
// is `script-src 'self' https://challenges.cloudflare.com` with no
// 'unsafe-inline' and no hash: an inline block is blocked outright, which is
// both a dead pre-paint and a console error on every page load.
//
// Keep the map in sync with the built-in themes in src/themes.js. A theme that
// is missing here (or a custom one) simply falls through to the stylesheet
// default until the bundle applies the real variables a moment later.
(function () {
  // the whole variable set of the last applied theme is kept on the device
  // (src/themes.js writes it), so every colour is right from the first
  // frame, not only the ground; a device without it gets the ground alone.
  try {
    var root = document.documentElement;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('justtype-theme-vars') || 'null'); } catch (e) { saved = null; }
    var bg = saved && saved.vars && saved.vars['--theme-bg'];
    if (bg) {
      for (var k in saved.vars) root.style.setProperty(k, saved.vars[k]);
    } else {
      bg = {
        dark: '#050505',
        legacy: '#111111',
        light: '#faf9f7',
        sepia: '#f4ecd8',
        midnight: '#0a0a14',
      }[localStorage.getItem('justtype-theme')
        || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')];
      if (bg) root.style.setProperty('--theme-bg', bg);
    }
    if (bg) {
      root.style.backgroundColor = bg;
      var themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.setAttribute('content', bg);
    }
  } catch (e) { /* storage unavailable: stylesheet default is fine */ }
})();
