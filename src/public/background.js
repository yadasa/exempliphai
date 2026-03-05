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
