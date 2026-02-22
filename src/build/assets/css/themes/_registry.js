/**
 * Theme registry for Vanilla Press.
 *
 * Themes sourced from Vanilla Breeze's token system.
 * Each theme file uses `[data-theme~="name"]` selectors.
 * The bridge CSS maps VB tokens → VP tokens.
 *
 * Categories:
 * - color: Override brand hues only
 * - personality: Transform entire design feel
 * - extreme: Dramatic visual transformations
 *
 * @module build/assets/css/themes/_registry
 */

export const themes = [
  // Default (no theme file — uses base _tokens.css)
  { id: 'default', name: 'Default', file: null, category: 'default' },

  // Color themes
  { id: 'ocean', name: 'Ocean', file: 'ocean.css', category: 'color' },
  { id: 'forest', name: 'Forest', file: 'forest.css', category: 'color' },
  { id: 'sunset', name: 'Sunset', file: 'sunset.css', category: 'color' },
  { id: 'rose', name: 'Rose', file: 'rose.css', category: 'color' },
  { id: 'lavender', name: 'Lavender', file: 'lavender.css', category: 'color' },
  { id: 'coral', name: 'Coral', file: 'coral.css', category: 'color' },
  { id: 'slate', name: 'Slate', file: 'slate.css', category: 'color' },
  { id: 'emerald', name: 'Emerald', file: 'emerald.css', category: 'color' },
  { id: 'amber', name: 'Amber', file: 'amber.css', category: 'color' },
  { id: 'indigo', name: 'Indigo', file: 'indigo.css', category: 'color' },

  // Personality themes
  { id: 'modern', name: 'Modern', file: 'modern.css', category: 'personality' },
  { id: 'minimal', name: 'Minimal', file: 'minimal.css', category: 'personality' },
  { id: 'classic', name: 'Classic', file: 'classic.css', category: 'personality' },

  // Extreme themes
  { id: 'brutalist', name: 'Brutalist', file: 'brutalist.css', category: 'extreme' },
  { id: 'swiss', name: 'Swiss', file: 'swiss.css', category: 'extreme' },
  { id: 'cyber', name: 'Cyber', file: 'cyber.css', category: 'extreme' },
  { id: 'organic', name: 'Organic', file: 'organic.css', category: 'extreme' },
  { id: 'editorial', name: 'Editorial', file: 'editorial.css', category: 'extreme' },
  { id: 'terminal', name: 'Terminal', file: 'terminal.css', category: 'extreme' },
  { id: 'kawaii', name: 'Kawaii', file: 'kawaii.css', category: 'extreme' },
  { id: '8bit', name: '8-Bit', file: '8bit.css', category: 'extreme' },
  { id: 'nes', name: 'NES', file: 'nes.css', category: 'extreme' },
  { id: 'win9x', name: 'Win9x', file: 'win9x.css', category: 'extreme' },
];
