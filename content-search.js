// content-search.js — 搜尋結果頁
// 職責：注入勾選框，收到 clickNext 指令時點下一個應徵按鈕

(function () {
  if (window.__104BatchInitialized) return;
  window.__104BatchInitialized = true;

  // jobId → { jobId, title, company, applyBtnEl, wrapper }
  const selectedJobs = new Map();
  let   jobQueue     = [];   // 執行中的佇列（Array）
  let   isRunning    = false;

  // ── DOM observer ──────────────────────────────────────────────────────────
  let debounce = null;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(injectCheckboxes, 250);
  }).observe(document.body, { childList: true, subtree: true });
  injectCheckboxes();

  // ── Messages from background ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'clickNext') {
      clickNext();
      sendResponse({ ok: true });
    } else if (msg.action === 'batchComplete') {
      isRunning = false;
      updateBar();
      showToast(`✅ 批量應徵完成！成功送出 ${msg.appliedCount} / ${msg.totalCount} 份`);
      sendResponse({ ok: true });
    } else if (msg.action === 'stopBatch') {
      isRunning = false;
      jobQueue  = [];
      updateBar();
      showToast('⏹ 已停止');
      sendResponse({ ok: true });
    } else if (msg.action === 'getStatus') {
      sendResponse({
        isRunning,
        appliedCount: 0,
        totalCount:   jobQueue.length,
        remaining:    jobQueue.length,
      });
    }
    return true;
  });

  // ── Inject checkboxes ────────────────────────────────────────────────────
  function injectCheckboxes() {
    const cards = document.querySelectorAll('.job-list-container:not([data-batch-injected])');
    cards.forEach(card => {
      const titleEl = card.querySelector('a.info-job__text[href*="/job/"]');
      if (!titleEl) return;

      const match = (titleEl.href || '').match(/\/job\/([^?#/]+)/);
      if (!match) return;
      const jobId = match[1];

      // 找應徵按鈕：相容搜尋頁與公司頁（Vue scope attribute 可能不同）
      const applyBtnEl =
        card.querySelector('[data-v-e3fvojuuftu="apply-button"]') ||
        card.querySelector('.apply-button__button') ||
        card.querySelector('[data-gtm-joblist*="應徵"]') ||
        card.querySelector('[data-gtm*="應徵"]');
      if (!applyBtnEl) return;

      card.setAttribute('data-batch-injected', 'true');

      const companyEl = card.querySelector('a.info-company__text');
      const title     = titleEl.textContent.trim();
      const company   = companyEl ? companyEl.textContent.trim() : '';

      // Build checkbox
      const wrapper = document.createElement('div');
      wrapper.className = 'batch-select-wrapper';
      wrapper.dataset.jobId = jobId;
      wrapper.innerHTML = `
        <label class="batch-select-label" title="加入批量應徵清單">
          <input type="checkbox" class="batch-checkbox" />
          <span class="batch-select-inner">
            <i class="batch-select-icon">☐</i>
            <span class="batch-select-text">放入購物車</span>
          </span>
        </label>
      `;

      wrapper.querySelector('input').addEventListener('change', (e) => {
        if (isRunning) { e.target.checked = !e.target.checked; return; }
        const icon = wrapper.querySelector('.batch-select-icon');
        if (e.target.checked) {
          selectedJobs.set(jobId, { jobId, title, company, applyBtnEl, wrapper });
          wrapper.classList.add('batch-select--active');
          icon.textContent = '☑';
          card.classList.add('batch-card-selected');
        } else {
          selectedJobs.delete(jobId);
          wrapper.classList.remove('batch-select--active');
          icon.textContent = '☐';
          card.classList.remove('batch-card-selected');
        }
        updateBar();
      });

      // Insert between 應徵按鈕 and 應徵人數列
      const applyBtnWrapper  = card.querySelector('.apply-button.action-container__apply');
      const applyAnalysisRow = card.querySelector('.action-apply');
      const parent           = applyBtnWrapper?.parentNode;

      if (parent) {
        if (applyAnalysisRow && applyAnalysisRow.parentNode === parent) {
          parent.insertBefore(wrapper, applyAnalysisRow);
        } else if (applyBtnWrapper) {
          applyBtnWrapper.insertAdjacentElement('afterend', wrapper);
        } else {
          parent.appendChild(wrapper);
        }
      }
    });
  }

  // ── Control bar ───────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'batch-apply-bar';
  bar.innerHTML = `
    <div class="batch-bar-inner">
      <span class="batch-bar-icon">⚡</span>
      <span class="batch-bar-text">已選 <strong id="batch-count">0</strong> 個職缺</span>
      <button id="batch-start-btn" disabled>開始批次應徵</button>
      <button id="batch-clear-btn">清除選取</button>
    </div>
  `;
  document.body.appendChild(bar);

  document.getElementById('batch-start-btn').addEventListener('click', startBatch);
  document.getElementById('batch-clear-btn').addEventListener('click', clearAll);

  function updateBar() {
    const count = selectedJobs.size;
    document.getElementById('batch-count').textContent = count;
    const startBtn = document.getElementById('batch-start-btn');
    startBtn.disabled = (count === 0) || isRunning;
    startBtn.textContent = isRunning ? `應徵中...` : '開始批次應徵';
    bar.classList.toggle('batch-bar-visible', count > 0 || isRunning);
  }

  function clearAll() {
    if (isRunning) return;
    selectedJobs.clear();
    document.querySelectorAll('.batch-checkbox').forEach(cb => {
      cb.checked = false;
      const w = cb.closest('.batch-select-wrapper');
      if (w) {
        w.classList.remove('batch-select--active');
        w.querySelector('.batch-select-icon').textContent = '☐';
      }
      cb.closest('.job-list-container')?.classList.remove('batch-card-selected');
    });
    updateBar();
  }

  function startBatch() {
    if (selectedJobs.size === 0 || isRunning) return;
    jobQueue  = Array.from(selectedJobs.values());
    isRunning = true;
    updateBar();
    // Tell background to start; background will send us clickNext
    chrome.runtime.sendMessage({
      action:     'startBatch',
      totalCount: jobQueue.length,
    });
  }

  // ── Click next job's 應徵 button ──────────────────────────────────────────
  let popupWatcher    = null;
  let reapplyHandled  = false;

  function clickNext() {
    if (!isRunning || jobQueue.length === 0) return;

    const job = jobQueue.shift();
    const { applyBtnEl, wrapper } = job;

    // Mark as processing
    wrapper.closest('.job-list-container')?.classList.add('batch-card-processing');

    // Scroll into view then click
    applyBtnEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      applyBtnEl.click();

      // 點完後監聽是否在搜尋頁冒出「已應徵過」popup
      startPopupWatcher();

      // Mark wrapper as sent (background/apply tab takes it from here)
      setTimeout(() => {
        wrapper.classList.add('batch-select--done');
        wrapper.querySelector('.batch-select-icon').textContent = '✓';
        wrapper.querySelector('.batch-select-text').textContent = '已應徵';
        wrapper.closest('.job-list-container')?.classList.remove('batch-card-processing', 'batch-card-selected');
      }, 2000);
    }, 500);
  }

  // 在搜尋頁監聽「已應徵過」popup，出現就點「仍要再次應徵」
  function startPopupWatcher() {
    if (popupWatcher) clearInterval(popupWatcher);
    reapplyHandled = false;
    let ticks = 0;

    popupWatcher = setInterval(() => {
      ticks++;
      if (ticks > 25) {            // 最多等 10 秒
        clearInterval(popupWatcher);
        return;
      }
      if (reapplyHandled) return;

      const btn = findReapplyBtnOnPage();
      if (btn) {
        reapplyHandled = true;
        clearInterval(popupWatcher);
        btn.click();
      }
    }, 400);
  }

  // 在整個頁面找「仍要再次應徵」按鈕
  function findReapplyBtnOnPage() {
    for (const btn of document.querySelectorAll('button.btn-outline-secondary')) {
      if (btn.innerText && btn.innerText.includes('仍要再次應徵')) return btn;
    }
    for (const btn of document.querySelectorAll('button')) {
      if (btn.innerText && btn.innerText.includes('仍要再次應徵')) return btn;
    }
    return null;
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'batch-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('batch-toast-show'));
    setTimeout(() => {
      t.classList.remove('batch-toast-show');
      setTimeout(() => t.remove(), 400);
    }, 5000);
  }
})();
