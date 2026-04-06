const KEY = 'EXEMPLIPHAI_ATS_CONFIG_OVERRIDE';

function setStatus(msg, cls) {
  const el = document.getElementById('status');
  el.className = 'badge';
  if (cls === 'ok') el.classList.add('ok');
  if (cls === 'err') el.classList.add('err');
  el.textContent = msg;
}

async function loadDefault() {
  // The extension no longer ships the full simplify_ats.json.
  // Prefer the cached full module if present; otherwise fall back to the tiny bootstrap config.
  const CACHE_KEY = 'EXEMPLIPHAI_ATS_CONFIG_CACHE_V1';

  try {
    const got = await chrome.storage.local.get([CACHE_KEY]);
    const cached = got?.[CACHE_KEY];
    if (cached?.config && typeof cached.config === 'object') {
      document.getElementById('json').value = JSON.stringify(cached.config, null, 2);
      setStatus('Loaded cached server ATS module.', 'ok');
      return;
    }
  } catch (_) {}

  const url = chrome.runtime.getURL('config/ats_bootstrap.json');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load packaged bootstrap config: ' + res.status);
  const json = await res.json();
  document.getElementById('json').value = JSON.stringify(json, null, 2);
  setStatus('Loaded packaged bootstrap config.', 'ok');
}

async function loadOverride() {
  const { [KEY]: cfg } = await chrome.storage.local.get([KEY]);
  document.getElementById('json').value = cfg ? JSON.stringify(cfg, null, 2) : '';
  setStatus(cfg ? 'Loaded override.' : 'No override saved.', cfg ? 'ok' : '');
}

async function saveOverride() {
  const raw = document.getElementById('json').value.trim();
  if (!raw) {
    setStatus('Nothing to save.', 'err');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    setStatus('Invalid JSON: ' + e.message, 'err');
    return;
  }
  await chrome.storage.local.set({ [KEY]: parsed });
  setStatus('Saved override.', 'ok');
}

async function clearOverride() {
  await chrome.storage.local.remove([KEY]);
  setStatus('Cleared override.', 'ok');
}

document.getElementById('load-default').addEventListener('click', () => loadDefault().catch(e => setStatus(String(e), 'err')));
document.getElementById('load').addEventListener('click', () => loadOverride().catch(e => setStatus(String(e), 'err')));
document.getElementById('save').addEventListener('click', () => saveOverride().catch(e => setStatus(String(e), 'err')));
document.getElementById('clear').addEventListener('click', () => clearOverride().catch(e => setStatus(String(e), 'err')));

loadDefault().catch(() => {});
