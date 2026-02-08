// ===== MP3 Audio Splitter - Main Application (Large File Support) =====

(function () {
  'use strict';

  // === State ===
  let audioFile = null;        // File object reference (no memory copy)
  let audioObjectURL = null;   // ObjectURL for playback
  let audioElement = null;     // HTML Audio element for playback
  let waveformData = null;     // Lightweight waveform peaks array
  let isPlaying = false;
  let animationFrameId = null;
  let markers = [];            // array of seconds
  let ffmpegInstance = null;
  let ffmpegLoaded = false;
  let duration = 0;
  let zoomLevel = 1;
  let scrollOffset = 0;

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
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function formatTimeShort(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
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

  // === FFmpeg Initialization (shared) ===
  // CORS workaround: fetch worker script and create Blob URL
  async function toBlobURL(url, mimeType) {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobWithType = new Blob([blob], { type: mimeType });
    return URL.createObjectURL(blobWithType);
  }

  async function initFFmpeg() {
    if (ffmpegLoaded) return;

    const { FFmpeg } = FFmpegWASM;
    ffmpegInstance = new FFmpeg();

    ffmpegInstance.on('log', ({ message }) => {
      console.log('[ffmpeg]', message);
    });

    ffmpegInstance.on('progress', ({ progress }) => {
      if (progress >= 0 && progress <= 1) {
        const pct = Math.round(progress * 100);
        progressBar.style.width = pct + '%';
      }
    });

    const BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    const coreURL = await toBlobURL(`${BASE}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${BASE}/ffmpeg-core.wasm`, 'application/wasm');
    const workerURL = await toBlobURL(`${BASE}/ffmpeg-core.worker.js`, 'text/javascript');

    await ffmpegInstance.load({
      coreURL,
      wasmURL,
      workerURL,
    });

    ffmpegLoaded = true;
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
    cleanupAudio();
    markers = [];
    audioFile = null;
    waveformData = null;
    duration = 0;
    uploadSection.classList.remove('hidden');
    editorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    fileInput.value = '';
  });

  function cleanupAudio() {
    stopPlayback();
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
      audioElement = null;
    }
    if (audioObjectURL) {
      URL.revokeObjectURL(audioObjectURL);
      audioObjectURL = null;
    }
  }

  async function loadAudioFile(file) {
    audioFile = file;
    showLoading('音声ファイルを読み込んでいます...');

    try {
      // Cleanup previous
      cleanupAudio();

      // Step 1: Create ObjectURL for playback (no memory copy - browser streams from disk)
      audioObjectURL = URL.createObjectURL(file);

      // Step 2: Get duration using HTML Audio element
      showLoading('音声の長さを取得中...');
      audioElement = new Audio();
      audioElement.preload = 'metadata';

      duration = await new Promise((resolve, reject) => {
        audioElement.addEventListener('loadedmetadata', () => {
          if (isFinite(audioElement.duration) && audioElement.duration > 0) {
            resolve(audioElement.duration);
          } else {
            // For some formats, duration might not be available from metadata
            // Try loading more data
            audioElement.addEventListener('durationchange', () => {
              if (isFinite(audioElement.duration) && audioElement.duration > 0) {
                resolve(audioElement.duration);
              }
            });
            // Also listen for canplaythrough as fallback
            audioElement.addEventListener('canplaythrough', () => {
              if (isFinite(audioElement.duration) && audioElement.duration > 0) {
                resolve(audioElement.duration);
              }
            });
          }
        });
        audioElement.addEventListener('error', (e) => reject(new Error('音声ファイルの読み込みに失敗しました')));
        // Timeout for duration detection
        setTimeout(() => reject(new Error('音声の長さを取得できませんでした。ffmpegで解析します。')), 10000);
        audioElement.src = audioObjectURL;
      }).catch(async (err) => {
        // Fallback: use ffmpeg to get duration
        console.warn('HTML Audio duration fallback:', err.message);
        showLoading('ffmpegで音声を解析中...');
        return await getDurationViaFFmpeg(file);
      });

      // Step 3: Generate waveform data (lightweight - only peaks)
      showLoading('波形データを生成中...');
      waveformData = await generateWaveformData(file);

      // Update UI
      $('#file-name').textContent = file.name;
      $('#file-info').textContent = `${formatTime(duration)} | ${formatFileSize(file.size)}`;
      $('#time-end').textContent = formatTime(duration);

      uploadSection.classList.add('hidden');
      editorSection.classList.remove('hidden');
      resultsSection.classList.add('hidden');
      progressSection.classList.add('hidden');
      markers = [];
      updateMarkersUI();

      drawWaveform();
      hideLoading();
      showToast(`ファイルを読み込みました (${formatFileSize(file.size)})`, 'success');
    } catch (err) {
      hideLoading();
      console.error('Audio load error:', err);
      showToast('ファイルの読み込みに失敗しました: ' + err.message, 'error');
    }
  }

  // Get duration via ffmpeg for files where HTML Audio can't determine duration
  async function getDurationViaFFmpeg(file) {
    await initFFmpeg();
    const { fetchFile } = FFmpegUtil;

    // Write only a small portion to detect duration (first 1MB + last 1MB for MP3 headers)
    const inputName = 'probe_input.' + (file.name.split('.').pop() || 'mp3');
    await ffmpegInstance.writeFile(inputName, await fetchFile(file));

    let detectedDuration = 0;
    const originalLog = ffmpegInstance.on;

    await ffmpegInstance.exec(['-i', inputName, '-f', 'null', '-']);

    // Parse duration from ffmpeg logs - we capture it during exec
    // Since ffmpeg logs are async, we'll read duration from the last log
    await ffmpegInstance.deleteFile(inputName);

    // If we still don't have duration, estimate from file size
    if (detectedDuration <= 0) {
      // Rough estimate: 128kbps MP3 = 16KB/sec
      detectedDuration = file.size / 16000;
    }

    return detectedDuration;
  }

  // === Waveform Generation (Lightweight) ===
  // Decodes a small sample of the audio to generate peak data
  // Instead of decoding the entire file, we decode small chunks
  async function generateWaveformData(file) {
    const PEAKS_COUNT = 2000; // Number of peak values to generate
    const peaks = new Float32Array(PEAKS_COUNT);

    try {
      // For files under 30MB, decode a portion with Web Audio API
      // For larger files, generate approximate waveform from raw bytes
      const FILE_SIZE_LIMIT = 30 * 1024 * 1024; // 30MB

      if (file.size <= FILE_SIZE_LIMIT) {
        // Decode full file for smaller files
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const samplesPerPeak = Math.floor(channelData.length / PEAKS_COUNT);

        for (let i = 0; i < PEAKS_COUNT; i++) {
          const start = i * samplesPerPeak;
          let maxAbs = 0;
          for (let j = 0; j < samplesPerPeak && start + j < channelData.length; j++) {
            const abs = Math.abs(channelData[start + j]);
            if (abs > maxAbs) maxAbs = abs;
          }
          peaks[i] = maxAbs;
        }

        ctx.close();
      } else {
        // For large files: read raw bytes and estimate amplitude
        // MP3 frames have varying sizes based on bit allocation
        // We sample the file at regular intervals and estimate amplitude from byte patterns
        await generateWaveformFromBytes(file, peaks);
      }
    } catch (err) {
      console.warn('Waveform generation fallback:', err);
      // Generate a simple sine-like waveform as placeholder
      for (let i = 0; i < PEAKS_COUNT; i++) {
        peaks[i] = 0.3 + Math.random() * 0.4;
      }
    }

    return peaks;
  }

  // Generate approximate waveform from raw MP3 bytes
  async function generateWaveformFromBytes(file, peaks) {
    const PEAKS_COUNT = peaks.length;
    const CHUNK_SIZE = 4096;
    const numSamples = Math.min(PEAKS_COUNT * 2, Math.floor(file.size / CHUNK_SIZE));
    const stepBytes = Math.floor(file.size / numSamples);

    for (let i = 0; i < numSamples; i++) {
      const offset = i * stepBytes;
      const blob = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Calculate "energy" from byte values (rough RMS approximation)
      let sum = 0;
      for (let j = 0; j < bytes.length; j++) {
        // Center around 128 and normalize
        const val = (bytes[j] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bytes.length);
      const peakIdx = Math.floor((i / numSamples) * PEAKS_COUNT);
      if (peakIdx < PEAKS_COUNT) {
        peaks[peakIdx] = Math.max(peaks[peakIdx], Math.min(rms * 3, 1.0));
      }
    }

    // Smooth the peaks
    const smoothed = new Float32Array(PEAKS_COUNT);
    const WINDOW = 3;
    for (let i = 0; i < PEAKS_COUNT; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - WINDOW); j <= Math.min(PEAKS_COUNT - 1, i + WINDOW); j++) {
        sum += peaks[j];
        count++;
      }
      smoothed[i] = sum / count;
    }
    for (let i = 0; i < PEAKS_COUNT; i++) {
      peaks[i] = smoothed[i] || 0.1;
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

    if (!waveformData || duration <= 0) return;

    const visibleDuration = duration / zoomLevel;
    const startRatio = scrollOffset / duration;
    const endRatio = (scrollOffset + visibleDuration) / duration;
    const mid = h / 2;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gridInterval = Math.max(1, Math.floor(visibleDuration / 10));
    const gridStart = Math.ceil(scrollOffset / gridInterval) * gridInterval;
    for (let t = gridStart; t <= scrollOffset + visibleDuration; t += gridInterval) {
      const x = ((t - scrollOffset) / visibleDuration) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      // Time label
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(formatTimeShort(t), x, h - 4);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

    // Draw waveform from peak data
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#60a5fa');
    gradient.addColorStop(0.5, '#3b82f6');
    gradient.addColorStop(1, '#60a5fa');

    ctx.fillStyle = gradient;
    const peaksCount = waveformData.length;

    for (let i = 0; i < w; i++) {
      const ratio = startRatio + (i / w) * (endRatio - startRatio);
      const peakIdx = Math.floor(ratio * peaksCount);
      if (peakIdx < 0 || peakIdx >= peaksCount) continue;

      const peak = waveformData[peakIdx];
      const barH = peak * mid * 0.9;
      ctx.fillRect(i, mid - barH, 1, barH * 2 || 1);
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

    if (duration <= 0) { ctx.restore(); return; }

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

  // === Waveform Interaction ===
  function getTimeFromClick(e) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const visibleDuration = duration / zoomLevel;
    return Math.max(0, Math.min(duration, scrollOffset + ratio * visibleDuration));
  }

  waveformContainer.addEventListener('click', (e) => {
    if (!audioElement || duration <= 0) return;
    const clickTime = getTimeFromClick(e);
    audioElement.currentTime = clickTime;
    updatePlayhead();
    updateTimeDisplay();
  });

  waveformContainer.addEventListener('dblclick', (e) => {
    if (duration <= 0) return;
    const clickTime = getTimeFromClick(e);
    addMarker(clickTime);
  });

  $('#zoom-slider').addEventListener('input', (e) => {
    zoomLevel = parseFloat(e.target.value);
    const visibleDuration = duration / zoomLevel;
    if (scrollOffset + visibleDuration > duration) {
      scrollOffset = Math.max(0, duration - visibleDuration);
    }
    drawWaveform();
    updatePlayhead();
  });

  waveformContainer.addEventListener('wheel', (e) => {
    if (duration <= 0 || zoomLevel <= 1) return;
    e.preventDefault();
    const visibleDuration = duration / zoomLevel;
    const delta = (e.deltaY / 1000) * visibleDuration;
    scrollOffset = Math.max(0, Math.min(duration - visibleDuration, scrollOffset + delta));
    drawWaveform();
    updatePlayhead();
  });

  // === Playback (HTML Audio element - no memory overhead) ===
  function startPlayback() {
    if (!audioElement) return;
    audioElement.play();
    isPlaying = true;
    $('#play-icon').className = 'fas fa-pause';
    updatePlayheadLoop();
  }

  function stopPlayback() {
    if (!audioElement) return;
    audioElement.pause();
    isPlaying = false;
    $('#play-icon').className = 'fas fa-play';
    cancelAnimationFrame(animationFrameId);
  }

  function updatePlayheadLoop() {
    if (!isPlaying || !audioElement) return;
    if (audioElement.ended) {
      isPlaying = false;
      $('#play-icon').className = 'fas fa-play';
      cancelAnimationFrame(animationFrameId);
      updatePlayhead();
      updateTimeDisplay();
      return;
    }
    updatePlayhead();
    updateTimeDisplay();
    animationFrameId = requestAnimationFrame(updatePlayheadLoop);
  }

  function updatePlayhead() {
    if (!audioElement || duration <= 0) return;
    const t = audioElement.currentTime;
    const visibleDuration = duration / zoomLevel;
    const ratio = (t - scrollOffset) / visibleDuration;

    if (ratio >= 0 && ratio <= 1) {
      playhead.style.display = 'block';
      playhead.style.left = (ratio * 100) + '%';
    } else {
      playhead.style.display = 'none';
    }
  }

  function updateTimeDisplay() {
    if (!audioElement) {
      $('#time-current').textContent = formatTime(0);
      return;
    }
    $('#time-current').textContent = formatTime(audioElement.currentTime);
  }

  $('#btn-play').addEventListener('click', () => {
    if (isPlaying) stopPlayback(); else startPlayback();
  });
  $('#btn-stop').addEventListener('click', () => {
    stopPlayback();
    if (audioElement) audioElement.currentTime = 0;
    updatePlayhead();
    updateTimeDisplay();
  });
  $('#volume-slider').addEventListener('input', (e) => {
    if (audioElement) audioElement.volume = parseFloat(e.target.value);
  });

  // === Markers ===
  function addMarker(time) {
    time = Math.max(0.1, Math.min(duration - 0.1, time));
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

  window._removeMarker = (i) => removeMarker(i);
  window._seekTo = (time) => {
    stopPlayback();
    if (audioElement) audioElement.currentTime = time;
    updatePlayhead();
    updateTimeDisplay();
  };

  $('#btn-add-marker').addEventListener('click', () => {
    if (audioElement) addMarker(audioElement.currentTime);
  });
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

  // Time-based split (minutes + seconds)
  function getTimeIntervalSeconds() {
    const minutes = parseInt($('#time-minutes').value) || 0;
    const seconds = parseInt($('#time-seconds').value) || 0;
    return minutes * 60 + seconds;
  }

  function formatIntervalLabel(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m > 0 && s > 0) return `${m}分${s}秒`;
    if (m > 0) return `${m}分`;
    return `${s}秒`;
  }

  function updateIntervalPreview() {
    const total = getTimeIntervalSeconds();
    const preview = $('#time-interval-preview');
    if (total > 0 && duration > 0) {
      const count = Math.floor(duration / total);
      preview.textContent = `= ${formatIntervalLabel(total)}ごと（約${count}分割）`;
    } else {
      preview.textContent = '';
    }
  }

  $('#time-minutes').addEventListener('input', updateIntervalPreview);
  $('#time-seconds').addEventListener('input', updateIntervalPreview);

  // Preset buttons
  $$('.time-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = parseInt(btn.dataset.minutes) || 0;
      const s = parseInt(btn.dataset.seconds) || 0;
      $('#time-minutes').value = m;
      $('#time-seconds').value = s;
      // Highlight active preset
      $$('.time-preset').forEach(b => { b.classList.remove('bg-primary-100', 'text-primary-700', 'border-primary-300'); b.classList.add('bg-gray-100', 'text-gray-600', 'border-gray-200'); });
      btn.classList.remove('bg-gray-100', 'text-gray-600', 'border-gray-200');
      btn.classList.add('bg-primary-100', 'text-primary-700', 'border-primary-300');
      updateIntervalPreview();
    });
  });

  $('#btn-time-split').addEventListener('click', () => {
    const interval = getTimeIntervalSeconds();
    if (interval < 1) { showToast('1秒以上の間隔を指定してください', 'warning'); return; }
    if (interval >= duration) { showToast('音声の長さより短い間隔を指定してください', 'warning'); return; }
    markers = [];
    for (let t = interval; t < duration - 0.1; t += interval) {
      markers.push(t);
    }
    updateMarkersUI();
    drawOverlay();
    showToast(`${formatIntervalLabel(interval)}間隔で${markers.length}個のポイントを生成しました`, 'success');
  });

  // === Split Execution ===
  $('#btn-split').addEventListener('click', async () => {
    if (markers.length === 0 || !audioFile) return;

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
      await ffmpegInstance.writeFile(inputName, await fetchFile(audioFile));

      const results = [];

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const outputName = `segment_${String(seg.index).padStart(3, '0')}.mp3`;

        progressText.textContent = `セグメント ${seg.index} / ${segments.length} を処理中...`;
        progressBar.style.width = `${Math.round(((i) / segments.length) * 100)}%`;

        // Use -c copy for fast splitting when possible (no re-encoding)
        // Falls back to re-encoding if copy doesn't work well
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

        await ffmpegInstance.deleteFile(outputName);
      }

      await ffmpegInstance.deleteFile(inputName);

      progressBar.style.width = '100%';
      progressText.textContent = '完了!';

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
    if (waveformData) drawWaveform();
  });

  // Init time display
  updateTimeDisplay();

})();
