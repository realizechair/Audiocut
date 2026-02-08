// ===== MP3 Audio Splitter - Main Application =====

(function () {
  'use strict';

  // === State ===
  let audioFile = null;
  let audioBuffer = null;
  let audioContext = null;
  let sourceNode = null;
  let gainNode = null;
  let isPlaying = false;
  let playStartTime = 0;
  let playOffset = 0;
  let animationFrameId = null;
  let markers = []; // array of seconds
  let ffmpegInstance = null;
  let ffmpegLoaded = false;
  let duration = 0;
  let zoomLevel = 1;
  let scrollOffset = 0;
  let fileArrayBuffer = null;

  // === DOM Elements ===
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');
  const uploadSection = $('#upload-section');
  const editorSection = $('#editor-section');
  const waveformCanvas = $('#waveform-canvas');
  const overlayCanvas = $('#overlay-canvas');
  const playhead = $('#playhead');
  const waveformContainer = $('#waveform-container');
  const progressSection = $('#progress-section');
  const progressBar = $('#progress-bar');
  const progressText = $('#progress-text');
  const resultsSection = $('#results-section');
  const segmentsGrid = $('#segments-grid');
  const loadingOverlay = $('#loading-overlay');
  const loadingText = $('#loading-text');

  // === Utility Functions ===
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function formatTimeShort(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    const colors = { info: 'bg-blue-500', success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-amber-500' };
    const icons = { info: 'info-circle', success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle' };
    toast.className = `toast ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm`;
    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  // === File Handling ===
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('audio/')) {
      loadAudioFile(files[0]);
    } else {
      showToast('音声ファイルをドロップしてください', 'error');
    }
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) loadAudioFile(e.target.files[0]);
  });

  $('#btn-new-file').addEventListener('click', () => {
    stopPlayback();
    markers = [];
    audioFile = null;
    audioBuffer = null;
    fileArrayBuffer = null;
    uploadSection.classList.remove('hidden');
    editorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    fileInput.value = '';
  });

  async function loadAudioFile(file) {
    audioFile = file;
    showLoading('音声ファイルを読み込んでいます...');

    try {
      fileArrayBuffer = await file.arrayBuffer();

      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      showLoading('音声をデコード中...');
      audioBuffer = await audioContext.decodeAudioData(fileArrayBuffer.slice(0));
      duration = audioBuffer.duration;

      // Update UI
      $('#file-name').textContent = file.name;
      $('#file-info').textContent = `${formatTime(duration)} | ${formatFileSize(file.size)} | ${audioBuffer.numberOfChannels}ch | ${audioBuffer.sampleRate}Hz`;
      $('#time-end').textContent = formatTime(duration);

      uploadSection.classList.add('hidden');
      editorSection.classList.remove('hidden');
      resultsSection.classList.add('hidden');
      progressSection.classList.add('hidden');
      markers = [];
      updateMarkersUI();

      drawWaveform();
      hideLoading();
      showToast('ファイルを読み込みました', 'success');
    } catch (err) {
      hideLoading();
      console.error('Audio load error:', err);
      showToast('ファイルの読み込みに失敗しました: ' + err.message, 'error');
    }
  }

  // === Waveform Drawing ===
  function drawWaveform() {
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;

    ctx.scale(dpr, dpr);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    if (!audioBuffer) return;

    const data = audioBuffer.getChannelData(0);
    const visibleDuration = duration / zoomLevel;
    const startSample = Math.floor((scrollOffset / duration) * data.length);
    const endSample = Math.floor(((scrollOffset + visibleDuration) / duration) * data.length);
    const samplesPerPixel = Math.max(1, Math.floor((endSample - startSample) / w));
    const mid = h / 2;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let t = 0; t <= visibleDuration; t += Math.max(1, Math.floor(visibleDuration / 10))) {
      const x = ((t) / visibleDuration) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    // Draw waveform
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#60a5fa');
    gradient.addColorStop(0.5, '#3b82f6');
    gradient.addColorStop(1, '#60a5fa');

    ctx.fillStyle = gradient;
    for (let i = 0; i < w; i++) {
      const sampleIdx = startSample + i * samplesPerPixel;
      let min = 0, max = 0;
      for (let j = 0; j < samplesPerPixel && sampleIdx + j < data.length; j++) {
        const val = data[sampleIdx + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const yMin = mid + min * mid * 0.9;
      const yMax = mid + max * mid * 0.9;
      ctx.fillRect(i, yMin, 1, yMax - yMin || 1);
    }

    drawOverlay();
  }

  function drawOverlay() {
    const ctx = overlayCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = overlayCanvas.clientWidth;
    const h = overlayCanvas.clientHeight;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);

    const visibleDuration = duration / zoomLevel;

    // Draw split regions
    const allPoints = [0, ...markers.sort((a, b) => a - b), duration];
    const colors = ['rgba(59,130,246,0.08)', 'rgba(245,158,11,0.08)'];
    for (let i = 0; i < allPoints.length - 1; i++) {
      const x1 = ((allPoints[i] - scrollOffset) / visibleDuration) * w;
      const x2 = ((allPoints[i + 1] - scrollOffset) / visibleDuration) * w;
      ctx.fillStyle = colors[i % 2];
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    // Draw markers
    markers.forEach((time, idx) => {
      const x = ((time - scrollOffset) / visibleDuration) * w;
      if (x >= 0 && x <= w) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);

        // Marker dot
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.arc(x, 8, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '8px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(idx + 1, x, 11);
      }
    });

    ctx.restore();
  }

  // Waveform click to add marker or seek
  waveformContainer.addEventListener('click', (e) => {
    if (!audioBuffer) return;
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const visibleDuration = duration / zoomLevel;
    const clickTime = scrollOffset + ratio * visibleDuration;

    // Seek to position
    if (isPlaying) {
      stopPlayback();
      playOffset = Math.max(0, Math.min(clickTime, duration));
      startPlayback();
    } else {
      playOffset = Math.max(0, Math.min(clickTime, duration));
      updatePlayhead();
      updateTimeDisplay();
    }
  });

  // Double click to add marker
  waveformContainer.addEventListener('dblclick', (e) => {
    if (!audioBuffer) return;
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const visibleDuration = duration / zoomLevel;
    const clickTime = scrollOffset + ratio * visibleDuration;
    addMarker(clickTime);
  });

  // Zoom
  $('#zoom-slider').addEventListener('input', (e) => {
    zoomLevel = parseFloat(e.target.value);
    const visibleDuration = duration / zoomLevel;
    if (scrollOffset + visibleDuration > duration) {
      scrollOffset = Math.max(0, duration - visibleDuration);
    }
    drawWaveform();
  });

  // Scroll on waveform with wheel
  waveformContainer.addEventListener('wheel', (e) => {
    if (!audioBuffer || zoomLevel <= 1) return;
    e.preventDefault();
    const visibleDuration = duration / zoomLevel;
    const delta = (e.deltaY / 1000) * visibleDuration;
    scrollOffset = Math.max(0, Math.min(duration - visibleDuration, scrollOffset + delta));
    drawWaveform();
    updatePlayhead();
  });

  // === Playback ===
  function startPlayback() {
    if (!audioBuffer) return;
    if (isPlaying) stopPlayback();

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    gainNode = audioContext.createGain();
    gainNode.gain.value = parseFloat($('#volume-slider').value);
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.start(0, playOffset);
    playStartTime = audioContext.currentTime;
    isPlaying = true;
    $('#play-icon').className = 'fas fa-pause';

    sourceNode.onended = () => {
      if (isPlaying) {
        isPlaying = false;
        playOffset = 0;
        $('#play-icon').className = 'fas fa-play';
        cancelAnimationFrame(animationFrameId);
        updatePlayhead();
      }
    };

    updatePlayheadLoop();
  }

  function stopPlayback() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { }
      sourceNode = null;
    }
    if (isPlaying) {
      playOffset += audioContext.currentTime - playStartTime;
      if (playOffset >= duration) playOffset = 0;
    }
    isPlaying = false;
    $('#play-icon').className = 'fas fa-play';
    cancelAnimationFrame(animationFrameId);
  }

  function updatePlayheadLoop() {
    if (!isPlaying) return;
    const currentTime = playOffset + (audioContext.currentTime - playStartTime);
    if (currentTime >= duration) {
      stopPlayback();
      playOffset = 0;
      updatePlayhead();
      return;
    }
    updatePlayhead(currentTime);
    updateTimeDisplay(currentTime);
    animationFrameId = requestAnimationFrame(updatePlayheadLoop);
  }

  function updatePlayhead(time) {
    const t = time !== undefined ? time : playOffset;
    const visibleDuration = duration / zoomLevel;
    const ratio = (t - scrollOffset) / visibleDuration;

    if (ratio >= 0 && ratio <= 1) {
      playhead.style.display = 'block';
      playhead.style.left = (ratio * 100) + '%';
    } else {
      playhead.style.display = 'none';
    }
  }

  function updateTimeDisplay(time) {
    const t = time !== undefined ? time : playOffset;
    $('#time-current').textContent = formatTime(t);
  }

  $('#btn-play').addEventListener('click', () => {
    if (isPlaying) stopPlayback(); else startPlayback();
  });
  $('#btn-stop').addEventListener('click', () => { stopPlayback(); playOffset = 0; updatePlayhead(); updateTimeDisplay(); });
  $('#volume-slider').addEventListener('input', (e) => { if (gainNode) gainNode.gain.value = parseFloat(e.target.value); });

  // === Markers ===
  function addMarker(time) {
    time = Math.max(0.1, Math.min(duration - 0.1, time));
    // Don't add if too close to existing marker
    if (markers.some(m => Math.abs(m - time) < 0.1)) {
      showToast('既存のマーカーに近すぎます', 'warning');
      return;
    }
    markers.push(time);
    markers.sort((a, b) => a - b);
    updateMarkersUI();
    drawOverlay();
    showToast(`マーカーを追加: ${formatTime(time)}`, 'info');
  }

  function removeMarker(index) {
    markers.splice(index, 1);
    updateMarkersUI();
    drawOverlay();
  }

  function updateMarkersUI() {
    const list = $('#markers-list');
    const sorted = [...markers].sort((a, b) => a - b);
    const splitBtn = $('#btn-split');

    $('#marker-count').textContent = markers.length;
    $('#segment-count').textContent = markers.length + 1;
    splitBtn.disabled = markers.length === 0;

    if (markers.length === 0) {
      list.innerHTML = '<p class="text-xs text-gray-400 italic">マーカーが設定されていません。波形をダブルクリックするか、ボタンで追加してください。</p>';
      return;
    }

    list.innerHTML = sorted.map((time, i) => `
      <div class="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-xs font-bold">${i + 1}</span>
          <span class="font-mono text-gray-700">${formatTime(time)}</span>
          <span class="text-gray-400 text-xs">(${formatTimeShort(i > 0 ? time - sorted[i - 1] : time)} | ${formatTimeShort(i < sorted.length - 1 ? sorted[i + 1] - time : duration - time)})</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window._seekTo(${time})" class="text-primary-500 hover:text-primary-700 text-xs"><i class="fas fa-crosshairs"></i></button>
          <button onclick="window._removeMarker(${i})" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `).join('');
  }

  // Expose functions for inline event handlers
  window._removeMarker = (i) => removeMarker(i);
  window._seekTo = (time) => {
    if (isPlaying) stopPlayback();
    playOffset = time;
    updatePlayhead();
    updateTimeDisplay();
  };

  $('#btn-add-marker').addEventListener('click', () => addMarker(playOffset));
  $('#btn-clear-markers').addEventListener('click', () => { markers = []; updateMarkersUI(); drawOverlay(); });

  // === Split Mode Tabs ===
  $$('.split-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.split-tab').forEach(t => { t.classList.remove('active', 'text-primary-600', 'border-primary-600'); t.classList.add('text-gray-500', 'border-transparent'); });
      tab.classList.add('active', 'text-primary-600', 'border-primary-600');
      tab.classList.remove('text-gray-500', 'border-transparent');
      $$('.split-mode').forEach(m => m.classList.add('hidden'));
      $(`#mode-${tab.dataset.mode}`).classList.remove('hidden');
    });
  });

  // Init first tab active style
  $$('.split-tab')[0].classList.add('text-primary-600', 'border-primary-600');
  $$('.split-tab')[0].classList.remove('text-gray-500', 'border-transparent');

  // Equal split
  $('#btn-equal-split').addEventListener('click', () => {
    const parts = parseInt($('#equal-parts').value);
    if (parts < 2 || parts > 100) { showToast('2〜100の範囲で指定してください', 'warning'); return; }
    markers = [];
    const interval = duration / parts;
    for (let i = 1; i < parts; i++) {
      markers.push(interval * i);
    }
    updateMarkersUI();
    drawOverlay();
    showToast(`${parts}等分の分割ポイントを生成しました`, 'success');
  });

  // Time-based split
  $('#btn-time-split').addEventListener('click', () => {
    const interval = parseFloat($('#time-interval').value);
    if (interval < 1 || interval > duration) { showToast('有効な間隔を指定してください', 'warning'); return; }
    markers = [];
    for (let t = interval; t < duration - 0.1; t += interval) {
      markers.push(t);
    }
    updateMarkersUI();
    drawOverlay();
    showToast(`${interval}秒間隔で${markers.length}個のポイントを生成しました`, 'success');
  });

  // === FFmpeg Initialization ===
  async function initFFmpeg() {
    if (ffmpegLoaded) return;

    const { FFmpeg } = FFmpegWASM;
    ffmpegInstance = new FFmpeg();

    ffmpegInstance.on('log', ({ message }) => {
      console.log('[ffmpeg]', message);
    });

    ffmpegInstance.on('progress', ({ progress }) => {
      const pct = Math.round(progress * 100);
      progressBar.style.width = pct + '%';
    });

    await ffmpegInstance.load({
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
    });

    ffmpegLoaded = true;
  }

  // === Split Execution ===
  $('#btn-split').addEventListener('click', async () => {
    if (markers.length === 0) return;

    const sortedMarkers = [...markers].sort((a, b) => a - b);
    const segments = [];
    const allPoints = [0, ...sortedMarkers, duration];

    for (let i = 0; i < allPoints.length - 1; i++) {
      segments.push({
        index: i + 1,
        start: allPoints[i],
        end: allPoints[i + 1],
        duration: allPoints[i + 1] - allPoints[i]
      });
    }

    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    $('#btn-split').disabled = true;

    try {
      progressText.textContent = 'FFmpegを初期化中...';
      progressBar.style.width = '0%';
      await initFFmpeg();

      progressText.textContent = 'ファイルを書き込み中...';
      const { fetchFile } = FFmpegUtil;
      const inputExt = audioFile.name.split('.').pop() || 'mp3';
      const inputName = `input.${inputExt}`;
      await ffmpegInstance.writeFile(inputName, await fetchFile(new Blob([fileArrayBuffer])));

      const results = [];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const outputName = `segment_${String(seg.index).padStart(3, '0')}.mp3`;

        progressText.textContent = `セグメント ${seg.index} / ${segments.length} を処理中...`;
        progressBar.style.width = `${Math.round(((i) / segments.length) * 100)}%`;

        await ffmpegInstance.exec([
          '-i', inputName,
          '-ss', seg.start.toFixed(3),
          '-t', seg.duration.toFixed(3),
          '-acodec', 'libmp3lame',
          '-q:a', '2',
          '-y',
          outputName
        ]);

        const data = await ffmpegInstance.readFile(outputName);
        const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        results.push({
          ...seg,
          fileName: outputName,
          blob,
          url,
          size: blob.size
        });

        // Clean up
        await ffmpegInstance.deleteFile(outputName);
      }

      // Clean up input
      await ffmpegInstance.deleteFile(inputName);

      progressBar.style.width = '100%';
      progressText.textContent = '完了!';

      // Show results
      showResults(results);
      showToast(`${results.length}個のセグメントに分割しました`, 'success');
    } catch (err) {
      console.error('Split error:', err);
      showToast('分割処理中にエラーが発生しました: ' + err.message, 'error');
    } finally {
      setTimeout(() => { progressSection.classList.add('hidden'); }, 1000);
      $('#btn-split').disabled = false;
    }
  });

  // === Results Display ===
  function showResults(results) {
    resultsSection.classList.remove('hidden');
    segmentsGrid.innerHTML = '';

    window._downloadResults = results;

    results.forEach((seg) => {
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      const downloadName = `${baseName}_part${String(seg.index).padStart(2, '0')}.mp3`;

      const card = document.createElement('div');
      card.className = 'segment-card bg-white rounded-xl shadow-sm border border-gray-200 p-4 fade-in';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 bg-primary-100 text-primary-700 rounded-lg flex items-center justify-center font-bold text-sm">${seg.index}</span>
            <div>
              <p class="text-sm font-semibold text-gray-800">${downloadName}</p>
              <p class="text-xs text-gray-500">${formatFileSize(seg.size)}</p>
            </div>
          </div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2 mb-3">
          <div class="flex justify-between text-xs text-gray-500">
            <span><i class="far fa-clock mr-1"></i>${formatTime(seg.start)}</span>
            <span class="font-medium text-gray-700">${formatTimeShort(seg.duration)}</span>
            <span>${formatTime(seg.end)}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <audio controls class="flex-1 h-8" style="min-width:0" preload="metadata">
            <source src="${seg.url}" type="audio/mpeg">
          </audio>
        </div>
        <a href="${seg.url}" download="${downloadName}" class="mt-3 w-full px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 block text-center">
          <i class="fas fa-download"></i>ダウンロード
        </a>
      `;
      segmentsGrid.appendChild(card);
    });
  }

  // Download all
  $('#btn-download-all').addEventListener('click', () => {
    const results = window._downloadResults;
    if (!results || results.length === 0) return;

    const baseName = audioFile.name.replace(/\.[^.]+$/, '');
    results.forEach((seg, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = seg.url;
        a.download = `${baseName}_part${String(seg.index).padStart(2, '0')}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 300);
    });
    showToast('全ファイルのダウンロードを開始しました', 'success');
  });

  // === Window Resize ===
  window.addEventListener('resize', () => {
    if (audioBuffer) drawWaveform();
  });

  // Init time display
  updateTimeDisplay(0);

})();
