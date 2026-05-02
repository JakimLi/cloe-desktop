// ==================== Cloe Action Manager — i18n ====================

const I18n = (() => {
  const SUPPORTED = ['zh-CN', 'en-US'];
  const STORAGE_KEY = 'cloe-manager-lang';
  let currentLocale = '';
  let messages = {};

  /**
   * Detect best locale: localStorage > navigator.language > fallback
   */
  function detectLocale() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;

    const nav = navigator.language || 'zh-CN';
    // Match e.g. "zh-Hans-CN" -> "zh-CN", "en" -> "en-US"
    if (nav.startsWith('zh')) return 'zh-CN';
    if (nav.startsWith('en')) return 'en-US';

    // Fallback to first supported
    return SUPPORTED[0];
  }

  /**
   * Simple template interpolation: {{key}}
   */
  function interpolate(str, data) {
    if (!data || typeof str !== 'string') return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] !== undefined ? data[key] : `{{${key}}}`);
  }

  /**
   * Get translated message by dot-path key
   */
  function t(key, data) {
    const keys = key.split('.');
    let value = messages;
    for (const k of keys) {
      if (value == null) return key;
      value = value[k];
    }
    if (typeof value === 'string') return interpolate(value, data);
    if (typeof value === 'object') return JSON.stringify(value);
    return key;
  }

  /**
   * Load locale messages
   */
  async function loadLocale(locale) {
    const resp = await fetch(`./locales/${locale}.json`);
    if (!resp.ok) throw new Error(`Failed to load locale: ${locale}`);
    return resp.json();
  }

  /**
   * Initialize i18n. Returns the detected locale.
   * Call this once before rendering.
   */
  async function init() {
    currentLocale = detectLocale();
    messages = await loadLocale(currentLocale);
    document.documentElement.lang = currentLocale;
    return currentLocale;
  }

  /**
   * Switch locale and reload messages.
   * Returns the new locale.
   */
  async function switchLocale(locale) {
    if (!SUPPORTED.includes(locale)) locale = detectLocale();
    currentLocale = locale;
    localStorage.setItem(STORAGE_KEY, locale);
    messages = await loadLocale(locale);
    document.documentElement.lang = locale;
    return locale;
  }

  /**
   * Get the label to show on the language switch button
   * (the *other* language, so user knows what they'll switch to)
   */
  function getSwitchLabel() {
    return currentLocale === 'zh-CN' ? t('i18n.switchToEn') : t('i18n.switchToZh');
  }

  /**
   * Get the locale to switch to (the *other* one)
   */
  function getSwitchLocale() {
    return currentLocale === 'zh-CN' ? 'en-US' : 'zh-CN';
  }

  function getLocale() {
    return currentLocale;
  }

  return { init, switchLocale, t, getSwitchLabel, getSwitchLocale, getLocale, SUPPORTED };
})();

// Expose globally
window.I18n = I18n;
