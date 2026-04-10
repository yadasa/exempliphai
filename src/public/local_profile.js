// Local Profile Editor (schema-driven)
// Stores LOCAL_PROFILE in chrome.storage.local

const KEY = 'LOCAL_PROFILE';
const LEGACY_KEY = 'EXEMPLIPHAI_LOCAL_PROFILE';
const SCHEMA_URL = chrome.runtime.getURL('config/local_profile_schema.json');

const state = {
  schema: null,
  activeTab: 'profile',
  profile: {},
};

// KillSwitch overlay (non-store installs when global.testallowed=false)
function applyKillSwitchOverlay(st) {
  try {
    const locked = st && st.locked === true;
    let overlay = document.getElementById('__kill_switch_overlay');

    if (!locked) {
      if (overlay) overlay.remove();
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__kill_switch_overlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '999999';
      overlay.style.background = 'rgba(2,6,23,0.85)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '16px';

      const card = document.createElement('div');
      card.style.maxWidth = '420px';
      card.style.width = '100%';
      card.style.borderRadius = '16px';
      card.style.padding = '18px';
      card.style.color = 'white';
      card.style.border = '1px solid rgba(255,255,255,0.12)';
      card.style.background = 'rgba(255,255,255,0.06)';
      card.style.backdropFilter = 'blur(10px)';

      const h = document.createElement('div');
      h.textContent = 'Extension disabled';
      h.style.fontWeight = '800';
      h.style.marginBottom = '8px';

      const p = document.createElement('div');
      p.textContent = String(st?.message || 'Download the official version on Chrome Web Store');
      p.style.fontSize = '13px';
      p.style.lineHeight = '1.35';
      p.style.marginBottom = '14px';

      const a = document.createElement('a');
      const url = String(st?.ctaUrl || '').trim();
      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.textContent = 'Download Link';
        a.style.display = 'inline-flex';
        a.style.width = '100%';
        a.style.justifyContent = 'center';
        a.style.padding = '10px 12px';
        a.style.borderRadius = '12px';
        a.style.background = '#a78bfa';
        a.style.color = 'white';
        a.style.textDecoration = 'none';
        a.style.fontWeight = '800';
        a.style.fontSize = '13px';
        a.style.boxSizing = 'border-box';
        a.style.maxWidth = '100%';
        a.style.whiteSpace = 'normal';
        a.style.overflowWrap = 'anywhere';
      } else {
        a.style.display = 'none';
      }

      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(a);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }
  } catch (_) {}
}

try {
  chrome.storage.local.get(['REMOTE_KILL_SWITCH'], (res) => {
    applyKillSwitchOverlay(res?.REMOTE_KILL_SWITCH);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes?.REMOTE_KILL_SWITCH) return;
    applyKillSwitchOverlay(changes.REMOTE_KILL_SWITCH.newValue);
  });
} catch (_) {}

function $(id) { return document.getElementById(id); }

function setStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.classList.remove('ok', 'err');
  if (cls === 'ok') el.classList.add('ok');
  if (cls === 'err') el.classList.add('err');
}

function deepClone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

function ensureObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

function normalizeKeyName(k) {
  return String(k || '').trim();
}

function coerceFieldValue(field, raw) {
  if (field.type === 'boolean') {
    if (raw === true || raw === false) return raw;
    const t = String(raw ?? '').trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes' || t === 'y') return true;
    if (t === 'false' || t === '0' || t === 'no' || t === 'n' || t === '') return false;
    return false;
  }
  if (field.type === 'number') {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  // strings (and arrays stored elsewhere)
  return raw;
}

function validateProfile(profile, schema) {
  const errs = [];
  for (const cat of (schema?.categories || [])) {
    for (const f of (cat.fields || [])) {
      if (f.type === 'array') continue;
      if (f.required) {
        const v = profile?.[f.key];
        if (v == null || String(v).trim() === '') errs.push(`${f.label} is required`);
      }
      if (f.format === 'email') {
        const v = String(profile?.[f.key] || '').trim();
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs.push(`${f.label} looks invalid`);
      }
      if (f.format === 'date') {
        const v = String(profile?.[f.key] || '').trim();
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(`${f.label} should be YYYY-MM-DD`);
      }
    }
  }
  return errs;
}

async function loadSchema() {
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) throw new Error('Failed to load schema: ' + res.status);
  return await res.json();
}

async function loadProfile() {
  const got = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  const profile = got[KEY] || got[LEGACY_KEY] || null;
  state.profile = ensureObj(profile);
  setStatus(profile ? 'Loaded.' : 'No local profile saved.', profile ? 'ok' : '');
  render();
}

async function saveProfile() {
  // Run validation
  const errs = validateProfile(state.profile, state.schema);
  if (errs.length) {
    setStatus('Fix: ' + errs[0], 'err');
    render();
    return;
  }

  await chrome.storage.local.set({ [KEY]: state.profile, [LEGACY_KEY]: state.profile });
  setStatus('Saved.', 'ok');
}

async function clearProfile() {
  await chrome.storage.local.remove([KEY, LEGACY_KEY]);
  state.profile = {};
  setStatus('Cleared.', 'ok');
  render();
}

function renderTabs() {
  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'education', label: 'Education' },
    { id: 'experience', label: 'Experience' },
    { id: 'raw', label: 'Raw JSON' },
  ];

  const root = $('tabs');
  root.innerHTML = '';
  for (const t of tabs) {
    const b = document.createElement('button');
    b.className = 'tab' + (state.activeTab === t.id ? ' active' : '');
    b.textContent = t.label;
    b.addEventListener('click', () => {
      state.activeTab = t.id;
      render();
    });
    root.appendChild(b);
  }
}

function fieldInput(field, value, onChange) {
  const wrap = document.createElement('div');

  const lab = document.createElement('div');
  lab.className = 'fieldLabel';
  lab.textContent = field.label + (field.required ? ' *' : '');
  wrap.appendChild(lab);

  let el;
  if (field.type === 'boolean') {
    el = document.createElement('select');
    el.className = 'input';
    const optAny = document.createElement('option');
    optAny.value = '';
    optAny.textContent = '—';
    el.appendChild(optAny);

    const optT = document.createElement('option');
    optT.value = 'true';
    optT.textContent = 'true';
    el.appendChild(optT);

    const optF = document.createElement('option');
    optF.value = 'false';
    optF.textContent = 'false';
    el.appendChild(optF);

    if (value === true) el.value = 'true';
    else if (value === false) el.value = 'false';
    else el.value = '';

    el.addEventListener('change', () => {
      if (el.value === '') onChange(null);
      else onChange(el.value === 'true');
    });
  } else if (field.multiline) {
    el = document.createElement('textarea');
    el.className = 'input';
    el.rows = 4;
    el.value = value == null ? '' : String(value);
    el.addEventListener('input', () => onChange(el.value));
  } else {
    el = document.createElement('input');
    el.className = 'input';
    el.type = field.type === 'number' ? 'number' : 'text';
    el.placeholder = field.format === 'date' ? 'YYYY-MM-DD' : '';
    el.value = value == null ? '' : String(value);
    el.addEventListener('input', () => onChange(coerceFieldValue(field, el.value)));
  }

  wrap.appendChild(el);
  return wrap;
}

function renderCategory(cat) {
  const out = document.createElement('div');
  out.style.marginBottom = '14px';

  const title = document.createElement('div');
  title.className = 'sectionTitle';
  title.textContent = cat.title;
  out.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'grid';

  for (const f of (cat.fields || [])) {
    if (f.type === 'array') continue;

    const cur = state.profile?.[f.key];
    const input = fieldInput(f, cur, (v) => {
      const k = normalizeKeyName(f.key);
      const next = deepClone(state.profile);
      if (v == null || v === '') delete next[k];
      else next[k] = v;
      state.profile = next;
    });

    grid.appendChild(input);
  }

  out.appendChild(grid);
  return out;
}

function renderArrayEditor(arrayKey, itemSchema, title) {
  const root = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'row';
  header.style.justifyContent = 'space-between';

  const h = document.createElement('div');
  h.className = 'sectionTitle';
  h.textContent = title;
  header.appendChild(h);

  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = 'Add';
  add.addEventListener('click', () => {
    const next = deepClone(state.profile);
    const arr = Array.isArray(next[arrayKey]) ? next[arrayKey] : [];
    const blank = {};
    for (const f of (itemSchema.fields || [])) blank[f.key] = f.type === 'boolean' ? false : null;
    arr.push(blank);
    next[arrayKey] = arr;
    state.profile = next;
    render();
  });
  header.appendChild(add);

  root.appendChild(header);

  const arr = Array.isArray(state.profile?.[arrayKey]) ? state.profile[arrayKey] : [];
  if (!arr.length) {
    const n = document.createElement('div');
    n.className = 'smallNote';
    n.textContent = 'No items yet.';
    root.appendChild(n);
    return root;
  }

  arr.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginTop = '12px';

    const top = document.createElement('div');
    top.className = 'row';
    top.style.justifyContent = 'space-between';

    const label = document.createElement('div');
    label.className = 'badge';
    label.textContent = `${title} #${idx + 1}`;
    top.appendChild(label);

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      const next = deepClone(state.profile);
      const a = Array.isArray(next[arrayKey]) ? next[arrayKey] : [];
      a.splice(idx, 1);
      next[arrayKey] = a;
      state.profile = next;
      render();
    });
    top.appendChild(del);

    card.appendChild(top);

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.marginTop = '10px';

    for (const f of (itemSchema.fields || [])) {
      const cur = item?.[f.key];
      const input = fieldInput(f, cur, (v) => {
        const next = deepClone(state.profile);
        const a = Array.isArray(next[arrayKey]) ? next[arrayKey] : [];
        const it = ensureObj(a[idx]);
        if (v == null || v === '') delete it[f.key];
        else it[f.key] = v;
        a[idx] = it;
        next[arrayKey] = a;
        state.profile = next;
      });
      grid.appendChild(input);
    }

    card.appendChild(grid);
    root.appendChild(card);
  });

  return root;
}

function renderRawJson() {
  const root = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'sectionTitle';
  title.textContent = 'Raw JSON';
  root.appendChild(title);

  const ta = document.createElement('textarea');
  ta.className = 'input mono';
  ta.style.minHeight = '520px';
  ta.spellcheck = false;
  ta.value = JSON.stringify(state.profile || {}, null, 2);
  root.appendChild(ta);

  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '12px';

  const apply = document.createElement('button');
  apply.className = 'btn primary';
  apply.textContent = 'Apply JSON to Editor';
  apply.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(ta.value);
      state.profile = ensureObj(parsed);
      setStatus('JSON applied.', 'ok');
      render();
    } catch (e) {
      setStatus('Invalid JSON: ' + e.message, 'err');
    }
  });

  row.appendChild(apply);

  const copy = document.createElement('button');
  copy.className = 'btn';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
      setStatus('Copied.', 'ok');
    } catch (e) {
      setStatus('Copy failed: ' + e.message, 'err');
    }
  });
  row.appendChild(copy);

  root.appendChild(row);
  return root;
}

function render() {
  renderTabs();

  const panel = $('panel');
  panel.innerHTML = '';

  if (!state.schema) {
    panel.textContent = 'Loading…';
    return;
  }

  const errs = validateProfile(state.profile, state.schema);
  if (errs.length) {
    const warn = document.createElement('div');
    warn.className = 'badge err';
    warn.textContent = 'Validation: ' + errs[0];
    warn.style.marginBottom = '12px';
    panel.appendChild(warn);
  }

  if (state.activeTab === 'raw') {
    panel.appendChild(renderRawJson());
    return;
  }

  if (state.activeTab === 'education') {
    const cat = (state.schema.categories || []).find(c => c.id === 'education');
    const arrayField = (cat?.fields || []).find(f => f.type === 'array' && f.key === 'education');
    panel.appendChild(renderArrayEditor('education', arrayField.item, 'Education'));
    return;
  }

  if (state.activeTab === 'experience') {
    const cat = (state.schema.categories || []).find(c => c.id === 'experience');
    const arrayField = (cat?.fields || []).find(f => f.type === 'array' && f.key === 'experience');
    panel.appendChild(renderArrayEditor('experience', arrayField.item, 'Experience'));
    return;
  }

  // Profile tab: render all non-array categories except the structured ones
  for (const cat of (state.schema.categories || [])) {
    if (cat.id === 'education' || cat.id === 'experience') continue;
    panel.appendChild(renderCategory(cat));
  }
}

$('load').addEventListener('click', () => loadProfile().catch(e => setStatus(String(e), 'err')));
$('save').addEventListener('click', () => saveProfile().catch(e => setStatus(String(e), 'err')));
$('clear').addEventListener('click', () => clearProfile().catch(e => setStatus(String(e), 'err')));

(async () => {
  try {
    state.schema = await loadSchema();
  } catch (e) {
    setStatus('Schema load failed: ' + e.message, 'err');
  }

  try {
    await loadProfile();
  } catch (_) {}
})();
