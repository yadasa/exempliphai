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
      console.log('exempliphai: Loaded packaged ATS config with', Object.keys(packaged?.ATS || {}).length, 'ATS');
    } catch (e) {
      console.warn('exempliphai: ATS packaged config load failed:', e);
      packaged = {};
    }

    // Local override (full replace). Keeps everything local-only.
    try {
      const got = await chrome.storage.local.get([OVERRIDE_KEY]);
      const override = got?.[OVERRIDE_KEY];
      if (override && typeof override === 'object') {
        atsConfig.config = override;
        atsConfig.loaded = true;
        console.log('exempliphai: Using ATS config OVERRIDE with', Object.keys(atsConfig.config?.ATS || {}).length, 'ATS');
        return atsConfig.config;
      }
    } catch (e) {
      console.warn('exempliphai: ATS override read failed:', e);
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

  function _inferAtsFromDomOrHost(u) {
    try {
      const url = new URL(String(u || '').trim());
      const host = String(url.hostname || '').toLowerCase();

      // These are intentionally conservative fallbacks; URL patterns remain primary.
      if (host.includes('greenhouse.io')) return { key: 'Greenhouse', score: 0.55, signal: 'host:greenhouse' };
      if (host.includes('jobs.lever.co') || host.includes('lever.co')) return { key: 'Lever', score: 0.55, signal: 'host:lever' };
      if (host.includes('myworkdayjobs.com') || host.includes('workday')) return { key: 'Workday', score: 0.50, signal: 'host:workday' };

      // Light DOM signals (only if document is available)
      const doc = typeof document !== 'undefined' ? document : null;
      if (doc) {
        if (doc.querySelector('meta[name="application-name"][content*="Greenhouse"]')) {
          return { key: 'Greenhouse', score: 0.50, signal: 'dom:meta:greenhouse' };
        }
        if (doc.querySelector('[data-qa*="lever"], a[href*="lever.co"], form[action*="lever"]')) {
          return { key: 'Lever', score: 0.45, signal: 'dom:lever' };
        }
        if (doc.querySelector('[data-automation-id], [data-automation-widget]')) {
          // Workday commonly uses data-automation-id attributes.
          return { key: 'Workday', score: 0.40, signal: 'dom:workday' };
        }
      }
    } catch (_) {}

    return null;
  }

  // Detailed ATS detection with confidence.
  atsConfig.detectATSForUrlDetailed = async (url) => {
    const config = await loadConfig();
    const u = String(url || '').trim();
    if (!u) return { key: null, confidence: 0, source: null, signal: null };

    for (const [atsKey, atsData] of Object.entries(config.ATS || {})) {
      for (const pattern of atsData.urls || []) {
        const regex = _cachedRegex(pattern);
        if (regex && regex.test(u)) return { key: atsKey, confidence: 0.95, source: 'urls', signal: pattern };
      }
    }

    for (const [boardKey, boardData] of Object.entries(config.Boards || {})) {
      for (const pattern of boardData.urls || []) {
        const regex = _cachedRegex(pattern);
        if (regex && regex.test(u)) return { key: boardKey, confidence: 0.9, source: 'boards.urls', signal: pattern };
      }
    }

    const inf = _inferAtsFromDomOrHost(u);
    if (inf && config.ATS && Object.prototype.hasOwnProperty.call(config.ATS, inf.key)) {
      return { key: inf.key, confidence: inf.score, source: 'heuristic', signal: inf.signal };
    }

    return { key: null, confidence: 0, source: null, signal: null };
  };

  // Detect ATS key for current URL (back-compat string API)
  atsConfig.detectATSKeyForUrl = async (url) => {
    const det = await atsConfig.detectATSForUrlDetailed(url);
    return det?.key || null;
  };

  atsConfig.getATSConfig = async () => await loadConfig();

  window.__SmartApply.atsConfig = atsConfig;
  console.log('exempliphai: ATS Config loader injected');
})();
