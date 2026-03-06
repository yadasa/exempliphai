chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "autofill-ai-answer",
        title: "✨ Autofill with AI",
        contexts: ["editable"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "autofill-ai-answer" && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
            action: "TRIGGER_AI_REPLY"
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

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request?.action !== 'STORE_LAST_QUESTION') return;
    const tabId = sender?.tab?.id;
    const question = request?.question;
    if (!tabId || !question) return;

    chrome.storage.local.get(['last3Questions'], (res) => {
        const prev = Array.isArray(res?.last3Questions) ? res.last3Questions : [];
        const next = [{ tabId, question }, ...prev].slice(0, 3);
        chrome.storage.local.set({ last3Questions: next });
    });
});
