# Constellation Visualizer

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-blue)](https://istellartech2.github.io/constellation-vis/)

A web application that visualizes satellite constellations in Earth orbit.

[constellation-viewer-demo.webm](https://github.com/user-attachments/assets/5389ebab-c38b-4a5f-9e25-4042f1ca3824)

## Features

- 3D Earth with selectable textures and day/night lighting
- Plot satellites from TLE strings or Keplerian elements
- Generate constellations from Walker-pattern shell definitions
- Import live orbital data from CelesTrak (cached in IndexedDB so subsequent loads work offline and gracefully fall back when CelesTrak rate-limits a group)
- Define ground stations on a map and visualize their visibility cones (elevation, off-nadir, or both)
- Analysis tab for access and coverage statistics
- Save / load the entire configuration as a single `settings.toml` bundle

## Prerequisites

- [bun](https://bun.sh/) ≥ 1.0

## Installation

```bash
bun install
```

## Development

Start the development server with hot module replacement:

```bash
bun run dev
```

Open your browser and visit `http://localhost:5173`.

### Running Tests

Run the test suite (Bun native test runner):

```bash
bun run test
```

Lint the codebase:

```bash
bun run lint
```

Build for production:

```bash
bun run build
```

## Deployment

Live build: https://istellartech2.github.io/constellation-vis/

---

# Constellation Visualizer (日本語)

地球周回軌道の衛星コンステレーションを可視化する Web アプリケーション。

## 機能

- 3D の地球を複数のテクスチャ・昼夜ライティングで描画
- TLE / Keplerian 軌道要素から衛星をプロット
- Walker パターンのシェル定義からコンステレーションを生成
- CelesTrak から軌道データをインポート（IndexedDB にキャッシュし、レート制限時は前回データへ自動フォールバック）
- 地図上で地上局を定義し、可視範囲（仰角・オフナディア・両方）を可視化
- アクセス・カバレッジを集計する解析タブ
- 設定一式を `settings.toml` 1 ファイルにまとめて保存／読み込み

## 前提条件

- [bun](https://bun.sh/) 1.0 以上

## インストール

リポジトリのフォルダで以下を実行:

```bash
bun install
```

## 開発

開発サーバーを起動:

```bash
bun run dev
```

ブラウザで `http://localhost:5173` を開いてください。

### テスト実行

```bash
bun run test
```

コード検査:

```bash
bun run lint
```

本番ビルド:

```bash
bun run build
```

## アプリケーション URL

https://istellartech2.github.io/constellation-vis/
