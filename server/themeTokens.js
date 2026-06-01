// Server-side theme resolution for the OAuth consent page.
//
// The justtype client renders in the user's chosen theme (colors + fonts loaded
// from Google Fonts at runtime). To make the server-rendered consent page feel
// native, we resolve that same theme here and inject its tokens + font link.
//
// SECURITY: custom themes are user-controlled JSON. Every value that lands in the
// page is sanitized — colors must be hex, font family names are stripped to a safe
// charset — so a malicious theme can never inject CSS or markup.

// Mirror of the built-in palettes in src/themes.js (colors + fonts only).
const DEFAULT_FONTS = { ui: { family: 'JetBrains Mono', weights: [300, 400, 500] },
                        writer: { family: 'JetBrains Mono', weights: [300, 400, 500] } };
const SEPIA_FONTS = { ui: { family: 'Lora', weights: [400, 500, 600] },
                      writer: { family: 'EB Garamond', weights: [400, 500] } };

const BUILTIN = {
  dark:   { colors: { bg:'#050505', bgSecondary:'#0a0a0a', bgTertiary:'#111111', text:'#e5e5e5', textMuted:'#888888', textDim:'#4a4a4a', border:'#1a1a1a', borderLight:'#141414', accent:'#e5e5e5', blue:'#4cc9f0', orange:'#f77f00', red:'#e94560', green:'#06d6a0' }, fonts: DEFAULT_FONTS },
  legacy: { colors: { bg:'#111111', bgSecondary:'#1a1a1a', bgTertiary:'#222222', text:'#d4d4d4', textMuted:'#a0a0a0', textDim:'#666666', border:'#333333', borderLight:'#222222', accent:'#ffffff', blue:'#60a5fa', orange:'#fb923c', red:'#f87171', green:'#4ade80' }, fonts: DEFAULT_FONTS },
  light:  { colors: { bg:'#faf9f7', bgSecondary:'#ffffff', bgTertiary:'#f0efed', text:'#1a1a1a', textMuted:'#4a4a4a', textDim:'#888888', border:'#d4d2cf', borderLight:'#e8e7e5', accent:'#1a1a1a', blue:'#0066cc', orange:'#b85c00', red:'#b33000', green:'#008800' }, fonts: DEFAULT_FONTS },
  sepia:  { colors: { bg:'#f4ecd8', bgSecondary:'#faf6eb', bgTertiary:'#ebe4d0', text:'#5c4b37', textMuted:'#7a6b5a', textDim:'#9a8b7a', border:'#d4c4a8', borderLight:'#e0d4be', accent:'#3d2e1f', blue:'#2563eb', orange:'#c2410c', red:'#b91c1c', green:'#15803d' }, fonts: SEPIA_FONTS },
  midnight:{ colors: { bg:'#0a0a14', bgSecondary:'#12121e', bgTertiary:'#1a1a28', text:'#c8c8d4', textMuted:'#8888a0', textDim:'#55556a', border:'#2a2a3a', borderLight:'#1e1e2a', accent:'#e0e0f0', blue:'#6366f1', orange:'#f59e0b', red:'#ef4444', green:'#22c55e' }, fonts: DEFAULT_FONTS }
};

const COLOR_KEYS = ['bg','bgSecondary','bgTertiary','text','textMuted','textDim','border','borderLight','accent','blue','orange','red','green'];

// A safe color is a #rgb / #rrggbb / #rrggbbaa hex string. Anything else is dropped.
const safeColor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) ? v.trim() : null;
// A safe font family is letters/numbers/spaces/hyphens only (Google Fonts names).
const safeFamily = (v) => {
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0, 50);
  return cleaned || null;
};

// Accept the same font-spec shapes the client does, but only keep a clean family.
function parseFontSpec(spec) {
  if (!spec) return null;
  if (typeof spec === 'object' && spec.family) {
    const family = safeFamily(spec.family);
    return family ? { family, weights: Array.isArray(spec.weights) ? spec.weights.filter(w => Number.isInteger(w)) : [400] } : null;
  }
  if (typeof spec !== 'string') return null;
  if (spec.includes('fonts.google.com/specimen/')) {
    const m = spec.match(/specimen\/([^?]+)/);
    if (m) { const family = safeFamily(decodeURIComponent(m[1].replace(/\+/g, ' '))); return family ? { family, weights: [400, 500] } : null; }
  }
  if (spec.includes(':wght@')) {
    const [fam, weightStr] = spec.split(':wght@');
    const family = safeFamily(fam);
    const weights = weightStr.split(';').map(w => parseInt(w, 10)).filter(w => !isNaN(w));
    return family ? { family, weights: weights.length ? weights : [400] } : null;
  }
  const family = safeFamily(spec);
  return family ? { family, weights: [400] } : null;
}

function googleFontsUrl(fonts) {
  const families = [];
  for (const f of fonts) {
    if (!f || !f.family) continue;
    const name = f.family.replace(/ /g, '+');
    const weights = (f.weights && f.weights.length ? f.weights : [400]).join(';');
    families.push(`family=${name}:wght@${weights}`);
  }
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

// Resolve a user's theme into safe { colors, fontUrl, uiFamily } for the page.
// themeId: users.theme; customThemesRaw: users.custom_themes (JSON string or null).
function resolveUserTheme(themeId, customThemesRaw) {
  let theme = BUILTIN[themeId];
  if (!theme && customThemesRaw) {
    try {
      const custom = JSON.parse(customThemesRaw);
      if (custom && typeof custom === 'object' && custom[themeId] && custom[themeId].colors) {
        theme = { colors: custom[themeId].colors, fonts: custom[themeId].fonts || DEFAULT_FONTS };
      }
    } catch { /* ignore malformed custom themes */ }
  }
  if (!theme) theme = BUILTIN.light;

  // Sanitize colors, falling back to the light palette for any bad/missing value.
  const colors = {};
  for (const k of COLOR_KEYS) colors[k] = safeColor(theme.colors && theme.colors[k]) || BUILTIN.light.colors[k];

  const fonts = theme.fonts || DEFAULT_FONTS;
  const uiSpec = parseFontSpec(fonts.ui) || DEFAULT_FONTS.ui;
  const writerSpec = parseFontSpec(fonts.writer) || DEFAULT_FONTS.writer;
  const fontUrl = googleFontsUrl([uiSpec, writerSpec]);
  const uiFamily = `'${uiSpec.family}', monospace`;

  return { colors, fontUrl, uiFamily };
}

module.exports = { resolveUserTheme };
