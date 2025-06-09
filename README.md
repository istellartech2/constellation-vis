# Constellation Visualizer

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-blue)](https://istellartech2.github.io/constellation-vis/)

A web application that visualizes satellite constellations in Earth orbit.

[constellation-viewer-demo.webm](https://github.com/user-attachments/assets/5389ebab-c38b-4a5f-9e25-4042f1ca3824)

## Features

- Draws a 3D Earth
- Displays satellite positions from orbital elements
- Gets and displays satellite orbital elements from CelesTrak
- Checks visibility from ground stations

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
https://istellartech2.github.io/constellation-vis/

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
- The semi-major axis is computed from apogee altitude and eccentricity as
  `a = (earth_radius + apogee_altitude) / (1 + eccentricity)`.
- Optional: `raan_start`, `argp`, `mean_anomaly_0`.

---

# Constellation Visualizer (日本語)

地球周回軌道の衛星コンステレーションを可視化する Web アプリケーション。

## 機能

- 3Dの地球を描画
- 軌道要素から衛星の位置を表示
- CelesTrakから衛星軌道要素を取得し、表示
- 地上局からの可視性を確認

## 前提条件

- Node.js ≥16 と [bun](https://bun.sh/)

## インストール

リポジトリのフォルダにおいて以下を実行。

```bash
bun install
```

## 開発

以下で開発サーバーを起動。

```bash
bun run dev
```

ブラウザで `http://localhost:5173` を開いてください。

## アプリケーションURL
https://istellartech2.github.io/constellation-vis/

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
 - 遠地点高度と離心率から半長軸を計算します。
   数式は `a = (earth_radius + apogee_altitude) / (1 + eccentricity)` です。
- 任意項目: `raan_start`、`argp`、`mean_anomaly_0`。
