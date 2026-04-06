// ATS Config Loader - loads a tiny packaged bootstrap config + fetches full modules from server
(function() {
  'use strict';
  window.__SmartApply = window.__SmartApply || {};
  const atsConfig = {};

  const OVERRIDE_KEY = 'EXEMPLIPHAI_ATS_CONFIG_OVERRIDE';
  const CACHE_KEY = 'EXEMPLIPHAI_ATS_CONFIG_CACHE_V1';

  async function _sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return resolve({ ok: false, error: String(err.message || err) });
          resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  async function _loadBootstrap() {
    try {
      const resp = await fetch(chrome.runtime.getURL('config/ats_bootstrap.json'));
      const json = await resp.json();
      console.log('exempliphai: Loaded ATS bootstrap config with', Object.keys(json?.ATS || {}).length, 'ATS');
      return json;
    } catch (e) {
      console.warn('exempliphai: ATS bootstrap load failed:', e);
      return {};
    }
  }

  async function _loadCachedModule() {
    try {
      const got = await chrome.storage.local.get([CACHE_KEY]);
      const c = got?.[CACHE_KEY];
      if (c && typeof c === 'object' && c.config && typeof c.config === 'object') {
        return c;
      }
    } catch (_) {}
    return null;
  }

  async function _cacheModule({ config, etag, version, fetchedAtMs }) {
    try {
      await chrome.storage.local.set({
        [CACHE_KEY]: {
          config,
          etag: etag || null,
          version: version || null,
          fetchedAtMs: Number.isFinite(fetchedAtMs) ? fetchedAtMs : Date.now(),
        },
      });
    } catch (e) {
      console.warn('exempliphai: ATS module cache write failed:', e);
    }
  }

  async function _maybeRefreshFullModuleInBackground(cached) {
    // Best-effort refresh. If user isn't authed yet, this will fail quietly.
    try {
      const resp = await _sendMessage({ action: 'ATS_MODULE', atsKey: 'FULL', variant: 'default', ifNoneMatch: cached?.etag || null });
      if (!resp || resp.ok === false) return;
      if (resp.status === 304) return;
      if (resp.config && typeof resp.config === 'object') {
        await _cacheModule({ config: resp.config, etag: resp.etag, version: resp.version, fetchedAtMs: Date.now() });
        // If we've already loaded config into memory, swap it for future calls.
        atsConfig.config = resp.config;
        atsConfig.loaded = true;
        console.log('exempliphai: Refreshed ATS module from server:', resp.version || '(no version)');
      }
    } catch (_) {}
  }

  // Load config in this precedence order:
  // 1) local override (developer/debug)
  // 2) cached full module (previous fetch)
  // 3) packaged bootstrap
  // Also: kick off a best-effort background refresh of the full module.
  async function loadConfig() {
    if (atsConfig.loaded) return atsConfig.config;

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

    const cached = await _loadCachedModule();
    if (cached?.config) {
      atsConfig.config = cached.config;
      atsConfig.loaded = true;
      console.log('exempliphai: Loaded cached ATS module with', Object.keys(atsConfig.config?.ATS || {}).length, 'ATS');
      // Refresh in the background (non-blocking)
      void _maybeRefreshFullModuleInBackground(cached);
      return atsConfig.config;
    }

    // Bootstrap fallback
    atsConfig.config = await _loadBootstrap();
    atsConfig.loaded = true;

    // Try to fetch full module in background after bootstrap (non-blocking)
    void _maybeRefreshFullModuleInBackground(null);

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
