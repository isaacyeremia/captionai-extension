let isActive = false;
let currentTabId = null;

async function ensureContentScript(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__captionai_loaded !== 'undefined'
    });
    if (results && results[0] && results[0].result) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'GET_STATUS') {
    // Cek langsung ke content.js via executeScript untuk status akurat
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) { sendResponse({ active: false }); return; }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => window.__captionai_active === true
        });
        const active = results?.[0]?.result || false;
        isActive = active; // sync state
        sendResponse({ active });
      } catch {
        sendResponse({ active: false });
      }
    });
    return true; // async
  }

  if (msg.type === 'START_CAPTION') {
    currentTabId = msg.tabId;
    isActive = true;
    ensureContentScript(msg.tabId)
      .then(() => chrome.tabs.sendMessage(msg.tabId, { type: 'START_CAPTURE' }))
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'STOP_CAPTION') {
    isActive = false;
    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, { type: 'CAPTION_STOP' }).catch(() => {});
    }
    sendResponse({ success: true });
    return false;
  }

  if (msg.type === 'CAPTION_STOPPED_AUTO') {
    isActive = false;
    chrome.runtime.sendMessage({ type: 'STATUS_CHANGED', active: false }).catch(() => {});
    return false;
  }
});