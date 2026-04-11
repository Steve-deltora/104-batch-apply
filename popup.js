// popup.js
const statusBadge   = document.getElementById('statusBadge');
const appliedNum    = document.getElementById('appliedNum');
const totalNum      = document.getElementById('totalNum');
const remainingText = document.getElementById('remainingText');
const progressBar   = document.getElementById('progressBar');
const successNum    = document.getElementById('successNum');
const queueNum      = document.getElementById('queueNum');
const idleHint      = document.getElementById('idleHint');
const btnRow        = document.getElementById('btnRow');
const stopBtn       = document.getElementById('stopBtn');

function updateUI({ isRunning = false, appliedCount = 0, totalCount = 0, remaining = 0 } = {}) {
  appliedNum.textContent = appliedCount;
  totalNum.textContent   = totalCount;
  successNum.textContent = appliedCount;
  queueNum.textContent   = remaining;

  const pct = totalCount > 0 ? (appliedCount / totalCount) * 100 : 0;
  progressBar.style.width = pct + '%';

  if (isRunning) {
    statusBadge.className = 'status-badge running';
    statusBadge.innerHTML = '<span class="dot"></span><span>應徵中...</span>';
    remainingText.textContent = `還剩 ${remaining} 個`;
    idleHint.style.display = 'none';
    btnRow.style.display   = 'flex';
  } else {
    statusBadge.className = 'status-badge idle';
    statusBadge.innerHTML = '<span>閒置中</span>';
    remainingText.textContent = totalCount > 0 ? '已完成' : '尚未開始';
    idleHint.style.display = 'block';
    btnRow.style.display   = 'none';
  }
}

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopBatch' });
});

// Live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'statusUpdate') updateUI(msg);
});

// Initial poll
chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
  if (res) updateUI(res);
});
