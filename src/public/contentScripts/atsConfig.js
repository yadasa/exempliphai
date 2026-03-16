// ATS Config Loader - loads packaged simplify_ats.json for Exempliphai
(function() {
  'use strict';
  window.__SmartApply = window.__SmartApply || {};
  const atsConfig = {};

  const OVERRIDE_KEY = 'EXEMPLIPHAI_ATS_CONFIG_OVERRIDE';

  // Load config from web-accessible resource (MV3), then apply optional local override.
  async function loadConfig() {
    if (atsConfig.loaded) return atsConfig.config;

    let packaged = null;
    try {
      const resp = await fetch(chrome.runtime.getURL('config/simplify_ats.json'));
      packaged = await resp.json();
      console.log('SmartApply: Loaded packaged ATS config with', Object.keys(packaged?.ATS || {}).length, 'ATS');
    } catch (e) {
      console.warn('SmartApply: ATS packaged config load failed:', e);
      packaged = {};
    }

    // Local override (full replace). Keeps everything local-only.
    try {
      const got = await chrome.storage.local.get([OVERRIDE_KEY]);
      const override = got?.[OVERRIDE_KEY];
      if (override && typeof override === 'object') {
        atsConfig.config = override;
        atsConfig.loaded = true;
        console.log('SmartApply: Using ATS config OVERRIDE with', Object.keys(atsConfig.config?.ATS || {}).length, 'ATS');
        return atsConfig.config;
      }
    } catch (e) {
      console.warn('SmartApply: ATS override read failed:', e);
    }

    atsConfig.config = packaged;
    atsConfig.loaded = true;
    return atsConfig.config;
  }

  function _patternToRegex(pattern) {
    const p0 = String(pattern || '').trim();
    if (!p0) return null;

    // The Simplify-derived config uses Chrome match-pattern-like strings, e.g.
    //   *://*.amazon.jobs/*
    //   *://*.indeed.com/jobs?*
    // Convert them to a safe RegExp.
    let schemePrefix = '';
    let p = p0;

    // Treat *:// as http(s) only to avoid accidental matches on chrome-extension:// etc.
    if (p.startsWith('*://')) {
      schemePrefix = 'https?:\\/\\/';
      p = p.slice(4); // remove *://
    }

    // Escape regex metacharacters except '*', then convert '*' → '.*'
    const escaped = p
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    try {
      return new RegExp('^' + schemePrefix + escaped + '$');
    } catch (_) {
      return null;
    }
  }

  // Expose helper for tests/debugging (non-public API).
  atsConfig._patternToRegex = _patternToRegex;
  atsConfig._patternRegexCache = atsConfig._patternRegexCache || new Map();

  function _cachedRegex(pattern) {
    const key = String(pattern || '');
    if (atsConfig._patternRegexCache.has(key)) return atsConfig._patternRegexCache.get(key);
    const rx = _patternToRegex(key);
    atsConfig._patternRegexCache.set(key, rx);
    return rx;
  }

  // Detect ATS key for current URL
  atsConfig.detectATSKeyForUrl = async (url) => {
    const config = await loadConfig();
    const u = String(url || '').trim();
    if (!u) return null;

    for (const [atsKey, atsData] of Object.entries(config.ATS || {})) {
      for (const pattern of atsData.urls || []) {
        const regex = _cachedRegex(pattern);
        if (regex && regex.test(u)) return atsKey;
      }
    }

    for (const [boardKey, boardData] of Object.entries(config.Boards || {})) {
      for (const pattern of boardData.urls || []) {
        const regex = _cachedRegex(pattern);
        if (regex && regex.test(u)) return boardKey;
      }
    }

    return null;
  };

  atsConfig.getATSConfig = async () => await loadConfig();

  window.__SmartApply.atsConfig = atsConfig;
  console.log('SmartApply: ATS Config loader injected');
})();
