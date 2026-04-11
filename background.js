// background.js
// 協調流程：
//   1. 收到 startBatch → 通知搜尋頁點第一個應徵按鈕
//   2. 104 會自己開新 tab → 我們監聽 tab 建立，注入 content-apply.js
//   3. content-apply.js 按完確認送出 → 送 applyDone → 我們關閉該 tab
//   4. 通知搜尋頁點下一個

let state = {
  isRunning:    false,
  searchTabId:  null,
  applyTabId:   null,   // 104 開的應徵 tab
  appliedCount: 0,
  totalCount:   0,
  remaining:    0,
};

// ── Message router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'startBatch':
      state.isRunning    = true;
      state.searchTabId  = sender.tab.id;
      state.appliedCount = 0;
      state.totalCount   = msg.totalCount;
      state.remaining    = msg.totalCount;
      state.applyTabId   = null;
      broadcastStatus();
      // Tell search page to click the first job (use safe sender)
      sendMessageToTab(state.searchTabId, { action: 'clickNext' });
      sendResponse({ ok: true });
      break;

    case 'applyDone':
      if (msg.success) state.appliedCount++;
      state.remaining = Math.max(0, state.remaining - 1);
      broadcastStatus();

      // 關閉應徵 tab：優先用 content-apply.js 傳來的 msg.tabId
      // 備用 sender.tab?.id，再備用 state.applyTabId
      const tabToClose = msg.tabId || sender.tab?.id || state.applyTabId;
      if (tabToClose) {
        // Use callback form to be compatible with callback-only APIs
        try {
          chrome.tabs.remove(tabToClose, () => {});
        } catch (e) {
          // ignore
        }
      }
      state.applyTabId = null;

      if (state.remaining === 0 || !state.isRunning) {
        state.isRunning = false;
        broadcastStatus();
        if (state.searchTabId) {
          sendMessageToTab(state.searchTabId, {
            action: 'batchComplete',
            appliedCount: state.appliedCount,
            totalCount:   state.totalCount,
          });
        }
      } else {
        // Tell search page to click next job (after short delay)
        setTimeout(() => {
          if (state.isRunning && state.searchTabId) {
            chrome.tabs.sendMessage(state.searchTabId, { action: 'clickNext' }).catch(() => {});
          }
        }, 1200);
      }
      sendResponse({ ok: true });
      break;

    case 'stopBatch':
      state.isRunning = false;
      if (state.applyTabId) {
        try {
          chrome.tabs.remove(state.applyTabId, () => {});
        } catch (e) {}
        state.applyTabId = null;
      }
      broadcastStatus();
      sendResponse({ ok: true });
      break;

    case 'getStatus':
      sendResponse({ ...state });
      break;

    case 'registerApplyTab':
      // content-apply.js tells us which tab it's in
      state.applyTabId = sender.tab.id;
      sendResponse({ ok: true });
      break;
  }
  return true;
});

// ── Watch for 104 apply tabs opening ─────────────────────────────────────
// When 104 opens a new tab for the apply form, we need to inject content-apply.js
// (manifest already declares it via content_scripts, so it auto-injects)
chrome.tabs.onCreated.addListener((tab) => {
  if (!state.isRunning) return;
  // We'll track it once content-apply.js registers itself via 'registerApplyTab'
});

// If content script fails to register (e.g. sendMessage couldn't reach service
// worker), try to detect apply tabs by URL updates and track the tab id.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (!state.isRunning) return;
    if (state.applyTabId) return; // already tracking
    const url = tab && tab.url ? tab.url : changeInfo.url;
    if (!url) return;
    // match apply form or final done page
    if (url.includes('104.com.tw/job/apply') || url.includes('/job/apply/done')) {
      state.applyTabId = tabId;
      broadcastStatus();
    }
  } catch (e) {}
});

// Safety: if apply tab is closed externally without applyDone, advance queue
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.applyTabId && state.isRunning) {
    state.applyTabId = null;
    state.remaining  = Math.max(0, state.remaining - 1);
    broadcastStatus();

    if (state.remaining === 0) {
      state.isRunning = false;
      broadcastStatus();
    } else {
        setTimeout(() => {
          try {
            if (state.isRunning && state.searchTabId) {
              sendMessageToTab(state.searchTabId, { action: 'clickNext' });
            }
          } catch (e) {}
        }, 800);
    }
  }
});

function broadcastStatus() {
  try {
    chrome.runtime.sendMessage({ action: 'statusUpdate', ...state }, () => {});
  } catch (e) {}
}

// Send a message to a specific tab, with retry and fallback to inject the
// content script if the receiving end does not exist.
function sendMessageToTab(tabId, message, attempt = 0) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message || '';
        // If no receiver, try injecting the content script and retry once
        if (err.includes('Receiving end does not exist') && attempt === 0) {
          try {
            chrome.scripting.executeScript({ target: { tabId }, files: ['content-search.js'] }, () => {
              // small delay then retry
              setTimeout(() => sendMessageToTab(tabId, message, attempt + 1), 250);
            });
          } catch (e) {
            // ignore
          }
        }
      }
    });
  } catch (e) {
    // ignore
  }
}
