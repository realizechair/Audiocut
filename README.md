# MP3 Audio Splitter

## プロジェクト概要
- **名前**: MP3 Audio Splitter
- **目的**: ブラウザ上で完結する音声ファイル分割ツール
- **特徴**: サーバーへのアップロード不要、すべてクライアントサイドで処理

## URL
- **アプリ（本番）**: https://9d172605-3171-479c-b4ef-57d89d40c936.vip.gensparksite.com/
- **GitHub**: https://github.com/realizechair/Audiocut

## 主な機能

### 実装済み
- **ファイルアップロード**: ドラッグ&ドロップ / クリック選択（MP3, WAV, OGG, M4A, FLAC対応）
- **大容量ファイル対応**: メモリ効率を最適化。30MB以下は高精度波形、30MB以上は近似波形で表示
- **波形ビジュアライゼーション**: Web Audio APIによるリアルタイム波形表示
- **再生コントロール**: 再生/一時停止/停止、音量調整、波形クリックでシーク
- **ズーム&スクロール**: 波形の拡大表示とホイールスクロール
- **3つの分割モード**:
  - 手動分割: 波形ダブルクリックまたはボタンでマーカー追加
  - 等間隔分割: 指定した分割数で均等に分割
  - 時間指定分割: 分・秒単位で間隔を指定（プリセットボタン: 30秒/1分/2分/3分/5分/10分/15分/30分）
- **分割処理**: ffmpeg.wasmによるブラウザ内MP3分割（MP3 LAME エンコード）
- **結果プレビュー**: 各セグメントの再生プレビュー
- **ダウンロード**: 個別ダウンロード / 一括ダウンロード

### ファイルサイズ目安
| ファイルサイズ | 波形 | 再生 | 分割 |
|---|---|---|---|
| ~30MB | 高精度（完全デコード） | OK | OK |
| 30~300MB | 近似（バイト解析） | OK | OK |
| 300MB~ | 近似 | OK | ffmpeg.wasmメモリ依存 |

## 使い方
1. MP3ファイルをドラッグ&ドロップまたはクリックして選択
2. 波形が表示されたら、分割モードを選択
   - **手動分割**: 波形をダブルクリックして分割ポイントを追加
   - **等間隔分割**: 分割数を指定して「分割ポイント生成」をクリック
   - **時間指定分割**: 分・秒を指定（またはプリセットボタン）して「分割ポイント生成」
3. 「分割を実行」ボタンをクリック
4. 初回はFFmpegエンジン（約31MB）のダウンロードがあります（進捗表示あり）
5. 各セグメントをプレビュー再生し、ダウンロード

## 技術スタック
- **バックエンド**: Hono (Cloudflare Pages)
- **フロントエンド**: Vanilla JS + Tailwind CSS (CDN)
- **音声処理**: ffmpeg.wasm v0.12（ブラウザ内、CDNからBlobURL読み込み）
- **波形表示**: Web Audio API + Canvas
- **アイコン**: Font Awesome 6

## アーキテクチャ
- ffmpeg.wasmのメインライブラリ（ffmpeg.min.js, 814.ffmpeg.js, util.js）はローカルホスト
- ffmpeg-core（ffmpeg-core.js, ffmpeg-core.wasm 約31MB）はCDNからfetch→BlobURL化
  - unpkg.com（プライマリ）→ cdn.jsdelivr.net（フォールバック）
  - プログレス表示、リトライ（最大3回、指数バックオフ）、2分タイムアウト
- 再生はHTML Audio + ObjectURL（メモリ効率最適）
- decodeAudioDataは30MB以下のファイルのみ（波形表示用）

## デプロイ
- **プラットフォーム**: Cloudflare Pages (via GenSpark)
- **ステータス**: 稼働中
- **最終更新**: 2026-02-09

## プロジェクト構造
```
webapp/
├── src/
│   └── index.tsx              # Honoアプリケーション（メインHTML含む）
├── public/
│   └── static/
│       ├── app.js             # フロントエンドメインロジック
│       ├── style.css          # カスタムスタイル
│       └── ffmpeg/
│           ├── ffmpeg.min.js  # FFmpeg メインライブラリ
│           ├── 814.ffmpeg.js  # FFmpeg Workerチャンク
│           └── util.js        # FFmpeg ユーティリティ
├── dist/                      # ビルド出力
├── ecosystem.config.cjs       # PM2設定
├── wrangler.jsonc             # Cloudflare設定
├── vite.config.ts             # Vite設定
├── package.json
└── README.md
```
