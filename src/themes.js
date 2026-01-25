// Theme definitions for justtype
// Each theme has an id, name, and colors object
// Custom themes can be loaded from localStorage

// Required color keys for a valid theme
const requiredColorKeys = [
  'bg', 'bgSecondary', 'bgTertiary',
  'text', 'textMuted', 'textDim',
  'border', 'borderLight', 'accent',
  'blue', 'orange', 'red', 'green'
];

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
    }
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
    }
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
    }
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
    }
  }
};

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

  return { valid: errors.length === 0, errors };
};

// Add a custom theme
export const addCustomTheme = (theme) => {
  const validation = validateTheme(theme);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  const customThemes = getCustomThemes();
  customThemes[theme.id] = {
    id: theme.id,
    name: theme.name,
    colors: { ...theme.colors }
  };
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
    }
  };
};
