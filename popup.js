const btnStart   = document.getElementById('btnStart');
const btnStop    = document.getElementById('btnStop');
const statusText = document.getElementById('statusText');
const statusDot  = document.getElementById('statusDot');
const fontSizeSlider = document.getElementById('fontSize');
const fontSizeVal    = document.getElementById('fontSizeVal');

// Load settings
let settings = { fontSize: 20, bgColor: 'rgba(0,0,0,0.5)', textColor: '#ffffff' };
const saved = localStorage.getItem('captionai_settings');
if (saved) { try { settings = { ...settings, ...JSON.parse(saved) }; } catch(e) {} }

// Apply saved settings ke UI
fontSizeSlider.value = settings.fontSize;
fontSizeVal.textContent = settings.fontSize;

// Highlight active color buttons
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.style.border = btn.dataset.bg === settings.bgColor
    ? '2px solid #1a73e8' : '1px solid #30363d';
});
document.querySelectorAll('.text-btn').forEach(btn => {
  btn.style.border = btn.dataset.color === settings.textColor
    ? '2px solid #1a73e8' : '1px solid #30363d';
});

function saveAndApply() {
  localStorage.setItem('captionai_settings', JSON.stringify(settings));
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_SETTINGS', settings }).catch(() => {});
    }
  });
}

// Font size slider
fontSizeSlider.addEventListener('input', () => {
  settings.fontSize = parseInt(fontSizeSlider.value);
  fontSizeVal.textContent = settings.fontSize;
  saveAndApply();
});

// Color buttons
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    settings.bgColor = btn.dataset.bg;
    document.querySelectorAll('.color-btn').forEach(b => {
      b.style.border = b === btn ? '2px solid #1a73e8' : '1px solid #30363d';
    });
    saveAndApply();
  });
});

document.querySelectorAll('.text-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    settings.textColor = btn.dataset.color;
    document.querySelectorAll('.text-btn').forEach(b => {
      b.style.border = b === btn ? '2px solid #1a73e8' : '1px solid #30363d';
    });
    saveAndApply();
  });
});

function setActive() {
  statusText.textContent = 'Caption aktif ✓';
  statusDot.style.background = '#2ea043';
  statusText.style.color = '#2ea043';
  btnStart.style.background = '#388bfd';
  btnStart.disabled = true;
  btnStart.style.opacity = '0.6';
  btnStop.style.color = '#f85149';
  btnStop.style.borderColor = '#f85149';
}

function setInactive() {
  statusText.textContent = 'Tidak aktif';
  statusDot.style.background = '#8b949e';
  statusText.style.color = '#8b949e';
  btnStart.style.background = '#1a73e8';
  btnStart.disabled = false;
  btnStart.style.opacity = '1';
  btnStop.style.color = '#8b949e';
  btnStop.style.borderColor = '#30363d';
}

// Cek status saat popup dibuka
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res && res.active) setActive();
  else setInactive();
});

// Listener kalau extension auto-stop karena silence
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS_CHANGED') {
    if (msg.active) setActive();
    else setInactive();
  }
});

btnStart.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.runtime.sendMessage(
      { type: 'START_CAPTION', tabId: tabs[0].id },
      (res) => {
        if (res && res.success) setActive();
        else {
          statusText.textContent = 'Gagal connect ke server';
          statusDot.style.background = '#f85149';
          statusText.style.color = '#f85149';
        }
      }
    );
  });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTION' }, () => setInactive());
});