/**
 * Mode Plugin System for Cloe Canvas
 *
 * Defines a pluggable mode interface that allows the canvas to behave
 * differently depending on the active "mode" (e.g., code-review, design, etc.).
 *
 * Mode interface:
 *   {
 *     name: string,            // unique mode name
 *     inputs: string[],        // accepted input types (e.g., ['text', 'image'])
 *     tools: string[],         // available tool names (e.g., ['annotate', 'suggest'])
 *     onInput(elements): void, // called when new elements are pasted/added
 *     getCloeContext(elements): string  // format elements for LLM consumption
 *   }
 */

// ==================== In-memory mode registry ====================

const modeRegistry = new Map();  // name → mode object

/** Currently active mode (null = default/free mode) */
let activeMode = null;

/**
 * Register a mode plugin.
 * @param {string} name - Unique mode identifier
 * @param {object} mode - Mode object implementing the Mode interface
 */
export function registerMode(name, mode) {
  if (!name || typeof name !== 'string') {
    console.error('[ModeSystem] registerMode: name must be a non-empty string');
    return;
  }
  if (!mode || typeof mode !== 'object') {
    console.error('[ModeSystem] registerMode: mode must be an object');
    return;
  }
  modeRegistry.set(name, { ...mode, name });
  console.log(`[ModeSystem] Registered mode: ${name}`);
}

/**
 * Switch to a mode by name.
 * @param {string} name - Mode name (or null/undefined to deactivate)
 * @returns {{ ok: boolean, mode: string|null, error?: string }}
 */
export function switchMode(name) {
  if (!name || name === 'default') {
    const prev = activeMode;
    activeMode = null;
    console.log(`[ModeSystem] Switched to default mode (was: ${prev?.name || 'default'})`);
    return { ok: true, mode: null };
  }

  const mode = modeRegistry.get(name);
  if (!mode) {
    console.warn(`[ModeSystem] Unknown mode: ${name}`);
    return { ok: false, mode: activeMode?.name || null, error: `Unknown mode: ${name}` };
  }

  const prev = activeMode;
  activeMode = mode;
  console.log(`[ModeSystem] Switched mode: ${prev?.name || 'default'} → ${name}`);
  return { ok: true, mode: name };
}

/**
 * Get the currently active mode.
 * @returns {object|null}
 */
export function getActiveMode() {
  return activeMode;
}

/**
 * Get the name of the currently active mode.
 * @returns {string|null}
 */
export function getActiveModeName() {
  return activeMode?.name || null;
}

/**
 * Get all registered mode names.
 * @returns {string[]}
 */
export function getRegisteredModes() {
  return [...modeRegistry.keys()];
}

/**
 * Get mode by name.
 * @param {string} name
 * @returns {object|undefined}
 */
export function getMode(name) {
  return modeRegistry.get(name);
}

/**
 * Get the ClOE context string from the active mode.
 * Calls activeMode.getCloeContext(elements) if available.
 * @param {Iterable<object>} elements
 * @returns {string}
 */
export function getCloeContext(elements) {
  if (activeMode && typeof activeMode.getCloeContext === 'function') {
    return activeMode.getCloeContext(elements);
  }
  // Default: serialize elements as JSON
  return JSON.stringify([...elements], null, 2);
}

/**
 * Notify the active mode about new input elements.
 * Calls activeMode.onInput(elements) if available.
 * @param {object[]} elements - newly added elements
 */
export function notifyInput(elements) {
  if (activeMode && typeof activeMode.onInput === 'function') {
    activeMode.onInput(elements);
  }
}
