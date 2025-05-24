# Constellation Viewer

A web application to visualize Earth and satellites in orbit using React, TypeScript, Vite, Three.js, and satellite.js.

## Features

- Render a 3D Earth.
- Visualize satellite positions.
- Show visibility of satellites from a ground station in Tokyo.

## Prerequisites

- Node.js ≥16 and [bun](https://bun.sh/)

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

## Deployment
https://constellation-vis.vercel.app/

## File Formats

### satellites.toml

- Each satellite entry begins with `[[satellites]]`.
- Set `type` to `"tle"` or `"elements"`.
- For `type = "tle"`, provide `line1` and `line2`.
- For `type = "elements"`, provide:
  - `satnum`
  - `epoch` (ISO-8601)
  - `semiMajorAxisKm`
  - `eccentricity`
  - `inclinationDeg`
  - `raanDeg`
  - `argPerigeeDeg`
  - `meanAnomalyDeg`
- Optional metadata fields: `name`, `objectId`, `noradCatId`.

### groundstations.toml

- Each ground station entry begins with `[[groundstations]]`.
- Fields:
  - `name`
  - `latitudeDeg`
  - `longitudeDeg`
  - `heightKm`
  - `minElevationDeg`

### constellation.toml

- Top-level `[constellation]` table defines `name` and `epoch`.
- Each `[[constellation.shells]]` block describes a shell with fields:
  - `name`
  - `count`
  - `planes`
  - `phasing`
  - `apogee_altitude`
  - `eccentricity`
  - `inclination`
  - `raan_range`
- Optional: `raan_start`, `argp`, `mean_anomaly_0`.

---

# Constellation Viewer (日本語)

React、TypeScript、Vite、Three.js、satellite.js を使用して地球と衛星を可視化する Web アプリケーションです。

## 機能

- 3D の地球を描画
- 衛星の位置を表示
- 東京の地上局からの可視性を確認

## 前提条件

- Node.js ≥16 と [bun](https://bun.sh/)

## インストール

```bash
bun install
```

## 開発

以下で開発サーバーを起動できます:

```bash
bun run dev
```

ブラウザで `http://localhost:5173` を開いてください。

## デプロイ
https://constellation-vis.vercel.app/

## ファイル形式

### satellites.toml

- 各衛星は `[[satellites]]` から始まります。
- `type` に `"tle"` または `"elements"` を指定します。
- `type = "tle"` の場合は `line1` と `line2` を記述します。
- `type = "elements"` の場合は次の項目を記述します:
  - `satnum`
  - `epoch` (ISO-8601)
  - `semiMajorAxisKm`
  - `eccentricity`
  - `inclinationDeg`
  - `raanDeg`
  - `argPerigeeDeg`
  - `meanAnomalyDeg`
- 任意で `name`、`objectId`、`noradCatId` を付加できます。

### groundstations.toml

- 各地上局は `[[groundstations]]` から始まります。
- 記述項目:
  - `name`
  - `latitudeDeg`
  - `longitudeDeg`
  - `heightKm`
  - `minElevationDeg`

### constellation.toml

- `[constellation]` テーブルで `name` と `epoch` を定義します。
- `[[constellation.shells]]` には以下を記述します:
  - `name`
  - `count`
  - `planes`
  - `phasing`
  - `apogee_altitude`
  - `eccentricity`
  - `inclination`
  - `raan_range`
- 任意項目: `raan_start`、`argp`、`mean_anomaly_0`。
