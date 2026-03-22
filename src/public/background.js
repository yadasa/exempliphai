const LIST_MODE_ALARM_NAME = 'LIST_MODE_OPEN_NEXT';
const LIST_MODE_RATE_LIMIT_MS = 30_000;
const LIST_MODE_MAX_QUEUE = 50;

function _p(fn) {
  return new Promise((resolve, reject) => {
    try {
      fn((result) => {
        const err = chrome?.runtime?.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

const storageSyncGet = (keys) => _p((cb) => chrome.storage.sync.get(keys, cb));
const storageSyncSet = (obj) => _p((cb) => chrome.storage.sync.set(obj, cb));
const storageLocalGet = (keys) => _p((cb) => chrome.storage.local.get(keys, cb));
const storageLocalSet = (obj) => _p((cb) => chrome.storage.local.set(obj, cb));

const alarmsClear = (name) => _p((cb) => chrome.alarms.clear(name, cb));
const alarmsCreate = (name, info) => {
  chrome.alarms.create(name, info);
  return Promise.resolve(true);
};

const tabsCreate = (createProps) =>
  _p((cb) => chrome.tabs.create(createProps, cb));

const tabsGet = (tabId) =>
  _p((cb) => chrome.tabs.get(tabId, cb));

const tabsRemove = (tabId) =>
  _p((cb) => chrome.tabs.remove(tabId, cb));

const tabsQuery = (queryInfo) =>
  _p((cb) => chrome.tabs.query(queryInfo, cb));

const tabsSendMessage = (tabId, message, options = {}) =>
  new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, options, (resp) => {
        const err = chrome?.runtime?.lastError;
        if (err) reject(new Error(err.message || String(err)));
        else resolve(resp);
      });
    } catch (e) {
      reject(e);
    }
  });

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Accept http/https only.
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

async function getListModeEnabled() {
  try {
    const got = await storageSyncGet(['listModeEnabled']);
    return !!got?.listModeEnabled;
  } catch (_) {
    return false;
  }
}

async function getClosePreviousTabsEnabled() {
  try {
    const got = await storageSyncGet(['closePreviousTabs']);
    return got?.closePreviousTabs === true;
  } catch (_) {
    return false;
  }
}

async function listModeGetLocalState() {
  const got = await storageLocalGet([
    'jobQueue',
    'currentIndex',
    'listModePaused',
    'listModeActiveJob',
    'listModeLastOpenAt',
    'listModeNextOpenAt',
    'listModeErrors',
    'listModePrevTabId',
    'listModeCurrentTabId',
    'listModePendingClose',
  ]);

  return {
    jobQueue: Array.isArray(got?.jobQueue) ? got.jobQueue : [],
    currentIndex: Number.isFinite(got?.currentIndex) ? got.currentIndex : 0,
    listModePaused: got?.listModePaused !== false, // default true
    listModeActiveJob: got?.listModeActiveJob || null,
    listModeLastOpenAt: Number.isFinite(got?.listModeLastOpenAt) ? got.listModeLastOpenAt : 0,
    listModeNextOpenAt: Number.isFinite(got?.listModeNextOpenAt) ? got.listModeNextOpenAt : 0,
    listModeErrors: Array.isArray(got?.listModeErrors) ? got.listModeErrors : [],
    listModePrevTabId: Number.isFinite(got?.listModePrevTabId) ? got.listModePrevTabId : null,
    listModeCurrentTabId: Number.isFinite(got?.listModeCurrentTabId) ? got.listModeCurrentTabId : null,
    listModePendingClose: got?.listModePendingClose || null,
  };
}

async function listModeSetQueue(rawQueue) {
  const input = Array.isArray(rawQueue) ? rawQueue : [];

  // Sanitize + de-dupe by URL
  const seen = new Set();
  const cleaned = [];

  for (const row of input) {
    const url = normalizeUrl(row?.url);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    cleaned.push({
      url,
      notes: row?.notes ? String(row.notes).slice(0, 2000) : '',
      status: 'pending',
      attempts: 0,
      noClickCount: 0,
      lastError: '',
      lastUrl: '',
      updatedAt: new Date().toISOString(),
    });

    if (cleaned.length >= LIST_MODE_MAX_QUEUE) break;
  }

  await storageLocalSet({
    jobQueue: cleaned,
    currentIndex: 0,
    listModePaused: true,
    listModeActiveJob: null,
    listModeLastOpenAt: 0,
    listModeNextOpenAt: 0,
    listModeErrors: [],
    listModePrevTabId: null,
    listModeCurrentTabId: null,
    listModePendingClose: null,
  });

  await alarmsClear(LIST_MODE_ALARM_NAME).catch(() => {});

  return { ok: true, size: cleaned.length, max: LIST_MODE_MAX_QUEUE };
}

async function listModePause(paused = true) {
  await storageLocalSet({ listModePaused: !!paused });
  if (paused) {
    await alarmsClear(LIST_MODE_ALARM_NAME).catch(() => {});
  }
  return { ok: true, paused: !!paused };
}

async function listModeClear() {
  await storageLocalSet({
    jobQueue: [],
    currentIndex: 0,
    listModePaused: true,
    listModeActiveJob: null,
    listModeLastOpenAt: 0,
    listModeNextOpenAt: 0,
    listModeErrors: [],
    listModePrevTabId: null,
    listModeCurrentTabId: null,
    listModePendingClose: null,
  });
  await alarmsClear(LIST_MODE_ALARM_NAME).catch(() => {});
  return { ok: true };
}

async function listModeScheduleNextOpen(whenMs) {
  const when = Math.max(Date.now() + 250, Number(whenMs || 0));
  await storageLocalSet({ listModeNextOpenAt: when });
  await alarmsCreate(LIST_MODE_ALARM_NAME, { when });
  return when;
}

async function listModeMaybeOpenNext({ force = false, reason = 'unknown' } = {}) {
  const enabled = await getListModeEnabled();
  if (!enabled) return { ok: false, reason: 'disabled' };

  const st = await listModeGetLocalState();
  if (st.listModePaused) return { ok: false, reason: 'paused' };

  // Finished
  if (!st.jobQueue.length || st.currentIndex >= st.jobQueue.length) {
    await storageLocalSet({ listModePaused: true, listModeActiveJob: null, listModeNextOpenAt: 0, listModePendingClose: null });
    await alarmsClear(LIST_MODE_ALARM_NAME).catch(() => {});
    return { ok: false, reason: 'done' };
  }

  // If we already have an active job tab, keep waiting.
  if (st.listModeActiveJob?.tabId) {
    try {
      await tabsGet(st.listModeActiveJob.tabId);
      return { ok: true, reason: 'active_job' };
    } catch (_) {
      // Tab no longer exists; clear and continue.
      await storageLocalSet({ listModeActiveJob: null, listModeCurrentTabId: null });
    }
  }

  const idx = st.currentIndex;
  const next = st.jobQueue[idx];
  const url = normalizeUrl(next?.url);
  if (!url) {
    // Skip invalid row
    st.jobQueue[idx] = {
      ...next,
      status: 'error',
      lastError: 'invalid_url',
      updatedAt: new Date().toISOString(),
    };
    await storageLocalSet({ jobQueue: st.jobQueue, currentIndex: idx + 1, listModeActiveJob: null });
    return await listModeMaybeOpenNext({ force, reason: 'skip_invalid_url' });
  }

  const now = Date.now();
  const lastOpenAt = Number(st.listModeLastOpenAt || 0);
  const nextAllowed = lastOpenAt + LIST_MODE_RATE_LIMIT_MS;

  if (!force && now < nextAllowed) {
    const when = await listModeScheduleNextOpen(nextAllowed);
    return { ok: true, reason: 'rate_limited', scheduled: true, when };
  }

  const prevTabId = Number.isFinite(st.listModeCurrentTabId) ? st.listModeCurrentTabId : null;

  const tab = await tabsCreate({ url, active: true });
  const newTabId = tab?.id;

  const closePreviousTabsEnabled = await getClosePreviousTabsEnabled();
  const shouldClosePrev =
    closePreviousTabsEnabled && Number.isFinite(prevTabId) && Number.isFinite(newTabId) && prevTabId !== newTabId;

  await storageLocalSet({
    listModeActiveJob: {
      index: idx,
      tabId: newTabId,
      url,
      startedAt: Date.now(),
      reason,
    },
    listModePrevTabId: prevTabId,
    listModeCurrentTabId: Number.isFinite(newTabId) ? newTabId : null,
    listModePendingClose: shouldClosePrev
      ? {
          prevTabId,
          newTabId,
          createdAt: Date.now(),
        }
      : null,
    listModeLastOpenAt: Date.now(),
    listModeNextOpenAt: 0,
  });

  await alarmsClear(LIST_MODE_ALARM_NAME).catch(() => {});

  return { ok: true, reason: 'opened', tabId: newTabId, index: idx };
}

function _autoSubmitIntentFromInfo(info) {
  const intent = String(info?.intent || '').toLowerCase();
  if (intent === 'terminal' || intent === 'progress' || intent === 'none') return intent;

  // Back-compat with older shapes.
  if (info?.terminalIntent === true) return 'terminal';
  if (info?.clicked === true) return 'progress';
  return 'none';
}

async function listModeHandleAutofillResult(request, sender) {
  const enabled = await getListModeEnabled();
  if (!enabled) return { ok: false, reason: 'disabled' };

  const tabId = sender?.tab?.id;
  if (!tabId) return { ok: false, reason: 'no_tab' };

  // Only accept messages from the top frame.
  if (typeof sender?.frameId === 'number' && sender.frameId !== 0) {
    return { ok: false, reason: 'not_top_frame' };
  }

  const st = await listModeGetLocalState();
  if (st.listModePaused) return { ok: false, reason: 'paused' };

  const active = st.listModeActiveJob;
  if (!active || active.tabId !== tabId || !Number.isFinite(active.index)) {
    return { ok: false, reason: 'not_active_tab' };
  }

  const idx = active.index;
  if (!st.jobQueue[idx]) {
    await storageLocalSet({ listModeActiveJob: null });
    return { ok: false, reason: 'index_oob' };
  }

  const nowIso = new Date().toISOString();
  const ok = request?.ok === true;
  const finalUrl = String(request?.finalUrl || request?.url || '').slice(0, 2000);

  const autoSubmitInfo = request?.autoSubmit || {};
  const autoSubmitEnabled = autoSubmitInfo?.enabled === true;
  const intent = _autoSubmitIntentFromInfo(autoSubmitInfo);

  const item = { ...st.jobQueue[idx] };
  item.lastUrl = finalUrl || item.lastUrl || item.url;
  item.updatedAt = nowIso;

  if (!ok) {
    item.status = 'error';
    item.lastError = String(request?.error || 'autofill_failed').slice(0, 500);
    st.jobQueue[idx] = item;

    await storageLocalSet({
      jobQueue: st.jobQueue,
      currentIndex: idx + 1,
      listModeActiveJob: null,
    });

    // Always continue on errors (skip failed).
    await listModeMaybeOpenNext({ reason: 'autofill_error' }).catch(() => {});
    return { ok: true, advanced: true, status: 'error' };
  }

  // If auto-submit is enabled, only advance when we clicked a likely-final action.
  if (autoSubmitEnabled) {
    if (intent === 'terminal') {
      item.status = 'done';
      item.lastError = '';
      item.completedAt = nowIso;
      st.jobQueue[idx] = item;

      await storageLocalSet({
        jobQueue: st.jobQueue,
        currentIndex: idx + 1,
        listModeActiveJob: null,
      });

      await listModeMaybeOpenNext({ reason: 'submitted' }).catch(() => {});
      return { ok: true, advanced: true, status: 'done' };
    }

    // Progress click (Next/Continue/Review) → stay on same queue item.
    if (intent === 'progress') {
      item.attempts = (Number(item.attempts) || 0) + 1;
      item.lastError = '';
      st.jobQueue[idx] = item;
      await storageLocalSet({ jobQueue: st.jobQueue });
      return { ok: true, advanced: false, status: 'pending', reason: 'progress' };
    }

    // No click found; do NOT advance automatically (safer). Track for UI.
    item.noClickCount = (Number(item.noClickCount) || 0) + 1;
    item.lastError = 'auto_submit_no_click';
    st.jobQueue[idx] = item;
    await storageLocalSet({ jobQueue: st.jobQueue });

    return { ok: true, advanced: false, status: 'pending', reason: 'no_click' };
  }

  // Auto-submit off → autofill is considered complete.
  item.status = 'done';
  item.lastError = '';
  item.completedAt = nowIso;
  st.jobQueue[idx] = item;

  await storageLocalSet({
    jobQueue: st.jobQueue,
    currentIndex: idx + 1,
    listModeActiveJob: null,
  });

  await listModeMaybeOpenNext({ reason: 'autofill_complete' }).catch(() => {});
  return { ok: true, advanced: true, status: 'done' };
}

async function listModeSkipCurrent({ reason = 'skipped' } = {}) {
  const enabled = await getListModeEnabled();
  if (!enabled) return { ok: false, reason: 'disabled' };

  const st = await listModeGetLocalState();
  if (st.listModePaused) return { ok: false, reason: 'paused' };

  const idx = st.listModeActiveJob?.index ?? st.currentIndex;
  if (!st.jobQueue[idx]) return { ok: false, reason: 'index_oob' };

  st.jobQueue[idx] = {
    ...st.jobQueue[idx],
    status: 'error',
    lastError: reason,
    updatedAt: new Date().toISOString(),
  };

  await storageLocalSet({
    jobQueue: st.jobQueue,
    currentIndex: idx + 1,
    listModeActiveJob: null,
  });

  await listModeMaybeOpenNext({ reason: 'skip' }).catch(() => {});
  return { ok: true, skipped: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing features
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'autofill-ai-answer',
    title: '✨ Autofill with AI',
    contexts: ['editable'],
  });

  // Default settings (sync). No-op if already set.
  chrome.storage.sync.get(
    [
      'listModeEnabled',
      'closePreviousTabs',
      'autoTailorResumes',
      'AI Model',
    ],
    (res) => {
      const next = {};
      if (!res || typeof res.listModeEnabled !== 'boolean') next.listModeEnabled = false;
      if (!res || typeof res.closePreviousTabs !== 'boolean') next.closePreviousTabs = false;

      // Defaults
      if (!res || typeof res.autoTailorResumes !== 'boolean') next.autoTailorResumes = false;
      if (!res || typeof res['AI Model'] !== 'string' || !String(res['AI Model']).trim()) {
        next['AI Model'] = 'gemini-1.5-flash';
      }

      if (Object.keys(next).length) chrome.storage.sync.set(next);
    }
  );
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'autofill-ai-answer' && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRIGGER_AI_REPLY',
    });
  }
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'ai-trigger') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AI_REPLY' });
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AI_REPLY' });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== LIST_MODE_ALARM_NAME) return;
  listModeMaybeOpenNext({ reason: 'alarm' }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.status !== 'complete') return;

  storageLocalGet(['listModePendingClose'])
    .then(async (res) => {
      const pending = res?.listModePendingClose;
      if (!pending || pending.newTabId !== tabId) return;

      // Clear first to avoid double-close on multiple 'complete' updates.
      await storageLocalSet({ listModePendingClose: null }).catch(() => {});

      const closeEnabled = await getClosePreviousTabsEnabled();
      if (!closeEnabled) return;

      // Safety: only close if the new tab is still active when it finishes loading.
      if (tab?.active !== true) return;

      const prevTabId = pending?.prevTabId;
      if (!Number.isFinite(prevTabId) || prevTabId === tabId) return;

      try {
        const prev = await tabsGet(prevTabId);
        if (!prev) return;
        if (prev.pinned) return;
        if (tab?.windowId && prev.windowId !== tab.windowId) return;
        await tabsRemove(prevTabId);
      } catch (_) {
        // Ignore invalid/closed tabs.
      }
    })
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // If the active list-mode tab is closed, clear it so we can continue.
  storageLocalGet(['listModeActiveJob', 'listModeCurrentTabId', 'listModePendingClose'])
    .then((res) => {
      const active = res?.listModeActiveJob;
      const pending = res?.listModePendingClose;

      const next = {};
      if (res?.listModeCurrentTabId === tabId) next.listModeCurrentTabId = null;
      if (pending && (pending.newTabId === tabId || pending.prevTabId === tabId)) next.listModePendingClose = null;
      if (active?.tabId === tabId) next.listModeActiveJob = null;

      const p = Object.keys(next).length ? storageLocalSet(next).catch(() => {}) : Promise.resolve(true);

      if (active?.tabId === tabId) {
        return p.then(() => listModeMaybeOpenNext({ reason: 'tab_closed' }).catch(() => {}));
      }

      return p;
    })
    .catch(() => {});
});

// Popup Port IPC (MV3): popup → background.postMessage('EXTRACT_JOB_CONTEXT')
chrome.runtime.onConnect.addListener((port) => {
  try {
    port.onMessage.addListener((msg) => {
      (async () => {
        try {
          const action = typeof msg === 'string' ? msg : msg?.action;
          if (action !== 'EXTRACT_JOB_CONTEXT') return;

          const tabs = await tabsQuery({ active: true, currentWindow: true });
          const tabId = tabs?.[0]?.id;
          if (!Number.isFinite(tabId)) {
            port.postMessage({ ok: false, reason: 'no_active_tab' });
            return;
          }

          const ctx = await tabsSendMessage(
            tabId,
            'SMARTAPPLY_EXTRACT_JOB_CONTEXT',
            { frameId: 0 }
          );

          port.postMessage({ ok: true, ...(ctx || {}) });
        } catch (e) {
          port.postMessage({ ok: false, error: String(e?.message || e) });
        }
      })();
    });
  } catch (_) {
    // ignore
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    // Existing: store last question for AI.
    if (request?.action === 'STORE_LAST_QUESTION') {
      const tabId = sender?.tab?.id;
      const question = request?.question;
      if (!tabId || !question) {
        sendResponse({ ok: false });
        return;
      }

      chrome.storage.local.get(['last3Questions'], (res) => {
        const prev = Array.isArray(res?.last3Questions) ? res.last3Questions : [];
        const next = [{ tabId, question }, ...prev].slice(0, 3);
        chrome.storage.local.set({ last3Questions: next });
      });

      sendResponse({ ok: true });
      return;
    }

    // List mode (popup → background)
    if (request?.action === 'LIST_MODE_SET_ENABLED') {
      const val = request?.value === true;
      await storageSyncSet({ listModeEnabled: val });
      sendResponse({ ok: true, value: val });
      return;
    }

    if (request?.action === 'LIST_MODE_SET_QUEUE') {
      const resp = await listModeSetQueue(request?.queue);
      sendResponse(resp);
      return;
    }

    if (request?.action === 'LIST_MODE_START') {
      await listModePause(false);
      const resp = await listModeMaybeOpenNext({ reason: 'start' });
      sendResponse({ ok: true, ...resp });
      return;
    }

    if (request?.action === 'LIST_MODE_PAUSE') {
      const resp = await listModePause(true);
      sendResponse(resp);
      return;
    }

    if (request?.action === 'LIST_MODE_CLEAR') {
      const resp = await listModeClear();
      sendResponse(resp);
      return;
    }

    if (request?.action === 'LIST_MODE_SKIP_CURRENT') {
      const resp = await listModeSkipCurrent({ reason: String(request?.reason || 'skipped') });
      sendResponse(resp);
      return;
    }

    if (request?.action === 'LIST_MODE_OPEN_NEXT_NOW') {
      // Force open regardless of rate-limit, but only if no active job.
      const resp = await listModeMaybeOpenNext({ force: true, reason: 'force_open' });
      sendResponse(resp);
      return;
    }

    // List mode (content script → background)
    if (request?.action === 'LIST_MODE_AUTOFILL_RESULT') {
      const resp = await listModeHandleAutofillResult(request, sender);
      sendResponse(resp);
      return;
    }

    // Popup → background → content script: extract job context for resume tailoring.
    if (request?.action === 'EXTRACT_JOB_CONTEXT') {
      try {
        const tabs = await tabsQuery({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (!Number.isFinite(tabId)) {
          sendResponse({ ok: false, reason: 'no_active_tab' });
          return;
        }

        const ctx = await tabsSendMessage(
          tabId,
          'SMARTAPPLY_EXTRACT_JOB_CONTEXT',
          { frameId: 0 }
        );

        sendResponse({ ok: true, ...(ctx || {}) });
        return;
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
        return;
      }
    }

    // Popup → background → content script: run autofill now on the active tab.
    if (request?.action === 'SMARTAPPLY_AUTOFILL_NOW') {
      try {
        const tabs = await tabsQuery({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (!Number.isFinite(tabId)) {
          sendResponse({ ok: false, reason: 'no_active_tab' });
          return;
        }

        const resp = await tabsSendMessage(
          tabId,
          { action: 'SMARTAPPLY_AUTOFILL_NOW', force: true, reason: 'popup' },
          { frameId: 0 }
        );

        sendResponse({ ok: true, ...(resp || {}) });
        return;
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
        return;
      }
    }

    sendResponse({ ok: false, reason: 'unknown_action' });
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  // Keep the message channel open for async sendResponse.
  return true;
});
