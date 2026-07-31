// CaptionAI content script — getDisplayMedia only
if (typeof window.__captionai_loaded === 'undefined') {
  window.__captionai_loaded = true;
  window.__captionai_active = false;

  const WS_URL = 'wss://isaacyn-captionai-server-v2.hf.space/ws';
  const SAMPLE_RATE = 16000;
  const CHUNK_SAMPLES = Math.floor(SAMPLE_RATE * 0.5);
  const SILENCE_THRESHOLD = 0.001;
  const SILENCE_STOP_DURATION = 10000; // 10 detik silence → auto stop

  let ws = null;
  let audioContext = null;
  let processor = null;
  let displayStream = null;
  let captionBox = null;
  let hideTimer = null;
  let isCapturing = false;
  let silenceTimer = null;
  let autoStopTimer = null;

  let settings = { fontSize: 20, bgColor: 'rgba(0,0,0,0.5)', textColor: '#ffffff' };

  function loadSettings() {
    const saved = localStorage.getItem('captionai_settings');
    if (saved) { try { settings = { ...settings, ...JSON.parse(saved) }; } catch(e) {} }
  }

  function createCaptionBox() {
    if (captionBox) return;
    loadSettings();
    captionBox = document.createElement('div');
    captionBox.id = 'captionai-box';
    captionBox.style.cssText = `
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 90%;
      min-width: 400px;
      background: ${settings.bgColor};
      color: ${settings.textColor};
      font-size: ${settings.fontSize}px;
      font-family: Arial, sans-serif;
      font-weight: bold;
      padding: 12px 24px;
      border-radius: 10px;
      text-align: center;
      z-index: 999999;
      line-height: 1.6;
      border: none;
      text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
      transition: opacity 0.3s ease;
      pointer-events: none;
      word-wrap: break-word;
      white-space: normal;
    `;
    document.body.appendChild(captionBox);
  }

  function removeCaptionBox() {
    if (captionBox) { captionBox.remove(); captionBox = null; }
  }

  function showWords(text) {
    createCaptionBox();
    const words = text.trim().split(' ');
    clearTimeout(hideTimer);
    captionBox.textContent = '';
    captionBox.style.opacity = '1';

    words.forEach((word, i) => {
      setTimeout(() => {
        if (i === 0) captionBox.textContent = word;
        else captionBox.textContent += ' ' + word;
        if (i === words.length - 1) {
          hideTimer = setTimeout(() => {
            if (captionBox) {
              captionBox.textContent = '';
              captionBox.style.opacity = '0';
            }
          }, 4000);
        }
      }, i * 50);
    });
  }

  function sendSilenceSignal() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(new ArrayBuffer(0));
    }
    if (captionBox) {
      clearTimeout(hideTimer);
      captionBox.textContent = '';
      captionBox.style.opacity = '0';
    }
  }

  function stopCapture(notify = true) {
    isCapturing = false;
    window.__captionai_active = false;
    if (silenceTimer)  { clearTimeout(silenceTimer);  silenceTimer  = null; }
    if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
    if (processor)     { processor.disconnect(); processor = null; }
    if (displayStream) { displayStream.getTracks().forEach(t => t.stop()); displayStream = null; }
    if (audioContext)  { audioContext.close(); audioContext = null; }
    if (ws)            { ws.close(); ws = null; }
    clearTimeout(hideTimer);
    removeCaptionBox();
    if (notify) {
      chrome.runtime.sendMessage({ type: 'CAPTION_STOPPED_AUTO' }).catch(() => {});
    }
  }

  async function startCapture() {
    try {
      ws = new WebSocket(WS_URL);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error('Gagal connect ke server CaptionAI'));
      });

      ws.onmessage = (event) => {
        if (event.data && event.data.trim()) showWords(event.data.trim());
      };
      ws.onclose = () => { if (isCapturing) stopCapture(); };

      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, sampleRate: SAMPLE_RATE }
        });
      } catch (e) {
        throw new Error('User batal share tab: ' + e.message);
      }

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach(t => t.stop());
        throw new Error('Tidak ada audio. Centang "Share tab audio" saat memilih tab.');
      }

      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      const source = audioContext.createMediaStreamSource(displayStream);

      displayStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (isCapturing) stopCapture();
      });

      processor = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      let audioBuffer = new Float32Array(0);

      processor.onaudioprocess = (e) => {
        if (!isCapturing) return;

        const input = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(input.reduce((sum, s) => sum + s * s, 0) / input.length);

        if (rms < SILENCE_THRESHOLD) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              sendSilenceSignal();
              audioBuffer = new Float32Array(0);
            }, 500);
          }
          if (!autoStopTimer) {
            autoStopTimer = setTimeout(() => {
              if (isCapturing) stopCapture();
            }, SILENCE_STOP_DURATION);
          }
          return;
        }

        if (silenceTimer)  { clearTimeout(silenceTimer);  silenceTimer  = null; }
        if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }

        const combined = new Float32Array(audioBuffer.length + input.length);
        combined.set(audioBuffer);
        combined.set(input, audioBuffer.length);
        audioBuffer = combined;

        while (audioBuffer.length >= CHUNK_SAMPLES) {
          const chunk = audioBuffer.slice(0, CHUNK_SAMPLES);
          audioBuffer = audioBuffer.slice(CHUNK_SAMPLES);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(chunk.buffer);
          }
        }
      };

      isCapturing = true;
      window.__captionai_active = true;
      createCaptionBox();
      captionBox.textContent = '🎧 CaptionAI aktif...';
      captionBox.style.opacity = '1';
      hideTimer = setTimeout(() => {
        if (captionBox) captionBox.textContent = '';
      }, 2000);

    } catch (e) {
      alert('CaptionAI Error: ' + e.message);
      if (ws) { ws.close(); ws = null; }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_CAPTURE') startCapture();
    if (msg.type === 'CAPTION_STOP') stopCapture(false);
    if (msg.type === 'UPDATE_SETTINGS') {
      settings = { ...settings, ...msg.settings };
      localStorage.setItem('captionai_settings', JSON.stringify(settings));
      if (captionBox) {
        captionBox.style.fontSize = settings.fontSize + 'px';
        captionBox.style.background = settings.bgColor;
        captionBox.style.color = settings.textColor;
      }
    }
  });
}