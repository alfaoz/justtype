// Theme definitions for justtype
// Each theme has an id, name, colors object, and optional fonts object
// Custom themes can be loaded from localStorage

// Required color keys for a valid theme
const requiredColorKeys = [
  'bg', 'bgSecondary', 'bgTertiary',
  'text', 'textMuted', 'textDim',
  'border', 'borderLight', 'accent',
  'blue', 'orange', 'red', 'green'
];

// Default fonts (JetBrains Mono)
const defaultFonts = {
  ui: { family: 'JetBrains Mono', weights: [300, 400, 500] },
  writer: { family: 'JetBrains Mono', weights: [300, 400, 500] }
};

// Sepia fonts (Lora for UI, EB Garamond for writer)
const sepiaFonts = {
  ui: { family: 'Lora', weights: [400, 500, 600] },
  writer: { family: 'EB Garamond', weights: [400, 500] }
};

export const builtInThemes = {
  dark: {
    id: 'dark',
    name: 'dark',
    colors: {
      bg: '#111111',
      bgSecondary: '#1a1a1a',
      bgTertiary: '#222222',
      text: '#d4d4d4',
      textMuted: '#a0a0a0',
      textDim: '#666666',
      border: '#333333',
      borderLight: '#222222',
      accent: '#ffffff',
      // Semantic colors
      blue: '#60a5fa',
      orange: '#fb923c',
      red: '#f87171',
      green: '#4ade80',
    },
    fonts: defaultFonts
  },
  light: {
    id: 'light',
    name: 'light',
    colors: {
      bg: '#faf9f7',
      bgSecondary: '#ffffff',
      bgTertiary: '#f0efed',
      text: '#1a1a1a',
      textMuted: '#4a4a4a',
      textDim: '#888888',
      border: '#d4d2cf',
      borderLight: '#e8e7e5',
      accent: '#1a1a1a',
      // Semantic colors
      blue: '#0066cc',
      orange: '#b85c00',
      red: '#b33000',
      green: '#008800',
    },
    fonts: defaultFonts
  },
  sepia: {
    id: 'sepia',
    name: 'sepia',
    colors: {
      bg: '#f4ecd8',
      bgSecondary: '#faf6eb',
      bgTertiary: '#ebe4d0',
      text: '#5c4b37',
      textMuted: '#7a6b5a',
      textDim: '#9a8b7a',
      border: '#d4c4a8',
      borderLight: '#e0d4be',
      accent: '#3d2e1f',
      // Semantic colors
      blue: '#2563eb',
      orange: '#c2410c',
      red: '#b91c1c',
      green: '#15803d',
    },
    fonts: sepiaFonts
  },
  midnight: {
    id: 'midnight',
    name: 'midnight',
    colors: {
      bg: '#0a0a14',
      bgSecondary: '#12121e',
      bgTertiary: '#1a1a28',
      text: '#c8c8d4',
      textMuted: '#8888a0',
      textDim: '#55556a',
      border: '#2a2a3a',
      borderLight: '#1e1e2a',
      accent: '#e0e0f0',
      // Semantic colors
      blue: '#6366f1',
      orange: '#f59e0b',
      red: '#ef4444',
      green: '#22c55e',
    },
    fonts: defaultFonts
  }
};

// Track loaded fonts to avoid re-loading
const loadedFonts = new Set();
// Track font load errors for notification
let fontLoadError = null;

// Parse font specification - accepts various formats:
// - Just name: "EB Garamond"
// - Name with weights: "EB Garamond:wght@400;700"
// - Google Fonts URL: "https://fonts.google.com/specimen/EB+Garamond"
// - Object: { family: "EB Garamond", weights: [400, 500] }
export const parseFontSpec = (spec) => {
  if (!spec) return null;

  // Already an object with family
  if (typeof spec === 'object' && spec.family) {
    return {
      family: spec.family,
      weights: spec.weights || [400],
      style: spec.style || 'normal'
    };
  }

  if (typeof spec !== 'string') return null;

  // Google Fonts URL: https://fonts.google.com/specimen/EB+Garamond?query=...
  if (spec.includes('fonts.google.com/specimen/')) {
    const match = spec.match(/specimen\/([^?]+)/);
    if (match) {
      const family = decodeURIComponent(match[1].replace(/\+/g, ' '));
      return { family, weights: [400, 500], style: 'normal' };
    }
  }

  // Format: "Font Name:wght@400;500;700"
  if (spec.includes(':wght@')) {
    const [family, weightStr] = spec.split(':wght@');
    const weights = weightStr.split(';').map(w => parseInt(w, 10)).filter(w => !isNaN(w));
    return { family: family.trim(), weights: weights.length ? weights : [400], style: 'normal' };
  }

  // Just a font name
  return { family: spec.trim(), weights: [400], style: 'normal' };
};

// Generate Google Fonts import URL
const generateGoogleFontsUrl = (fonts) => {
  const families = [];

  for (const font of fonts) {
    if (!font || !font.family) continue;
    const familyName = font.family.replace(/ /g, '+');
    const weights = font.weights?.join(';') || '400';
    families.push(`family=${familyName}:wght@${weights}`);
  }

  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
};

// Load fonts for a theme
export const loadThemeFonts = async (theme) => {
  fontLoadError = null;

  const fonts = theme.fonts || defaultFonts;
  const uiFont = parseFontSpec(fonts.ui);
  const writerFont = parseFontSpec(fonts.writer);

  const fontsToLoad = [uiFont, writerFont].filter(f => f && f.family);

  // Filter out already loaded fonts
  const newFonts = fontsToLoad.filter(f => !loadedFonts.has(f.family));

  if (newFonts.length === 0) return { success: true };

  const url = generateGoogleFontsUrl(newFonts);
  if (!url) return { success: true };

  // Check if stylesheet already exists
  const existingLink = document.querySelector(`link[href="${url}"]`);
  if (existingLink) {
    newFonts.forEach(f => loadedFonts.add(f.family));
    return { success: true };
  }

  // Create and inject stylesheet
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;

  return new Promise((resolve) => {
    link.onload = () => {
      newFonts.forEach(f => loadedFonts.add(f.family));
      resolve({ success: true });
    };
    link.onerror = () => {
      const failedFonts = newFonts.map(f => f.family).join(', ');
      fontLoadError = `failed to load font: ${failedFonts}`;
      resolve({ success: false, error: fontLoadError });
    };
    document.head.appendChild(link);
  });
};

// Get last font load error (for UI notification)
export const getFontLoadError = () => fontLoadError;
export const clearFontLoadError = () => { fontLoadError = null; };

// Get custom themes from localStorage
const getCustomThemes = () => {
  try {
    const stored = localStorage.getItem('justtype-custom-themes');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save custom themes to localStorage
const saveCustomThemes = (themes) => {
  localStorage.setItem('justtype-custom-themes', JSON.stringify(themes));
};

// Get list of all theme ids (built-in + custom)
export const getThemeIds = () => {
  const customThemes = getCustomThemes();
  return [...Object.keys(builtInThemes), ...Object.keys(customThemes)];
};

// Get theme by id (checks built-in first, then custom)
export const getTheme = (id) => {
  if (builtInThemes[id]) return builtInThemes[id];
  const customThemes = getCustomThemes();
  if (customThemes[id]) return customThemes[id];
  return builtInThemes.dark;
};

// Check if theme exists
export const themeExists = (id) => {
  const customThemes = getCustomThemes();
  return id in builtInThemes || id in customThemes;
};

// Check if theme is custom (can be deleted)
export const isCustomTheme = (id) => {
  const customThemes = getCustomThemes();
  return id in customThemes;
};

// Validate theme structure
export const validateTheme = (theme) => {
  const errors = [];

  if (!theme || typeof theme !== 'object') {
    return { valid: false, errors: ['theme must be an object'] };
  }

  if (!theme.id || typeof theme.id !== 'string') {
    errors.push('theme must have a string "id"');
  } else if (theme.id in builtInThemes) {
    errors.push(`"${theme.id}" is a built-in theme name, choose a different id`);
  } else if (!/^[a-z0-9-]+$/.test(theme.id)) {
    errors.push('id must be lowercase letters, numbers, and hyphens only');
  }

  if (!theme.name || typeof theme.name !== 'string') {
    errors.push('theme must have a string "name"');
  }

  if (!theme.colors || typeof theme.colors !== 'object') {
    errors.push('theme must have a "colors" object');
  } else {
    const missingKeys = requiredColorKeys.filter(key => !theme.colors[key]);
    if (missingKeys.length > 0) {
      errors.push(`missing color keys: ${missingKeys.join(', ')}`);
    }

    // Validate hex colors
    const invalidColors = requiredColorKeys.filter(key => {
      const color = theme.colors[key];
      return color && !/^#[0-9a-fA-F]{6}$/.test(color);
    });
    if (invalidColors.length > 0) {
      errors.push(`invalid hex colors: ${invalidColors.join(', ')} (use #rrggbb format)`);
    }
  }

  // Validate fonts (optional)
  if (theme.fonts) {
    if (typeof theme.fonts !== 'object') {
      errors.push('fonts must be an object with "ui" and/or "writer" keys');
    } else {
      // Validate font specs can be parsed
      for (const key of ['ui', 'writer']) {
        if (theme.fonts[key]) {
          const parsed = parseFontSpec(theme.fonts[key]);
          if (!parsed) {
            errors.push(`invalid font spec for "${key}"`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

// Add a custom theme
export const addCustomTheme = (theme) => {
  const validation = validateTheme(theme);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const customThemes = getCustomThemes();
  const themeToSave = {
    id: theme.id,
    name: theme.name,
    colors: { ...theme.colors }
  };

  // Save fonts if provided
  if (theme.fonts) {
    themeToSave.fonts = {};
    if (theme.fonts.ui) themeToSave.fonts.ui = theme.fonts.ui;
    if (theme.fonts.writer) themeToSave.fonts.writer = theme.fonts.writer;
  }

  customThemes[theme.id] = themeToSave;
  saveCustomThemes(customThemes);

  return { success: true };
};

// Remove a custom theme
export const removeCustomTheme = (id) => {
  if (id in builtInThemes) {
    return { success: false, error: 'cannot remove built-in themes' };
  }

  const customThemes = getCustomThemes();
  if (!(id in customThemes)) {
    return { success: false, error: 'theme not found' };
  }

  delete customThemes[id];
  saveCustomThemes(customThemes);

  return { success: true };
};

// Get example theme JSON for download
export const getExampleThemeJson = () => {
  return {
    id: 'my-custom-theme',
    name: 'my custom theme',
    colors: {
      bg: '#1a1a2e',
      bgSecondary: '#16213e',
      bgTertiary: '#0f3460',
      text: '#e8e8e8',
      textMuted: '#a0a0a0',
      textDim: '#606060',
      border: '#0f3460',
      borderLight: '#16213e',
      accent: '#e94560',
      blue: '#4cc9f0',
      orange: '#f77f00',
      red: '#e94560',
      green: '#06d6a0'
    },
    fonts: {
      // Font options:
      // - Just font name: "Inter"
      // - With weights: "Inter:wght@400;500;700"
      // - Google Fonts URL: "https://fonts.google.com/specimen/Inter"
      // - Object: { family: "Inter", weights: [400, 500, 700] }
      ui: { family: 'JetBrains Mono', weights: [400, 500] },
      writer: { family: 'JetBrains Mono', weights: [400, 500] }
    }
  };
};

// Apply theme CSS variables to document root
// This works for both built-in and custom themes
export const applyThemeVariables = async (themeId) => {
  const theme = getTheme(themeId);
  const root = document.documentElement;

  // Set color CSS variables
  root.style.setProperty('--theme-bg', theme.colors.bg);
  root.style.setProperty('--theme-bg-secondary', theme.colors.bgSecondary);
  root.style.setProperty('--theme-bg-tertiary', theme.colors.bgTertiary);
  root.style.setProperty('--theme-text', theme.colors.text);
  root.style.setProperty('--theme-text-muted', theme.colors.textMuted);
  root.style.setProperty('--theme-text-dim', theme.colors.textDim);
  root.style.setProperty('--theme-border', theme.colors.border);
  root.style.setProperty('--theme-border-light', theme.colors.borderLight);
  root.style.setProperty('--theme-accent', theme.colors.accent);
  root.style.setProperty('--theme-blue', theme.colors.blue);
  root.style.setProperty('--theme-orange', theme.colors.orange);
  root.style.setProperty('--theme-red', theme.colors.red);
  root.style.setProperty('--theme-green', theme.colors.green);

  // Load and apply fonts
  const fonts = theme.fonts || defaultFonts;
  const uiFont = parseFontSpec(fonts.ui);
  const writerFont = parseFontSpec(fonts.writer);

  // Set font CSS variables (with fallbacks)
  const uiFontFamily = uiFont ? `'${uiFont.family}', monospace` : "'JetBrains Mono', monospace";
  const writerFontFamily = writerFont ? `'${writerFont.family}', monospace` : "'JetBrains Mono', monospace";

  root.style.setProperty('--theme-font-ui', uiFontFamily);
  root.style.setProperty('--theme-font-writer', writerFontFamily);

  // Load fonts asynchronously (don't block theme application)
  loadThemeFonts(theme);

  // Also apply body classes for backwards compatibility with existing CSS overrides
  // Remove all theme classes first
  document.body.classList.remove('light-mode', 'sepia-mode', 'midnight-mode', 'custom-theme');

  // Apply the appropriate theme class for built-in themes
  if (themeId === 'light') {
    document.body.classList.add('light-mode');
  } else if (themeId === 'sepia') {
    document.body.classList.add('sepia-mode');
  } else if (themeId === 'midnight') {
    document.body.classList.add('midnight-mode');
  } else if (isCustomTheme(themeId)) {
    // Custom themes get a generic class
    document.body.classList.add('custom-theme');
  }
  // 'dark' is the default, no class needed
};
