// Command registry for justtype command palette
// Designed to be CLI-compatible: `justtype <command> [args]`

import { getThemeIds } from './themes';

// Command definitions
export const commands = {
  // Navigation
  new: {
    id: 'new',
    aliases: ['create', 'slate new', '+'],
    title: 'new slate',
    description: 'create a new slate',
    icon: '+',
    category: 'navigation',
    shortcut: null,
    context: ['writer', 'slates', 'account'],
    requiresAuth: false,
    action: 'NEW_SLATE',
    cli: 'justtype new'
  },
  slates: {
    id: 'slates',
    aliases: ['list', 'my slates', '='],
    title: 'my slates',
    description: 'view all saved slates',
    icon: '=',
    category: 'navigation',
    shortcut: null,
    context: ['writer', 'account'],
    requiresAuth: true,
    action: 'NAVIGATE_SLATES',
    cli: 'justtype list'
  },
  account: {
    id: 'account',
    aliases: ['profile', 'settings', '@'],
    title: 'account',
    description: 'open account settings',
    icon: '@',
    category: 'navigation',
    shortcut: null,
    context: ['writer', 'slates'],
    requiresAuth: true,
    action: 'NAVIGATE_ACCOUNT',
    cli: 'justtype account'
  },

  // Actions
  save: {
    id: 'save',
    aliases: ['save slate', '!'],
    title: 'save',
    description: 'save current slate',
    icon: '!',
    category: 'actions',
    shortcut: 'Cmd+S',
    context: ['writer'],
    requiresAuth: true,
    action: 'SAVE',
    cli: 'justtype save'
  },
  share: {
    id: 'share',
    aliases: ['publish', 'make public', '^'],
    title: 'share',
    description: 'publish or share current slate',
    icon: '^',
    category: 'actions',
    shortcut: null,
    context: ['writer'],
    requiresAuth: true,
    requiresSlate: true,
    action: 'SHARE',
    cli: 'justtype share'
  },
  export: {
    id: 'export',
    aliases: ['download', 'save as', 'v'],
    title: 'export',
    description: 'export current slate',
    icon: 'v',
    category: 'actions',
    shortcut: 'Cmd+E',
    context: ['writer'],
    requiresAuth: false,
    action: 'EXPORT_MENU',
    hasSubCommands: true,
    cli: 'justtype export [format]'
  },
  'export txt': {
    id: 'export-txt',
    parent: 'export',
    title: 'export as text (.txt)',
    action: 'EXPORT',
    payload: 'txt',
    cli: 'justtype export txt'
  },
  'export md': {
    id: 'export-md',
    parent: 'export',
    title: 'export as markdown (.md)',
    action: 'EXPORT',
    payload: 'md',
    cli: 'justtype export md'
  },
  'export pdf': {
    id: 'export-pdf',
    parent: 'export',
    title: 'export as PDF',
    shortcut: 'Cmd+P',
    action: 'EXPORT',
    payload: 'pdf',
    cli: 'justtype export pdf'
  },
  'export html': {
    id: 'export-html',
    parent: 'export',
    title: 'export as HTML',
    action: 'EXPORT',
    payload: 'html',
    cli: 'justtype export html'
  },

  // Settings
  theme: {
    id: 'theme',
    aliases: ['color', 'mode', 'o'],
    title: 'theme',
    description: 'change color theme',
    icon: 'o',
    category: 'settings',
    shortcut: null,
    context: ['writer', 'slates', 'account'],
    requiresAuth: false,
    action: 'THEME_MENU',
    hasSubCommands: true,
    cli: 'justtype theme [name]'
  },
  zen: {
    id: 'zen',
    aliases: ['distraction free', 'minimal', 'O'],
    title: 'zen mode',
    description: 'toggle zen mode',
    icon: 'O',
    category: 'settings',
    shortcut: null,
    context: ['writer'],
    requiresAuth: false,
    action: 'TOGGLE_ZEN',
    cli: 'justtype zen'
  },
  focus: {
    id: 'focus',
    aliases: ['smart focus', 'auto focus', '*'],
    title: 'focus mode',
    description: 'set focus mode behavior',
    icon: '*',
    category: 'settings',
    shortcut: null,
    context: ['writer'],
    requiresAuth: false,
    action: 'FOCUS_MENU',
    hasSubCommands: true,
    cli: 'justtype focus [off|on|auto]'
  },
  'focus off': {
    id: 'focus-off',
    parent: 'focus',
    title: 'focus off',
    action: 'SET_FOCUS',
    payload: 'off',
    cli: 'justtype focus off'
  },
  'focus on': {
    id: 'focus-on',
    parent: 'focus',
    title: 'focus on',
    action: 'SET_FOCUS',
    payload: 'on',
    cli: 'justtype focus on'
  },
  'focus auto': {
    id: 'focus-auto',
    parent: 'focus',
    title: 'smart focus (auto)',
    action: 'SET_FOCUS',
    payload: 'auto',
    cli: 'justtype focus auto'
  },
};

// Generate theme sub-commands dynamically
export function getThemeCommands() {
  const themeCommands = {};
  getThemeIds().forEach(themeId => {
    themeCommands[`theme ${themeId}`] = {
      id: `theme-${themeId}`,
      parent: 'theme',
      title: themeId,
      action: 'SET_THEME',
      payload: themeId,
      cli: `justtype theme ${themeId}`
    };
  });
  return themeCommands;
}

// Get all commands including dynamic ones
export function getAllCommands() {
  return { ...commands, ...getThemeCommands() };
}

// Fuzzy search scoring
function calculateScore(command, query) {
  const q = query.toLowerCase();
  const id = command.id.toLowerCase();
  const title = command.title.toLowerCase();
  const aliases = (command.aliases || []).map(a => a.toLowerCase());

  // Exact match
  if (id === q || title === q) return 100;

  // Alias exact match
  if (aliases.some(a => a === q)) return 95;

  // Starts with
  if (id.startsWith(q)) return 90;
  if (title.startsWith(q)) return 85;
  if (aliases.some(a => a.startsWith(q))) return 80;

  // Contains
  if (id.includes(q)) return 70;
  if (title.includes(q)) return 65;
  if (aliases.some(a => a.includes(q))) return 60;

  // Fuzzy character match
  let score = 0;
  let queryIdx = 0;
  const searchText = `${id} ${title} ${aliases.join(' ')}`;
  for (const char of searchText) {
    if (queryIdx < q.length && char === q[queryIdx]) {
      score += 5;
      queryIdx++;
    }
  }
  return queryIdx === q.length ? Math.min(score, 50) : 0;
}

// Search commands
export function searchCommands(query, context = {}) {
  const allCommands = getAllCommands();
  const q = query.toLowerCase().trim();

  // Filter available commands
  const available = Object.values(allCommands).filter(cmd => {
    // Skip sub-commands in main search unless query matches
    if (cmd.parent && !q.includes(cmd.parent)) return false;

    // Check context
    if (cmd.context && !cmd.context.includes(context.view)) return false;

    // Check auth requirement
    if (cmd.requiresAuth && !context.token) return false;

    // Check slate requirement
    if (cmd.requiresSlate && !context.currentSlate) return false;

    return true;
  });

  if (!q) {
    // Return all available non-sub commands, grouped by category
    return available.filter(cmd => !cmd.parent);
  }

  // Score and sort
  return available
    .map(cmd => ({ ...cmd, score: calculateScore(cmd, q) }))
    .filter(cmd => cmd.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Get sub-commands for a parent
export function getSubCommands(parentId) {
  const allCommands = getAllCommands();
  return Object.values(allCommands).filter(cmd => cmd.parent === parentId);
}

// Group commands by category
export function groupByCategory(cmds) {
  const groups = {};
  const order = ['navigation', 'actions', 'settings'];

  cmds.forEach(cmd => {
    const cat = cmd.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(cmd);
  });

  // Return in order
  return order
    .filter(cat => groups[cat]?.length > 0)
    .map(cat => ({ category: cat, commands: groups[cat] }));
}
