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

  // Detect ATS key for current URL
  atsConfig.detectATSKeyForUrl = async (url) => {
    const config = await loadConfig();
    for (const [atsKey, atsData] of Object.entries(config.ATS || {})) {
      for (const pattern of atsData.urls || []) {
        try {
          const regex = new RegExp(pattern.replace(/\\\*/g, '.*').replace(/\*\//g, ''));
          if (regex.test(url)) return atsKey;
        } catch {}
      }
    }
    for (const [boardKey, boardData] of Object.entries(config.Boards || {})) {
      // similar for boards
      for (const pattern of boardData.urls || []) {
        try {
          const regex = new RegExp(pattern.replace(/\\\*/g, '.*'));
          if (regex.test(url)) return boardKey;
        } catch {}
      }
    }
    return null;
  };

  atsConfig.getATSConfig = async () => await loadConfig();

  window.__SmartApply.atsConfig = atsConfig;
  console.log('SmartApply: ATS Config loader injected');
})();
