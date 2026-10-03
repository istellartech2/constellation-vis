# Constellation Visualizer

[![Vercel](https://img.shields.io/badge/Vercel-Live%20Demo-black)](https://constellation-vis-rho.vercel.app/)

A web application that visualizes satellite constellations in Earth orbit.

[constellation-viewer-demo.webm](https://github.com/user-attachments/assets/5389ebab-c38b-4a5f-9e25-4042f1ca3824)

## Features

- 3D Earth with selectable textures and day/night lighting
- Plot satellites from TLE strings or Keplerian elements
- Generate constellations from six design patterns (Walker Delta/Star, Streets of Coverage, Flower, Lattice Flower, Necklace Flower) or from a mission-driven design wizard (see `docs/constellation-patterns.md` / `docs/constellation-design.md`)
- Import live orbital data from CelesTrak (cached in IndexedDB so subsequent loads work offline and gracefully fall back when CelesTrak rate-limits a group)
- Define ground stations on a map and visualize their visibility cones (elevation, off-nadir, or both)
- Define the satellite sensor FOV (half-angle plus along-track / cross-track tilt) in one place (Display options › Satellite FOV) and reuse it for both the 3D cone and the station-access analysis
- Apply a per-shell failure model (fixed count or percentage, deterministic draw)
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

Live build: https://constellation-vis-rho.vercel.app/

Hosted in the Interstellar Technologies Inc Vercel team. The GitHub repository is connected to Vercel: pushes to `main` deploy production; other branches receive preview deployments. `vercel.json` runs lint, the Bun test suite, TypeScript and Vite before publishing, so a failed check prevents release. GitHub Actions independently runs CI (including the native CLI build). The previous GitHub Pages workflow is retained for manual legacy deployments only.

The root Vite base path is `/`; manual GitHub Pages builds explicitly set `BASE_URL=/constellation-vis/`.

### Private AI sessions

In the scenario menu, start **AI連携**, copy the connection instructions, and give them to an external AI. HTTP updates are automatically reflected in the connected browser. Sessions use independent browser/controller Bearer tokens, encrypted Redis data, a fixed one-hour TTL and optimistic revisions. Ending a session deletes the live record. See [`public/ai-api.md`](public/ai-api.md) for the protocol, privacy boundaries, limits and curl examples.

Server-only environment variables:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`): supplied by the project's Upstash integration.
- `SESSION_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Set as a sensitive production/preview variable; never use a `VITE_` prefix. Changing it invalidates existing encrypted sessions.

For local API development use `vercel dev` with development Redis credentials and a separate local encryption key. Plain `bun run dev` runs only the Vite frontend. Production and preview Redis keys are namespaced separately. Secrets, local environments, simulation run outputs and local datasets are excluded from deploy uploads.

---

# Constellation Visualizer (日本語)

地球周回軌道の衛星コンステレーションを可視化する Web アプリケーション。

## 機能

- 3D の地球を複数のテクスチャ・昼夜ライティングで描画
- TLE / Keplerian 軌道要素から衛星をプロット
- 6 種類の設計方式(Walker Delta/Star, Streets of Coverage, Flower, Lattice Flower, Necklace Flower)またはミッションから設計するウィザードでコンステレーションを生成(`docs/constellation-patterns.md` / `docs/constellation-design.md` 参照)
- CelesTrak から軌道データをインポート（IndexedDB にキャッシュし、レート制限時は前回データへ自動フォールバック）
- 地図上で地上局を定義し、可視範囲（仰角・オフナディア・両方）を可視化
- 衛星のセンサ視野（視野半角・Along-track / Cross-track 傾き）を「表示オプション › 衛星の視野」で 1 か所だけ定義し、3D のコーン表示と地上局アクセス解析の可視条件で共通利用
- コンステレーションのシェル単位で故障モデル（機数指定／割合指定、決定論的な抽選）を適用
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

https://constellation-vis-rho.vercel.app/
