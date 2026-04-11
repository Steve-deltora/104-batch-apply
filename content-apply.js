// content-apply.js — 注入到 104 開啟的應徵 tab

(function () {
  const LOG = (...a) => console.log('[104-apply]', ...a);

  LOG('script loaded, url=', location.href);

  // 先告知 background 這個 tab 是應徵 tab
  (function safeRegister(retries = 5, delay = 200) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'registerApplyTab' }, () => { void chrome.runtime.lastError; });
        return;
      }
    } catch (e) {}
    if (retries > 0) setTimeout(() => safeRegister(retries - 1, delay), delay);
  })();

  const POLL_MS      = 400;
  const MAX_WAIT_MS  = 25000;
  const MAX_ATTEMPTS = MAX_WAIT_MS / POLL_MS;

  let attempts       = 0;
  let reported       = false;
  let reapplyClicked = false;
  let submitClicked  = false;

  if (location.href.includes('/job/apply/done')) {
    LOG('done page, reporting success');
    reportDone(true);
    return;
  }

  const timer = setInterval(tick, POLL_MS);

  function tick() {
    if (reported) return;
    attempts++;

    if (attempts > MAX_ATTEMPTS) {
      LOG('timeout');
      clearInterval(timer);
      reportDone(false);
      return;
    }

    const reapplyBtn = findReapplyBtn();
    const confirmBtn = findConfirmBtn();
    LOG(`tick ${attempts} | reapplyBtn=${!!reapplyBtn} reapplyClicked=${reapplyClicked} | confirmBtn=${!!confirmBtn} submitClicked=${submitClicked}`);

    // ── 優先處理「已應徵過」popup ──
    if (reapplyBtn) {
      if (!reapplyClicked) {
        reapplyClicked = true;
        submitClicked  = false;
        LOG('clicking reapply btn now');
        reapplyBtn.click();
        LOG('reapply btn.click() called');
      }
      return;
    }

    // ── 已點送出，等確認按鈕消失 ──
    if (submitClicked) {
      if (!confirmBtn) {
        clearInterval(timer);
        LOG('submit succeeded');
        setTimeout(() => reportDone(true), 500);
      }
      return;
    }

    // ── 找到送出按鈕 ──
    if (!confirmBtn) return;

    if (hasUnfilledRequired() || hasCompanyQuestions()) {
      LOG('unfilled required fields or company questions → skip');
      clearInterval(timer);
      reportDone(false);
      return;
    }

    LOG('clicking confirm btn');
    submitClicked = true;
    setTimeout(() => confirmBtn.click(), 600);
  }

  function reportDone(success) {
    if (reported) return;
    reported = true;
    clearInterval(timer);
    LOG('reportDone success=', success);
    try {
      chrome.runtime.sendMessage({ action: 'applyDone', success }, () => { void chrome.runtime.lastError; });
    } catch (e) {}
  }

  window.addEventListener('beforeunload', () => {
    try { reportDone(true); } catch (e) {}
  });

  // ── 找「仍要再次應徵」按鈕 ──
  function findReapplyBtn() {
    for (const btn of document.querySelectorAll('button.btn-outline-secondary')) {
      if (btn.innerText && btn.innerText.includes('仍要再次應徵')) return btn;
    }
    for (const btn of document.querySelectorAll('button')) {
      if (btn.innerText && btn.innerText.includes('仍要再次應徵')) return btn;
    }
    return null;
  }

  // ── 判斷是否有未填的必填欄位 ──
  function hasUnfilledRequired() {
    for (const field of document.querySelectorAll(
      'input[required]:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]),' +
      'textarea[required],' +
      'input[aria-required="true"]:not([type="radio"]):not([type="checkbox"]),' +
      'textarea[aria-required="true"]'
    )) {
      if (!isVisible(field)) continue;
      if (!field.value || field.value.trim() === '') return true;
    }

    for (const field of document.querySelectorAll('select[required], select[aria-required="true"]')) {
      if (!isVisible(field)) continue;
      if (!field.value || field.value === '') return true;
    }

    const radioGroups = new Map();
    for (const r of document.querySelectorAll(
      'input[type="radio"][required], input[type="radio"][aria-required="true"]'
    )) {
      if (!r.name) continue;
      if (!radioGroups.has(r.name)) radioGroups.set(r.name, []);
      radioGroups.get(r.name).push(r);
    }
    for (const radios of radioGroups.values()) {
      if (!radios.some(r => isVisible(r))) continue;
      if (!radios.some(r => r.checked)) return true;
    }

    return false;
  }

  // ── 偵測公司提問（有可見的空白 textarea = 有問題需要填寫）──
  // 104「自我推薦信」textarea 預設隱藏，不會觸發；
  // 只有公司設定的提問 textarea 會是可見且空白的。
  function hasCompanyQuestions() {
    for (const ta of document.querySelectorAll('textarea')) {
      if (!isVisible(ta)) continue;
      if (!ta.value || ta.value.trim() === '') {
        LOG('found visible empty textarea → company question detected');
        return true;
      }
    }
    return false;
  }

  // ── 找「確認送出」按鈕 ──
  function findConfirmBtn() {
    const el = document.querySelector('button.submit-btn');
    if (el && isVisible(el)) return el;
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim().includes('確認送出') && isVisible(btn)) return btn;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 &&
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      parseFloat(s.opacity) > 0
    );
  }
})();
