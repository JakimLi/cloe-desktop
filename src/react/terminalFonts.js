/**
 * Terminal Fonts
 * Curated list of popular monospace fonts.
 * Each font provides a CSS font-family value with sensible fallbacks.
 * No font files are bundled — relies on fonts already installed on the system;
 * if a font is missing, the browser falls back to the next monospace in the chain.
 */

export const TERMINAL_FONTS = [
  {
    id: 'sfmono',
    name: 'SF Mono',
    family: "'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
    desc: 'Apple system mono — clean & crisp',
  },
  {
    id: 'menlo',
    name: 'Menlo',
    family: "'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
    desc: 'macOS default coding font',
  },
  {
    id: 'monaco',
    name: 'Monaco',
    family: "'Monaco', 'Menlo', 'Consolas', monospace",
    desc: 'Classic macOS monospace',
  },
  {
    id: 'jetbrainsmono',
    name: 'JetBrains Mono',
    family: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace",
    desc: 'Designed for developers, ligatures',
  },
  {
    id: 'firacode',
    name: 'Fira Code',
    family: "'Fira Code', 'SF Mono', 'Menlo', monospace",
    desc: 'Ligatures, geometric',
  },
  {
    id: 'cascadiacode',
    name: 'Cascadia Code',
    family: "'Cascadia Code', 'SF Mono', 'Menlo', monospace",
    desc: 'Microsoft Terminal font',
  },
  {
    id: 'iosevka',
    name: 'Iosevka',
    family: "'Iosevka', 'SF Mono', 'Menlo', monospace",
    desc: 'Slim, narrow, highly readable',
  },
  {
    id: 'sourcecodepro',
    name: 'Source Code Pro',
    family: "'Source Code Pro', 'SF Mono', 'Menlo', monospace",
    desc: 'Adobe monospace classic',
  },
  {
    id: 'hack',
    name: 'Hack',
    family: "'Hack', 'SF Mono', 'Menlo', monospace",
    desc: 'Open source, hand-tuned',
  },
  {
    id: 'meslo',
    name: 'Meslo LG',
    family: "'Meslo LG S', 'Meslo LG M', 'Meslo LG', 'Menlo', monospace",
    desc: 'Powerline-patched friendly',
  },
];

export const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];

export const DEFAULT_FONT_ID = 'sfmono';
export const DEFAULT_FONT_SIZE = 14;

export function getFontById(id) {
  return TERMINAL_FONTS.find(f => f.id === id) || TERMINAL_FONTS[0];
}
