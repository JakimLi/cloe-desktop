/**
 * Shortcut matching utilities.
 * Parses Electron accelerator strings and matches against KeyboardEvents.
 */

/**
 * Parse an Electron-style accelerator string into modifier flags + key.
 * e.g. "CommandOrControl+Shift+T" → { key: "T", metaKey: true, ... }
 */
export function parseShortcut(stored) {
  if (!stored) return null;
  const parts = stored.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    key: key.toUpperCase(),
    metaKey: parts.some(p => ['cmd', 'commandorcontrol', 'command'].includes(p)),
    ctrlKey: parts.some(p => ['control', 'ctrl'].includes(p)),
    altKey: parts.includes('alt'),
    shiftKey: parts.includes('shift'),
  };
}

/**
 * Check if a KeyboardEvent matches the given accelerator string.
 */
export function matchesShortcut(event, stored) {
  const s = parseShortcut(stored);
  if (!s) return false;
  return (
    event.key.toUpperCase() === s.key &&
    event.metaKey === s.metaKey &&
    event.ctrlKey === s.ctrlKey &&
    event.altKey === s.altKey &&
    event.shiftKey === s.shiftKey
  );
}
