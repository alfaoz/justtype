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
  try {
    var bg = {
      dark: '#050505',
      legacy: '#111111',
      light: '#faf9f7',
      sepia: '#f4ecd8',
      midnight: '#0a0a14',
    }[localStorage.getItem('justtype-theme') || 'light'];
    if (!bg) return;
    document.documentElement.style.setProperty('--theme-bg', bg);
    document.documentElement.style.backgroundColor = bg;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
  } catch (e) {
    /* storage unavailable: the stylesheet default is fine */
  }
})();
