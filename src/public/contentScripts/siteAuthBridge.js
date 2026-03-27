// Exempliphai website → extension auth bridge.
// Assumes the website stores a Firebase Custom Token in localStorage.
//
// Expected key:
//   localStorage['EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN'] = '<customToken>'
//
// The extension popup can request it via chrome.tabs.sendMessage.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.action !== 'EXEMPLIPHAI_GET_CUSTOM_TOKEN') {
      sendResponse({ ok: false, ignored: true });
      return;
    }

    const token =
      (typeof localStorage !== 'undefined' && localStorage.getItem('EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('EXEMPLIPHAI_FIREBASE_CUSTOM_TOKEN')) ||
      '';

    sendResponse({ ok: true, token: String(token || '') });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
});
