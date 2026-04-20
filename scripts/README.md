# scripts ディレクトリ概要

このディレクトリには、ビルド時のデータ生成スクリプトと、可視性評価用の補助スクリプトが入っています。

## 先に押さえること

- もっとも重要なのは [`generate-satellites.ts`](./generate-satellites.ts) で、`public/*.toml` を読み、アプリ本体が参照する [`src/lib/satellites.generated.ts`](../src/lib/satellites.generated.ts) を生成します。
- 可視性系のスクリプトは [`src/lib/visibility.ts`](../src/lib/visibility.ts) の関数を使って CSV や統計値を出します。
- 地上局定義では `minElevationDeg` に加えて、`visibilityMode = "elevation_only" | "off_nadir_only" | "and"` と `maxOffNadirDeg` を使えます。
- [`worker-visibility.ts`](./worker-visibility.ts) は単体で使う想定ではなく、[`compute-visibility-sweep.ts`](./compute-visibility-sweep.ts) から Worker として呼ばれます。
- [`generate-visibility-report-assets.ts`](./generate-visibility-report-assets.ts) は [`analyze-settings-visibility.ts`](./analyze-settings-visibility.ts) などが出した CSV / SVG をもとに、報告書向け PNG 図版と Markdown 原稿を生成する後処理スクリプトです。
- 現状、`compute-visibility.ts` / `compute-visibility-sweep.ts` / `generate-lat-report.ts` / `worker-visibility.ts` は `../src/utils/tomlParse` や `../src/utils/configBundle` を import していますが、リポジトリ内の現行実装は [`src/lib/tomlParsers.ts`](../src/lib/tomlParsers.ts) と [`src/lib/config.ts`](../src/lib/config.ts) にあります。説明上は「何をするスクリプトか」をまとめていますが、実行時には import 修正が必要な可能性があります。

## ファイルごとの要約

### `generate-satellites.ts`

- 目的:
  `public/satellites.toml` と `public/constellation.toml` を読み、アプリが直接 import する `src/lib/satellites.generated.ts` を生成する。
- 主な入力:
  - [`public/satellites.toml`](../public/satellites.toml)
  - [`public/constellation.toml`](../public/constellation.toml)（存在すれば）
  - [`src/lib/tomlParsers.ts`](../src/lib/tomlParsers.ts) の `parseSatellitesToml` / `parseConstellationToml`
- 主な出力:
  - [`src/lib/satellites.generated.ts`](../src/lib/satellites.generated.ts)
  - 標準出力には基本的に何も出さず、重複 satnum が見つかったときだけ警告を出す
- 入出力の中身:
  - 入力は衛星定義 TOML とコンステレーション定義 TOML
  - 出力は `SatelliteSpec[]` を埋め込んだ TypeScript ファイル
- 関連ファイル:
  - [`package.json`](../package.json) の `predev` / `prebuild`
  - [`src/lib/satellites.ts`](../src/lib/satellites.ts)
- 実行例:
  - `bun scripts/generate-satellites.ts`

### `generate-constellation.ts`

- 目的:
  1 シェル分のパラメータから `[[constellation.shells]]` 形式の TOML を生成する。
- 主な入力:
  - CLI 引数:
    `name count planes phasing apogee_altitude eccentricity inclination raan_range [raan_start] [argp] [mean_anomaly_0]`
- 主な出力:
  - [`scripts/constellation.toml`](./constellation.toml)
  - 標準出力に `Wrote scripts/constellation.toml`
- 入出力の中身:
  - 入力は数値中心のシェル定義
  - 出力は `[constellation]` と `[[constellation.shells]]` を含む TOML テキスト
- 関連ファイル:
  - [`worker-visibility.ts`](./worker-visibility.ts) から `generateConstellationToml()` を再利用
  - [`public/constellation.toml`](../public/constellation.toml) と同系統のフォーマット
- 実行例:
  - `bun scripts/generate-constellation.ts ShellA 30 6 0 550 0 53 360`

### `compute-visibility.ts`

- 目的:
  基本衛星群 + コンステレーション + 地上局を読み、最初の地上局について「12 時間平均で何機見えるか」を 1 つの数値として出す。
- 主な入力:
  - 既定:
    - [`public/satellites.toml`](../public/satellites.toml)
    - [`public/constellation.toml`](../public/constellation.toml)
    - [`public/groundstations.toml`](../public/groundstations.toml)
  - 引数 2 個時:
    - 第 1 引数: constellation TOML のパス
    - 第 2 引数: ground stations TOML のパス
- 主な出力:
  - 標準出力に `Average visible satellites for <station>: <avg>`
- 入出力の中身:
  - 入力は衛星 TOML と地上局 TOML
  - 出力は単一の平均可視衛星数
- 関連ファイル:
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts) の `averageVisibility`
  - [`public/groundstations.toml`](../public/groundstations.toml) の先頭地上局だけを使用
- 実行例:
  - `bun scripts/compute-visibility.ts`
  - `bun scripts/compute-visibility.ts ./some-constellation.toml ./some-groundstations.toml`

### `compute-visibility-sweep.ts`

- 目的:
  コンステレーションのシェル参数を総当たりし、各組み合わせごとの可視性統計を出す。
- 主な入力:
  - [`public/groundstations.toml`](../public/groundstations.toml) の先頭地上局
  - スクリプト内にハードコードされた sweep 値:
    - `count`
    - `planes`
    - `phasing`
    - `apogee_altitude`
    - `eccentricity`
    - `inclination`
    - `raan_range`
- 主な出力:
  - 標準出力に各組み合わせごとの 1 行:
    `name: avg=..., median=..., nonZero=...%`
- 入出力の中身:
  - 入力はファイルよりも「スクリプト内のパラメータグリッド」が主体
  - 出力は CSV ではなく、統計値のログ列
- 関連ファイル:
  - [`worker-visibility.ts`](./worker-visibility.ts)
  - [`generate-constellation.ts`](./generate-constellation.ts) の `ShellParams` / `generateConstellationToml`
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts) の `visibilityStats`
- 実行例:
  - `bun scripts/compute-visibility-sweep.ts`
- 備考:
  - 組み合わせ数はかなり多く、実行時間は長くなりやすい

### `worker-visibility.ts`

- 目的:
  `compute-visibility-sweep.ts` から渡された 1 つのシェル設定について、可視性統計だけを計算する Worker 本体。
- 主な入力:
  - `postMessage()` 経由のオブジェクト:
    - `shell`
    - `epoch`
    - `startMs`
    - `durationHours`
    - `stepSec`
    - `station`
- 主な出力:
  - `postMessage()` で `{ name, avg, median, nonZeroRate }`
- 入出力の中身:
  - 入力はシェル設定と観測条件
  - 出力は 1 組の統計値
- 関連ファイル:
  - [`compute-visibility-sweep.ts`](./compute-visibility-sweep.ts) からのみ利用
  - [`generate-constellation.ts`](./generate-constellation.ts)
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts)
- 備考:
  - 直接実行するスクリプトではなく、単体 CLI は持たない

### `generate-lat-report.ts`

- 目的:
  緯度 0 度から 90 度まで 1 度刻みの仮想地上局を作り、24 時間分の可視衛星数 CSV を生成する。
- 主な入力:
  - CLI 第 1 引数: `minElDeg`（最低仰角、未指定なら対話入力）
  - CLI 第 2 引数: `settings.toml` のパス（未指定なら対話入力、空なら既定の public TOML 群）
  - 既定入力:
    - [`public/satellites.toml`](../public/satellites.toml)
    - [`public/constellation.toml`](../public/constellation.toml)
  - 代替入力:
    - [`src/lib/config.ts`](../src/lib/config.ts) の `parseConfigBundle()` が読める設定バンドル形式
- 主な出力:
  - ルート直下の `lat_visibility_report.csv`
- 入出力の中身:
  - 入力は衛星設定と最低仰角
  - 出力 CSV は `Time(sec),Lat0,Lat1,...,Lat90` という列構成
- 関連ファイル:
  - [`plot_lat_visibility.py`](./plot_lat_visibility.py)
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts) の `generateVisibilityReport`
- 実行例:
  - `bun scripts/generate-lat-report.ts 10`

### `analyze-settings-visibility.ts`

- 目的:
  `settings.toml` を 1 つ受け取り、同じフォルダ配下に sweep 解析結果一式を出力する。
- 主な入力:
  - CLI 第 1 引数: `settings.toml` のパス
  - `settings.toml` 内の
    - `# === satellites ===`
    - `# === constellation ===`
    - `# === groundstations ===`
    - `startTime`
- 主な出力:
  - `settings.toml` と同じディレクトリ配下の `visibility-analysis/`
  - その中に CSV / SVG / `summary.md`
- 入出力の中身:
  - sweep 対象:
    - 機数 × 軌道面
    - 高度
    - 傾斜角
    - 最低仰角
    - 最大オフナディア角
  - 出力は各 sweep の CSV とグラフ、総括 Markdown
- 関連ファイル:
  - [`src/lib/config.ts`](../src/lib/config.ts)
  - [`src/lib/tomlParsers.ts`](../src/lib/tomlParsers.ts)
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts)
- 実行例:
  - `bun scripts/analyze-settings-visibility.ts local/settings.toml`

### `generate-visibility-report-assets.ts`

- 目的:
  `local/visibility-analysis*/` 配下の CSV / SVG を読み、報告書用の比較図版 PNG と Markdown 原稿を生成する。
- 主な入力:
  - スクリプト内で固定された各シナリオの CSV:
    - `local/visibility-analysis-single-sat/max_off_nadir.csv`
    - `local/visibility-analysis-8sat-1plane/max_off_nadir.csv`
    - `local/visibility-analysis-8sat-8planes/max_off_nadir.csv`
    - `local/visibility-analysis-8sat-1plane-1000km/max_off_nadir.csv`
    - `local/visibility-analysis/max_off_nadir.csv`
  - 一部ケースでは既存 SVG:
    - `local/visibility-analysis-8sat-1plane/max_off_nadir.svg`
    - `local/visibility-analysis-8sat-1plane-1000km/max_off_nadir.svg`
  - ImageMagick の `magick` コマンド
- 主な出力:
  - `local/report-assets/`
  - その中に比較図版の `.svg` / `.png`
  - `local/visibility_report_final.md`
- 入出力の中身:
  - 入力は `max_off_nadir.csv` に含まれる `maxOffNadirDeg` と `min_el_*_avg_visible_ratio_pct` 列
  - 出力は比較折れ線図、棒グラフ、そして数値差分を埋め込んだ報告書 Markdown
- 関連ファイル:
  - [`analyze-settings-visibility.ts`](./analyze-settings-visibility.ts)
  - [`src/lib/visibility.ts`](../src/lib/visibility.ts)
  - `local/settings_*.toml` から派生した `visibility-analysis*` 出力群
- 実行例:
  - `bun scripts/generate-visibility-report-assets.ts`
- 備考:
  - 入力パスは CLI 引数ではなくスクリプト内で固定されている
  - PNG 変換は `magick -font /System/Library/Fonts/Supplemental/Verdana.ttf ...` を前提としているため、実行環境依存がある

### `plot_lat_visibility.py`

- 目的:
  `generate-lat-report.ts` が出した緯度別 CSV を可視化する。
- 主な入力:
  - CLI 第 1 引数: CSV ファイルパス
  - 未指定時の既定値: `lat_visibility_report.csv`
- 主な出力:
  - Matplotlib のウィンドウ表示
  - 左: 時間と緯度の散布図
  - 右: 緯度ごとの平均可視衛星数
- 入出力の中身:
  - 入力 CSV は `Time(sec)` 列と `Lat*` 列を想定
  - ファイル出力は行わない
- 関連ファイル:
  - [`generate-lat-report.ts`](./generate-lat-report.ts)
- 実行例:
  - `python scripts/plot_lat_visibility.py lat_visibility_report.csv`

## 強く関連する scripts 外ファイル

### `public/plot_visibility.py`

- `scripts/` には置かれていませんが、`generateVisibilityReport()` 系の CSV を可視化するという意味で関連が強い補助スクリプトです。
- 想定入力は `Time(sec)` 列と地上局名列を持つ CSV で、既定ファイル名は `report.csv` です。
- 出力は折れ線グラフ表示と、各地上局について「何機見えた時間が何 % か」の割合表示です。

## 依存関係の見取り図

```text
public/satellites.toml ─┐
public/constellation.toml ─┼─ generate-satellites.ts ─→ src/lib/satellites.generated.ts
                          └─ generate-lat-report.ts / compute-visibility.ts

generate-constellation.ts ─→ worker-visibility.ts ─→ compute-visibility-sweep.ts

generate-lat-report.ts ─→ lat_visibility_report.csv ─→ plot_lat_visibility.py

analyze-settings-visibility.ts ─→ visibility-analysis/*.csv,*.svg,summary.md
generate-visibility-report-assets.ts ─→ local/report-assets/*.svg,*.png
                                     └→ local/visibility_report_final.md

src/lib/visibility.ts ─→ compute-visibility.ts / generate-lat-report.ts / worker-visibility.ts
```
