import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/api/*', cors())

// Main HTML page
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MP3 Audio Splitter</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
            dark: { 700: '#334155', 800: '#1e293b', 900: '#0f172a' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    body { font-family: 'Inter', sans-serif; }
    
    .drop-zone { transition: all 0.3s ease; }
    .drop-zone.dragover { border-color: #3b82f6; background: rgba(59, 130, 246, 0.05); transform: scale(1.01); }
    
    .segment-card { transition: all 0.2s ease; }
    .segment-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
    
    #waveform-container { position: relative; cursor: crosshair; }
    #waveform-canvas { width: 100%; height: 160px; }
    #overlay-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 160px; pointer-events: none; }
    #playhead { position: absolute; top: 0; height: 160px; width: 2px; background: #ef4444; pointer-events: none; z-index: 10; display: none; }
    
    .marker { position: absolute; top: 0; height: 100%; width: 2px; background: #f59e0b; cursor: ew-resize; z-index: 5; }
    .marker::after { content: ''; position: absolute; top: -6px; left: -5px; width: 12px; height: 12px; background: #f59e0b; border-radius: 50%; }
    .marker-label { position: absolute; top: -24px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #f59e0b; white-space: nowrap; font-weight: 600; }
    
    .split-region { position: absolute; top: 0; height: 100%; background: rgba(59, 130, 246, 0.12); border-left: 2px solid rgba(59, 130, 246, 0.4); border-right: 2px solid rgba(59, 130, 246, 0.4); pointer-events: none; }
    
    .loading-spinner { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    
    .progress-bar { transition: width 0.3s ease; }
    
    .fade-in { animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    
    .toast { animation: slideIn 0.3s ease-out, fadeOut 0.3s ease-in 2.7s; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 16px; height: 16px; border-radius: 50%;
      background: #3b82f6; cursor: pointer; border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    input[type="range"] {
      -webkit-appearance: none; appearance: none;
      height: 4px; background: #e2e8f0; border-radius: 2px; outline: none;
    }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <header class="bg-white border-b border-gray-200 shadow-sm">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
          <i class="fas fa-scissors text-white text-lg"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold text-gray-900">MP3 Audio Splitter</h1>
          <p class="text-xs text-gray-500">ブラウザで完結する音声分割ツール</p>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-400">
        <i class="fas fa-lock"></i>
        <span>すべてブラウザ内で処理 - サーバーへのアップロードなし</span>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- Upload Section -->
    <div id="upload-section">
      <div id="drop-zone" class="drop-zone border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center bg-white hover:border-primary-400 cursor-pointer">
        <div class="space-y-4">
          <div class="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center mx-auto">
            <i class="fas fa-cloud-upload-alt text-primary-500 text-3xl"></i>
          </div>
          <div>
            <p class="text-lg font-semibold text-gray-700">MP3ファイルをドラッグ＆ドロップ</p>
            <p class="text-sm text-gray-500 mt-1">または<span class="text-primary-600 font-medium underline">クリックしてファイルを選択</span></p>
          </div>
          <p class="text-xs text-gray-400">対応形式: MP3 / WAV / OGG / M4A / FLAC</p>
          <p class="text-xs text-green-600 mt-1 font-medium"><i class="fas fa-check-circle mr-1"></i>大容量ファイル対応 - メモリ効率最適化済み</p>
        </div>
        <input type="file" id="file-input" accept="audio/*" class="hidden">
      </div>
    </div>

    <!-- Editor Section (hidden initially) -->
    <div id="editor-section" class="hidden">
      <!-- File Info Bar -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center justify-between fade-in">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
            <i class="fas fa-music text-primary-600"></i>
          </div>
          <div>
            <p id="file-name" class="font-semibold text-gray-800"></p>
            <p id="file-info" class="text-xs text-gray-500"></p>
          </div>
        </div>
        <button id="btn-new-file" class="text-sm text-gray-500 hover:text-primary-600 flex items-center gap-1 transition">
          <i class="fas fa-redo"></i>
          <span>別のファイル</span>
        </button>
      </div>

      <!-- Waveform -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 fade-in">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <i class="fas fa-wave-square text-primary-500"></i>
            波形ビュー
          </h2>
          <div class="flex items-center gap-2">
            <label class="text-xs text-gray-500">ズーム:</label>
            <input type="range" id="zoom-slider" min="1" max="10" value="1" step="0.5" class="w-24">
          </div>
        </div>
        <div id="waveform-container" class="bg-gray-900 rounded-lg overflow-hidden relative">
          <canvas id="waveform-canvas"></canvas>
          <canvas id="overlay-canvas"></canvas>
          <div id="playhead"></div>
        </div>
        <div class="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span id="time-start">0:00.000</span>
          <span id="time-current" class="font-mono text-primary-600 font-semibold text-sm"></span>
          <span id="time-end">0:00.000</span>
        </div>

        <!-- Playback Controls -->
        <div class="flex items-center justify-center gap-3 mt-4">
          <button id="btn-play" class="w-12 h-12 bg-primary-600 hover:bg-primary-700 text-white rounded-full flex items-center justify-center transition shadow-md">
            <i class="fas fa-play" id="play-icon"></i>
          </button>
          <button id="btn-stop" class="w-10 h-10 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-full flex items-center justify-center transition">
            <i class="fas fa-stop"></i>
          </button>
          <div class="flex items-center gap-2 ml-4">
            <i class="fas fa-volume-up text-gray-400 text-sm"></i>
            <input type="range" id="volume-slider" min="0" max="1" value="1" step="0.05" class="w-20">
          </div>
        </div>
      </div>

      <!-- Split Controls -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 fade-in">
        <h2 class="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-4">
          <i class="fas fa-cut text-primary-500"></i>
          分割設定
        </h2>

        <!-- Split Mode Tabs -->
        <div class="flex border-b border-gray-200 mb-6">
          <button class="split-tab active px-4 py-2 text-sm font-medium border-b-2 transition" data-mode="manual">
            <i class="fas fa-hand-pointer mr-1"></i>手動分割
          </button>
          <button class="split-tab px-4 py-2 text-sm font-medium border-b-2 transition" data-mode="equal">
            <i class="fas fa-equals mr-1"></i>等間隔分割
          </button>
          <button class="split-tab px-4 py-2 text-sm font-medium border-b-2 transition" data-mode="time">
            <i class="fas fa-clock mr-1"></i>時間指定分割
          </button>
        </div>

        <!-- Manual Split Mode -->
        <div id="mode-manual" class="split-mode">
          <p class="text-sm text-gray-600 mb-4">波形をクリックして分割ポイントを追加してください。ポイントはドラッグで移動できます。</p>
          <div class="flex items-center gap-3">
            <button id="btn-add-marker" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition flex items-center gap-2">
              <i class="fas fa-plus"></i>現在位置にマーカー追加
            </button>
            <button id="btn-clear-markers" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition flex items-center gap-2">
              <i class="fas fa-trash"></i>全マーカー削除
            </button>
          </div>
          <div id="markers-list" class="mt-4 space-y-2"></div>
        </div>

        <!-- Equal Split Mode -->
        <div id="mode-equal" class="split-mode hidden">
          <p class="text-sm text-gray-600 mb-4">ファイルを均等な時間で分割します。</p>
          <div class="flex items-center gap-4">
            <div>
              <label class="text-xs text-gray-500 block mb-1">分割数</label>
              <input type="number" id="equal-parts" value="2" min="2" max="100" class="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none">
            </div>
            <button id="btn-equal-split" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2 mt-5">
              <i class="fas fa-columns"></i>分割ポイント生成
            </button>
          </div>
        </div>

        <!-- Time-based Split Mode -->
        <div id="mode-time" class="split-mode hidden">
          <p class="text-sm text-gray-600 mb-4">固定の時間間隔で分割します。分と秒を指定してください。</p>
          
          <!-- Preset Buttons -->
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <span class="text-xs text-gray-500 mr-1">プリセット:</span>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="0" data-seconds="30">30秒</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="1" data-seconds="0">1分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="2" data-seconds="0">2分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="3" data-seconds="0">3分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="5" data-seconds="0">5分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="10" data-seconds="0">10分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="15" data-seconds="0">15分</button>
            <button class="time-preset px-3 py-1.5 bg-gray-100 hover:bg-primary-100 hover:text-primary-700 text-gray-600 rounded-lg text-xs font-medium transition border border-gray-200 hover:border-primary-300" data-minutes="30" data-seconds="0">30分</button>
          </div>

          <!-- Minutes / Seconds Input -->
          <div class="flex items-end gap-3">
            <div>
              <label class="text-xs text-gray-500 block mb-1">分</label>
              <input type="number" id="time-minutes" value="1" min="0" max="999" class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-center">
            </div>
            <span class="text-gray-400 font-bold pb-2">:</span>
            <div>
              <label class="text-xs text-gray-500 block mb-1">秒</label>
              <input type="number" id="time-seconds" value="0" min="0" max="59" class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-center">
            </div>
            <div class="pb-0.5">
              <span id="time-interval-preview" class="text-xs text-gray-400 block mb-1"></span>
              <button id="btn-time-split" class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2">
                <i class="fas fa-clock"></i>分割ポイント生成
              </button>
            </div>
          </div>
        </div>

        <!-- Split Action -->
        <div class="mt-6 pt-6 border-t border-gray-200 flex items-center justify-between">
          <div>
            <span class="text-sm text-gray-600">分割ポイント: <strong id="marker-count" class="text-primary-600">0</strong> 個</span>
            <span class="text-sm text-gray-600 ml-4">セグメント数: <strong id="segment-count" class="text-primary-600">1</strong></span>
          </div>
          <button id="btn-split" class="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
            <i class="fas fa-scissors"></i>
            分割を実行
          </button>
        </div>
      </div>

      <!-- Processing Progress -->
      <div id="progress-section" class="hidden bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 fade-in">
        <div class="flex items-center gap-3 mb-4">
          <div class="loading-spinner">
            <i class="fas fa-circle-notch text-primary-600 text-xl"></i>
          </div>
          <div>
            <p class="font-semibold text-gray-800">分割処理中...</p>
            <p id="progress-text" class="text-xs text-gray-500">初期化しています</p>
          </div>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div id="progress-bar" class="progress-bar bg-primary-600 h-2 rounded-full" style="width: 0%"></div>
        </div>
      </div>

      <!-- Results Section -->
      <div id="results-section" class="hidden fade-in">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2">
            <i class="fas fa-check-circle text-green-500"></i>
            分割結果
          </h2>
          <button id="btn-download-all" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2">
            <i class="fas fa-download"></i>
            すべてダウンロード
          </button>
        </div>
        <div id="segments-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      </div>
    </div>
  </main>

  <!-- Toast Container -->
  <div id="toast-container" class="fixed bottom-4 right-4 space-y-2 z-50"></div>

  <!-- Loading Overlay -->
  <div id="loading-overlay" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl">
      <div class="loading-spinner">
        <i class="fas fa-circle-notch text-primary-600 text-3xl"></i>
      </div>
      <p id="loading-text" class="text-gray-700 font-medium">音声を読み込んでいます...</p>
    </div>
  </div>

  <script src="/static/ffmpeg/ffmpeg.min.js"></script>
  <script src="/static/ffmpeg/util.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
