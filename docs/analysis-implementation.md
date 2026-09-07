# 衛星コンステレーション／通信解析 — 実装まとめ

*(Markdown 上のプレーンテキスト数式・擬似コード、LaTeX 不使用。既存 `docs/` の記法に合わせる)*

このリポジトリが実際に何をどう計算しているかを、**通信コンステレーションの概念設計に必要な項目**の順に並べた索引兼リファレンス。個別テーマの深掘りは既存ドキュメントに委ね、ここは「どのファイルの、どの関数が、どんなモデルで、どんな既定値で動くか」を一望できる層に徹する。

---

## 0. 位置づけと既存ドキュメント対応

| テーマ | 深掘りドキュメント | 本ドキュメントの担当 |
| --- | --- | --- |
| 摂動（J2 / J3 / 大気抗力）の理論式 | `docs/perturbation.md` | 実装との差分、既定値、テストで固定されている範囲（§8） |
| RGT（回帰軌道） | `docs/RGTorbit.md` | API 形と使いどころ（§9） |
| ISL 経路探索 | `docs/isl-routing.md`（理論+実装で自己完結） | 位置づけと他モジュールとの境界（§7） |
| コンステレーション設計方式（6 方式）と TOML | `docs/constellation-patterns.md` | 解析側から見た `shellRanges` 等の意味（§11） |
| ミッション駆動の設計オプティマイザ | `docs/constellation-design.md` | 「解析的カバレッジ」と「サンプリングカバレッジ」の使い分け（§11） |
| CLI（`constelation-cli`）の使い方 | `docs/constelation-cli-SKILLS.md` | 解析エンジンとの関係（§12） |
| 解析タブの機能ロードマップ | `docs/analysis-roadmap.md` | — |
| **座標系・時刻系、プロパゲータ、可視性、リンク幾何、デューティ、日照** | **（本ドキュメント）** | §1〜§6, §10 |

---

## 1. 座標系と時刻系

軌道計算は `satellite.js` v6（SGP4）に一本化されており、フレーム間変換もすべて `satellite.js` のヘルパを経由する。

### 1.1 使用するフレーム

| フレーム | 生成元 | 用途 |
| --- | --- | --- |
| ECI（実体は TEME） | `satellite.propagate(satrec, date).position` / `.velocity`、単位 km, km/s | すべての計算の起点 |
| ECF / ECEF | `satellite.eciToEcf(eci, gmst)` | 地上局との相対幾何、カバレッジ判定 |
| 測地座標（緯度・経度・高度） | `satellite.eciToGeodetic(eci, gmst)` | 直下点、地上軌跡 |
| Look angles（方位・仰角・スラントレンジ） | `satellite.ecfToLookAngles(observer, satEcf)` | 可視性判定、リンク幾何 |
| LVLH | `src/lib/orbitalCoordinates.ts` | センサ指向（オフナディア円錐） |
| 描画（Three.js）座標 | `src/lib/visualization.ts` | 可視化専用 |

`gmst = satellite.gstime(date)` を各時刻で 1 回だけ求め、その時刻の全衛星に使い回す（`visibility.ts`, `isl/propagate.ts`, `constellationDesign/verify.ts` はいずれもこの規律に従う）。

### 1.2 LVLH フレーム（`src/lib/orbitalCoordinates.ts`）

```
radial     = r_hat                     # 地心 → 衛星
alongTrack = W x R                     # 速度方向（数値安定化のため再直交化）
crossTrack = W = R x V                 # 軌道角運動量方向（進行方向を見て「左」）
nadir      = -radial
```

センサ指向は nadir から 2 段回転で作る（`computeSensorDirection`）:

1. アロングトラック傾斜（ピッチ）: `crossTrack` 軸まわりに `-alongTrackAngleRad`
2. クロストラック傾斜（ロール）: `alongTrack` 軸まわりに `+crossTrackAngleRad`

符号規約は「正のアロングトラック角 = 前方（速度方向）へ傾斜」「正のクロストラック角 = 左（角運動量方向）へ傾斜」。

FOV 円錐の描画長は `computeTiltedConeHeight` が決める。円錐の遠端（`+halfAngle`）から近端（`-halfAngle`）へ **5°刻み**（`EDGE_SCAN_STEP_DEG`）でレイ・球交差を走査し、最初に地球と交わった位置で高さを決める。地平線を越えて傾けたときに円錐長が不連続に飛ぶのを避けるための実装。

### 1.3 描画座標系（可視化専用、解析には使わない）

```
X_scene = X_eci / R_equator
Y_scene = Z_eci / R_polar        # 北極方向（極半径で割る = 非等方スケール）
Z_scene = -Y_eci / R_equator
```

`R_equator = 6378.137 km`、`R_polar = 6356.7523142 km`。Y を極半径で正規化することで、単位球のジオメトリのまま扁平楕円体として見える。**解析コードはこの座標系に依存しない**（`src/lib/isl/*`, `constellationDesign/*` は Three.js に依存しないことをファイル冒頭で明言している）。

### 1.4 太陽方向（`src/lib/astronomy.ts`）

低精度級数（Astronomical Almanac 系）で黄経を求め、黄道傾斜角で回して ECI 単位ベクトルにする。

```
T      = (JD - 2451545.0) / 36525
L0     = 280.460 + 36000.770*T + 0.0003032*T^2      [deg]
g      = 357.528 + 35999.050*T - 0.0001537*T^2      [deg]
C      = (1.914602 - 0.004817*T - 0.000014*T^2)*sin(g)
       + (0.019993 - 0.000101*T)*sin(2g)
       + 0.000289*sin(3g)                            [deg]
lambda = L0 + C
eps    = 23.4393deg - 0.0130042*T                    [deg]
sun_eci = ( cos(lambda), cos(eps)*sin(lambda), sin(eps)*sin(lambda) )   # 単位ベクトル
```

**距離は持たない（単位ベクトル）**。太陽視差や光行差は無視。日照判定（§10）にはこれで十分だが、太陽輻射圧や高精度な半影計算には使えない。

---

## 2. プロパゲータ

### 2.1 SGP4 のみ

数値積分器は存在しない。すべての伝播は `satellite.js` の SGP4/SDP4 で行う。摂動（§8）は**別建ての解析的レートモデル**であり、伝播そのものには寄与しない。

### 2.2 衛星定義の 2 形態（`src/lib/satellites.ts`）

```ts
type SatelliteSpec =
  | { type: "tle";      lines: [string, string]; meta?: SatelliteMetadata }
  | { type: "elements"; elements: OrbitalElements; meta?: SatelliteMetadata }
```

`toSatrec(spec)` が両者を `satrec` に落とす。`elements` の場合は **一度 TLE 文字列を組み立ててから `twoline2satrec` に通す**（`elementsToTle`）。

```
n_rad      = sqrt(mu / a^3),  mu = 398600.4418 km^3/s^2
meanMotion = n_rad * 86400 / (2*pi)     [rev/day]  -> TLE 2行目に 8 桁で書き込む
```

TLE 経由であることに伴う制約:

| 項目 | 実装値 | 影響 |
| --- | --- | --- |
| 角度（i, RAAN, ω, M） | 小数 4 桁 | 量子化 ~1e-4 deg |
| 離心率 | 7 桁 | 量子化 1e-7 |
| 平均運動 | 8 桁 | — |
| `satnum` | 5 桁ゼロ埋め | 6 桁以上のカタログ番号は表現不可 |
| B\*（`bstar`）| **0 固定** | SGP4 の伝播中に大気抗力が入らない |
| ndot / nddot | **0 固定** | 同上 |

**重要な帰結**: 入力の `semiMajorAxisKm` は Kepler 平均運動として TLE に書かれるが、SGP4 は 2 行目の平均運動を **Kozai 型平均運動**として解釈し、内部で Brouwer 型へ変換する。そのため SGP4 内部の半長軸は入力値と一致しない。実測（a = 6928.137 km, e = 0, i = 97.6°）:

```
入力 a            = 6928.137 km
satrec.a * 6378.135 = 6925.128 km      # 差 -3.0 km
エポックでの |r|    = 6931.211 km
```

数 km の差は可視化・アクセス統計には無視できるが、**高度をパラメータとして掃引する解析で「入力高度」と「実効高度」を突き合わせるときは要注意**。

### 2.3 導出情報（`src/lib/satelliteDerivedInfo.ts`）

`getSatelliteDerivedInfo(spec, at)` が UI 用の一括値を返す。

| 出力 | 算出 |
| --- | --- |
| `periodMinutes` | `2*pi / satrec.no` |
| `perigee/apogeeAltitudeKm` | `satrec.a * 6378.137 * (1 ± e) - 6378.137` |
| `currentAltitudeKm`, `latitudeDeg`, `longitudeDeg` | `eciToGeodetic` |
| `eciSpeedKmPerSec` | 伝播速度ベクトルのノルム |
| `eclipseMinutes`, `eclipseRatio`, 次の食入り／日照復帰までの時間 | §10.1 の影判定を 10 s 刻みで走査、遷移は 18 回二分法で精密化。探索窓は周期の 2.5 倍 |

（`satrec.a` は SGP4 内部で WGS-72 の 6378.135 km を単位とするが、ここでは 6378.137 km を掛けている。差は 2 m 相当で実用上無視できる。）

---

## 3. 地上局可視性（`src/lib/visibility.ts`）

### 3.1 判定基準

```ts
interface VisibilityCriteria {
  minElevationDeg?: number;   // 既定 0
  visibilityMode?: VisibilityMode;  // 既定 "elevation_only"
  maxOffNadirDeg?: number;    // 既定 +Infinity
}
type VisibilityMode = "elevation_only" | "off_nadir_only" | "and";
```

`normalizeVisibilityCriteria` が上記の既定値を埋め、`passesVisibilityCriteria(elevationRad, offNadirRad, criteria)` が判定する。

```
elevationPass = elevation >= minElevation
offNadirPass  = (offNadir != null) && (offNadir <= maxOffNadir)

elevation_only -> elevationPass
off_nadir_only -> offNadirPass
and            -> elevationPass && offNadirPass
```

オフナディア角は ECF で

```
nadir     = -r_sat
toStation = r_station - r_sat
offNadir  = acos( clamp( nadir_hat . toStation_hat, -1, 1 ) )
```

**「OR」モードは存在しない**（`default` は `elevation_only` にフォールバック）。

### 3.2 時系列と統計

| 関数 | 既定 | 出力 |
| --- | --- | --- |
| `countVisibleSatellites(satRecs, station, date)` | — | その瞬間の可視機数 |
| `visibilityStats(sats, station, start, durationHours=12, stepSec=10)` | 12 h / 10 s | `avg`, `median`, `nonZeroRate`, `visibleStepCount`, `visibleSeconds`, `visibleHours` |
| `averageVisibility(...)` | 同上 | `avg` のみ（`visibilityStats` の薄いラッパ） |
| `calculateStationAccessData(sats, stations, start, durationHours=24, stepSeconds=10)` | 24 h / 10 s | 時刻 × 局の可視機数サンプル列 |
| `averageVisibilityData(data, averagePoints=6)` | 6 点 = 1 分 | 表示用に平均（小数を保持） |
| `calculateStationStats(data)` | — | 局ごとの `averageVisible`, `nonZeroRate` |
| `generateVisibilityReport(...)` | 24 h / 10 s | CSV 文字列 |

`visibleSeconds = visibleStepCount * stepSec`、つまり**サンプル数 × ステップ幅による矩形近似**。`visibility.ts` には AOS/LOS の二分法精密化がない（それを持つのは §6 の `linkDutyAnalysis.ts` だけ）。したがって 10 s より短いパスは取りこぼし得るし、パス長は最大 ±1 ステップの誤差を持つ。

### 3.3 可用性メトリクス（`calculateAvailabilityMetrics`）

`(visibilityData, stationIndices, intervalSeconds = 10)` から局ごとに 4 指標を出す。

```
timeAvailability      = (可視機数 > 0 のサンプル数 / 全サンプル数) * 100      [%]
interruptionFrequency = 可視機数が 0 に落ちた回数                            [回]
maxInterruptionTime   = 最長の連続 0 区間                                    [分]
avgInterruptionTime   = 0 区間の平均長                                       [分]
```

実装上の注意（いずれもコードの通り）:

- 可用性は「**1 機以上見えているか**」の 2 値のみ。N 重可視（fold ≥ 2）の可用性はここでは扱わない（`constellationDesign/coverageKernel.ts` が別途 fold を扱う → §11）。
- **t = 0 の時点で既に不可視だった場合、その中断は回数に数えない**（`if (i > 0)` のガード）。ただし区間が終わった時点で長さは記録されるので、`maxInterruptionTime` / `avgInterruptionTime` には含まれる。
- `interruptionFrequency` の単位は「解析窓あたりの回数」。UI（`GlobalAccessAnalysis.tsx`）は 24 h 窓で呼ぶので結果的に「回/日」になるが、窓長を変えれば単位も変わる。

---

## 4. 全球アクセス／可用性（`src/components/analysis/GlobalAccessAnalysis.tsx`）

「全球」といっても実装は **1 本の経線上の緯度スイープ**である。

```
観測経度 observationLongitude   （UI 入力、既定 0 deg）
最低仰角 minElevationAngle      （UI 入力、既定 30 deg）

lat = -90, -89, ..., +90        -> 181 個の仮想地上局
  name = `Lat{lat}°`, longitudeDeg = observationLongitude, heightKm = 0

calculateStationAccessData(全衛星, 181局, startTime, 24 h, 10 s)
  -> 表示は averageVisibilityData(data, 6)  # 1 分平均
  -> 統計は元データ（10 s）から calculateStationStats
  -> 可用性は元データから calculateAvailabilityMetrics(..., 10)
```

24 h 窓なので地球は 1 回転し、経度方向は時間軸に畳み込まれる。「全球」の妥当性はこの前提に依存する（回帰軌道や 1 日で経度が閉じない構成では、単一経線のサンプリングは偏る）。

局側の解析（`StationAccessAnalysis.tsx`）は同じ `visibility.ts` を使い、Worker（`src/workers/stationAccessWorker.ts`）に逃がして実行する。

---

## 5. リンク幾何（`src/lib/linkGeometry.ts`）

通信解析の中核。`calculateLinkGeometry(satrec, terminal, date)` が 1 時刻・1 リンクの幾何を全部返す。

### 5.1 端末定義

```ts
interface GroundTerminal extends GroundStation {
  id: string;
  kind: "service" | "feeder";
  uplinkFrequencyHz?: number;
  downlinkFrequencyHz?: number;
}
```

`kind` はデューティ集計（§6）でサービスリンクとフィーダリンクを区別するために使う。

### 5.2 計算内容

```
gmst      = gstime(date)
r_sat_ecf = eciToEcf(position, gmst)
v_rot     = eciToEcf(velocity, gmst)                    # 回転のみ（コリオリ未補正）
v_sat_ecf = ( v_rot.x + w*r_y ,  v_rot.y - w*r_x ,  v_rot.z )
            # = v_rot - w x r  （w = (0,0,w_earth)）→ 地球固定系での相対速度

r_station = geodeticToEcf(observer)                     # WGS-84 楕円体
rho       = r_sat_ecf - r_station
slantRangeKm    = |rho|
rangeRate       = (rho . v_sat_ecf) / |rho|             # 正 = 遠ざかる
look            = ecfToLookAngles(observer, r_sat_ecf)  # 方位・仰角
offNadir        = §3.1 と同一式
oneWayDelayMs   = slantRangeKm / c * 1000
roundTripDelayMs= oneWayDelayMs * 2
doppler         = -f * rangeRate / c                    # 遠ざかる → 負
receivedFreq    = f + doppler
visible         = passesVisibilityCriteria(...)         # §3.1 を再利用
```

定数: `c = 299792.458 km/s`、`w_earth = 7.29211514670698e-5 rad/s`。

規約は結果 JSON にも明記される（§6.4）:
- `propagationDelayModel: "geometric-vacuum"`
- `dopplerConvention: "positive-range-rate-is-receding"`

**遅延は幾何距離 ÷ 光速のみ**。電離層・対流圏遅延、屈折による仰角補正、機器遅延は一切含まない。

---

## 6. リンクデューティ解析（`src/lib/linkDutyAnalysis.ts`）

「衛星 × 端末」の総当たりで接触窓を求め、サービス／フィーダ／エンドツーエンドのデューティ比に集約する。CLI（`src/cli/main.ts`）の唯一の計算エンジンでもある。

### 6.1 入力

```ts
interface LinkDutyAnalysisInput {
  startTime: Date;
  durationHours: number;
  stepSeconds: number;
  eventToleranceSeconds: number;   // AOS/LOS の要求精度
  satellites: AnalysisSatellite[];
  terminals: GroundTerminal[];
  includeSamples?: boolean;        // 既定 true
}
```

### 6.2 AOS/LOS の求め方（`analyzePair`）

粗いグリッド走査 → 符号反転区間を二分法で詰める、という 2 段構成。**`visibility.ts` にはないこの精密化があるので、接触時間の精度はステップ幅に依存しない。**

```
for t = start .. end step stepSeconds:
    grid[t] = calculateLinkGeometry(...)      # visible フラグ付き
（末尾が end に一致しなければ end も追加評価）

for 隣接ペア (prev, cur):
    if prev.visible != cur.visible:
        t* = refineTransition(prev.t, cur.t, toleranceMs, cur.visible)   # 二分法
        visible へ遷移 -> 区間開始 / 不可視へ遷移 -> 区間終了
（窓の途中で解析期間が終わる場合は end で打ち切り）
```

`refineTransition` は `right - left > toleranceMs` の間だけ二分するので、反復数は `log2(stepSeconds / eventToleranceSeconds)` 程度。

窓ごとの統計値（`maxElevationDeg`, `min/maxSlantRangeKm`, `min/maxOneWayPropagationDelayMs`, `maxAbsUplink/DownlinkDopplerHz`）は**グリッド上のサンプルだけ**から取る（二分法で得た端点は評価しない）。したがって最大仰角などは真のピークをわずかに下振れし得る。グリッド点を 1 つも含まない極短窓の場合だけ、窓中央を追加評価してフォールバックする。

### 6.3 区間代数と集約（`buildDutySummary`）

```
service       = union( kind=="service" の全区間 )
feeder        = union( kind=="feeder"  の全区間 )
communication = union( service, feeder )        # どちらかが繋がっている
endToEnd      = intersect( service, feeder )    # 同時に両方繋がっている
```

`unionIntervals` はソート＋マージ、`intersectIntervals` は 2 ポインタ走査。`maxSimultaneousLinks` は全区間の端点をスイープして同時本数の最大を取る。

| 出力 | 意味 |
| --- | --- |
| `serviceRatio` / `feederRatio` | 各系統の稼働率 |
| `endToEndRatio` | ユーザ端末〜ゲートウェイが同時成立している時間比（衛星単体、ベントパイプ前提） |
| `communicationRatio` | どちらか一方でも成立している時間比 |
| `communicationCycleCount` | オン区間の本数 |
| `max/averageCommunicationOn/OffSeconds` | オン・オフ区間の長さ統計 |
| `maxSimultaneousLinks` | 同時リンク本数の最大 |

コンステレーション全体の `endToEndDutyRatio` は、**各衛星の end-to-end 区間の和集合**の長さ ÷ 解析期間。つまり「どれか 1 機でエンドツーエンドが成立している時間」であり、容量やハンドオーバの成否は評価していない。

### 6.4 出力スキーマ

`LinkDutyAnalysisResult`（`schemaVersion: 1`、`generator: { name: "constelation-cli", version: "0.1.0" }`）。`analysis` ブロックにモデル規約が入る（§5.2）。`satellites[].{duty, links, contactWindows}` と、時刻ごとの `samples`（`includeSamples: false` / CLI の `--summary-only` で省略可）、`warnings`。

CLI からの使い方は `docs/constelation-cli-SKILLS.md` を参照。

---

## 7. 衛星間リンク（ISL）経路探索

`src/lib/isl/*` + `src/workers/islRoutingWorker.ts`。**理論・実装・既定値・テストは `docs/isl-routing.md` に自己完結してまとめられている**ので、ここでは他モジュールとの境界だけ示す。

| モジュール | 役割 |
| --- | --- |
| `isl/geometry.ts` | エッジ存在条件（距離、視線・地球かすめ余裕 `losMarginKm`、GSL の仰角）、`remainingLinkTime` |
| `isl/candidates.ts` | 候補リンク生成 3 方式: `naiveIslCandidates`（全ペア）/ `uniformGridIslCandidates`（一様グリッド、naive と完全一致がテストで固定）/ `gridPatternIslCandidates`（+Grid: 面内前後 2 + 隣接面 2）、`naiveGslCandidates` |
| `isl/cost.ts` | 等価遅延コスト `propagationDelayMs + hopPenaltyMs + kindPenaltyMs + stabilityMs` |
| `isl/stability.ts` | `stabilityPenaltyMs = w_tau * max(0, 1 - remaining/tau_min)`、`tau_min = 60 s` |
| `isl/graph.ts` | スナップショットグラフ構築 |
| `isl/shortestPath.ts` | バイナリヒープ Dijkstra ＋ ヒステリシス割引（前回経路のエッジを `switchDiscount` だけ安くする） |
| `isl/propagate.ts` | 1 時刻の全機伝播。伝播失敗は `valid[i] = false` にする（`{0,0,0}` で代用しない） |
| `isl/participants.ts` | `excludedShellKeys` / `includeBaseSatellites` から参加衛星インデックスを解決 |

`linkGeometry.ts` / `linkDutyAnalysis.ts`（地上リンク）と `isl/*`（衛星間）は**独立**である。ISL のコストは光速遅延＋ホップペナルティで、地上側の `oneWayPropagationDelayMs` とは合算されない。つまり「地上局 → 衛星 → ISL 数ホップ → 衛星 → 地上局」の総遅延を 1 本の指標として出す機能は現状ない（ISL 側は端点 A/B に地上点を置いて GSL を含めた総遅延を出せるが、それは §6 のデューティ集計とは別系統）。

`IslShellRange` の `planeSizes` / `wrapPlanes` の意味論は `docs/constellation-patterns.md` §9 を参照。

---

## 8. 摂動と軌道維持

### 8.1 摂動レート（`src/lib/perturbation.ts`）

理論式は `docs/perturbation.md`。`calculateDetailedPerturbationRates(elements, ballisticCoefficient = 0.012, atmosphereModel?)` が J2 / J3 / 抗力 / 合計に分解して返す。**周回平均した永年項のみ**、短周期項なし。

定数: `mu = 3.986004418e14 m^3/s^2`, `Re = 6378137 m`, `J2 = 1.08263e-3`, `J3 = -2.532e-6`。

出力単位（`PerturbationRates`）は項目ごとに異なるので注意:

| フィールド | 単位 |
| --- | --- |
| `da_dt` | km/year |
| `de_dt` | 1/year |
| `di_dt`, `dOmega_dt`, `domega_dt` | deg/year |
| `dM_dt` | **deg/day** |

大気モデルは 2 種（`AtmosphereModelInput.model`）:

- `"exponential"`: `rho = rho0 * mult * exp(-(h - h0)/H)`、既定 `h0 = 400 km`, `H = 60 km`, `rho0 = 1e-12 kg/m^3`
- `"harris-priester"`: 150〜1500 km の 16 点テーブルを**対数線形補間**して

```
solarFactor        = max(0.35, 1 + 0.004*(F10.7 - 150))
geomagneticFactor  = 1 + 0.02*sqrt(Ap)
diurnalFactor      = 0.85 + 0.3*diurnalBulgeFactor
rho = table(h) * solarFactor * geomagneticFactor * diurnalFactor * densityMultiplier
```

抗力は **近地点高度が `lowOrbitLimitKm`（既定 1000 km）未満のときだけ**適用され、

```
v_rel = sqrt(mu / a)                  # 円軌道近似。地球大気の共回転を差し引いていない
F     = 0.5 * rho * v_rel * B         # [1/s]。v_rel は 1 次（レート、加速度ではない）
da/dt = -2 * a * F                    # == -rho * B * sqrt(mu * a)（教科書形と恒等）
de/dt = (da/dt) * e / (2*H)           # King-Hele 小 e 極限。H は局所スケールハイト
di/dt = dOmega/dt = domega/dt = 0
```

`H` は `atmosphericScaleHeightKm(h, model)` が返す。指数モデルでは `scaleHeightKm`
そのまま、Harris-Priester ではテーブルの対数勾配 `-(dh)/(d ln rho)` から算出する
（LEO で 30〜120 km 程度）。

**検証状況**:

`src/lib/perturbation.test.ts` が `da/dt` と教科書形 `-rho*B*sqrt(mu*a)` の一致を
両大気モデル × 4 高度で相対誤差 1e-9 以内に固定し、`de/dt` については e = 0 で厳密に 0、
`(da/dt)*e/(2H)` と一致、B に対して線形、`lowOrbitLimitKm` 超で 0、を固定している。
Python 参照実装 `tests/simple_perturbation_calc.py` にも同じ抗力項が入り、
`tests/perturbation_test_data.json` を生成する（テストはこの JSON を直接 import するので
参照実装・フィクスチャ・アサーションが乖離しない）。ISS 級（h = 410 km, B = 0.008,
実測 ~2 km/month）は桁確認としてのみ使う（±1 桁の幅で固定）。

**残る既知の保守性（モデルの限界、バグではない）**:

- `HP_DENSITY_TABLE` は単一の高め曲線で、400〜700 km で**現実的な周回平均密度の約 2〜3 倍**に出る。550 km でテーブル値 6.05e-13 kg/m^3 に対し、NRLMSISE-00 級の F10.7 = 150 平均は 1.5〜2.5e-13 程度。
- `diurnalFactor` の可動域が 0.85〜1.15 しかなく、本来の Harris-Priester が持つ最小密度／最大密度プロファイル間のスイングを表現できていない（`rho = rho_min + (rho_max - rho_min)*cos^n(psi/2)`）。
- 結果として**抗力起因の高度低下・寿命・維持 ΔV は 2〜3 倍の保守側**に出る。ISS 級の桁確認でも Harris-Priester は約 4.1 km/month（実測 ~2）、指数モデル既定は約 0.93 km/month（既定 `rho0 = 1e-12 @ 400 km` が低め）で、実測を両側から挟む。
- 正しい直し方は min/max テーブル対を持って上式で内挿することであり、一律のスケール係数を掛けることではない（`HP_BASE_SCALE` がまさにそれで、次元エラーを隠していた）。

J2 / J3 由来の値（RAAN 歳差、SSO 条件、近地点ドリフト、RGT）は従来どおり信頼できる。

参考として h = 550 km, i = 97.6° での J2 RAAN 歳差は `+360.3 deg/year`（≈ 0.987 deg/day）で、太陽同期条件と一致する。

### 8.2 軌道維持解析（`src/lib/orbitMaintenanceAnalysis.ts`）

`analyzeOrbitMaintenance(input)`。大気モデルは **Harris-Priester に固定**（`normalizeInput` が `atmosphereModel: "harris-priester"` を強制）。抗力レートは §8.1 の修正後の式を使う。

自然減衰は摂動レートの単純オイラー積分:

```
for step in 0 .. totalSteps:               # 刻み timelineStepDays（既定 15 日）
    rates = calculateDetailedPerturbationRates({a, e, ...}, B, atmosphere)
    a += rates.drag.da_dt * (stepDays / 365.25)
    e += clamp(rates.drag.de_dt * (stepDays / 365.25))
    a  = max(a, Re + deorbitAltitudeKm)
    if perigeeAltitude <= deorbitAltitudeKm: break
```

タイムラインに記録される `densityKgPerM3` / `densityReferenceAltitudeKm` は `max(perigeeAltitude, 120 km)` で評価した表示用の値。**積分に使う摂動レートの計算には生の近地点高度が渡される**（Harris-Priester 側がテーブル下端 150 km で自前にクリップする）。

維持 ΔV は「1 年分落ちた高度を Hohmann 2 インパルスで元に戻す」で見積る（`buildAnnualBudget`、年内は 10 日刻みで再積分）:

```
dv = |sqrt(mu/r1)*(sqrt(2*r2/(r1+r2)) - 1)| + |sqrt(mu/r2)*(1 - sqrt(2*r1/(r1+r2)))|
推進剤 = dryMass * (exp(dv / (Isp*g0)) - 1)                    # ツィオルコフスキー
必要量（マージン込み）= 推進剤合計 * (1 + propellantMarginPercent/100)
```

自然寿命は `timelineStepDays = 30` で最大 30 年まで前方積分し、近地点が `deorbitAltitudeKm` を切った時刻を返す（届かなければ `{ years: 30, reached: false }`）。

大気シナリオ 4 プリセット（`ATMOSPHERE_PRESETS`）で F10.7・Ap・日変化係数を振った比較と、1 変数感度掃引（`sweepParameter`、既定は `ballisticCoefficient` を 0.01〜0.05 で 9 点）を同時に返す。

| プリセット | F10.7 | Ap | `diurnalBulgeFactor` |
| --- | --- | --- | --- |
| `quiet` | 70 | 4 | 0.35 |
| `nominal` | 150 | 15 | 0.50 |
| `active` | 220 | 40 | 0.65 |
| `storm` | 280 | 80 | 0.80 |

既定値（`createDefaultMaintenanceInput`）: 高度 550 km、i = 97.6°、ドライ質量 100 kg、B = 0.022 m^2/kg、Isp = 220 s、推進剤 6 kg、マージン 20 %、ミッション 3 年、デオービット高度 250 km。

`designStatus` は `requiredWithMargin > available` → `critical`、`> available * 0.85` → `warning`、他は `nominal`。

---

## 9. 回帰軌道 RGT（`src/lib/rgt.ts`）

理論は `docs/RGTorbit.md`。J2 平均要素ベースで「整数回帰比 (revs, days)」を満たす高度／傾斜角を解く。

| 関数 | 用途 |
| --- | --- |
| `suggestRgtRatioFromAltitudeInclination` | 高度・傾斜角から近い整数比を提案 |
| `solveAltitudeFromInclinationAndRatio` | 傾斜角と比を固定して高度を解く |
| `solveInclinationFromAltitudeAndRatio` | 高度と比を固定して傾斜角を解く |
| `solveRgtFromAltitudeInclination` | 上をまとめた入口 |

RGT は設計方式（Walker 等）と直交する**横断ヘルパ**として位置づけられており、方式そのものではない（`docs/constellation-patterns.md` §8）。UI は `src/components/ui/RgtConstraintSection.tsx`。

---

## 10. 日照・電力

### 10.1 影判定（`isInEarthShadow`, `src/lib/satelliteDerivedInfo.ts`）

**円柱影モデル**。

```
sun = sunVectorECI(date)                     # 単位ベクトル（§1.4）
d   = r_sat . sun
if d >= 0:  return false                     # 太陽側 → 日照
perpSq = |r_sat|^2 - d^2                     # 太陽方向に直交な距離^2
return perpSq <= (6378.137)^2                # 円柱内 → 食
```

含まれないもの: 半影（penumbra）／本影の円錐、地球扁平、大気による屈折・減光、太陽の有限角径。LEO の食時間見積りとしては十分だが、食入り／食出の遷移は瞬時として扱われる。

### 10.2 電力成立性（`src/lib/solarPowerAnalysis.ts`）

`analyzeSolarPower(...)`。SGP4 で伝播しながら食判定 → 発生／消費 → バッテリ SOC を逐次更新する。

```
degradation = max(0, 1 - degradationPerYear * missionYears)
generation  = inSunlight ? BOL * degradation * sunTrackingFactor * powerPathEfficiency : 0
load        = (baseLoad + payloadLoad*payloadDutyCycle + (inSunlight ? sunlightExtra : eclipseExtra))
              * (1 + designMarginPercent/100)
net         = generation - load

net >= 0 : E += net * chargeEfficiency * dt      （容量で上限クリップ）
net <  0 : E += (net / dischargeEfficiency) * dt （0 で下限クリップ）
SOC      = E / capacity * 100
```

代表日 4 点（春分・夏至・秋分・冬至付近、時刻は解析開始時刻の時分秒を流用）で年間の最悪ケースを取り、1 変数感度掃引も返す。

必要太陽電池出力の下限見積り:

```
averageLoad = (baseLoad + payloadLoad*duty) * (1+margin)
            + (sunlightExtra*sunlightRatio + eclipseExtra*(1-sunlightRatio)) * (1+margin)
generationFactor = degradation * sunTrackingFactor * powerPathEfficiency * sunlightRatio
minSolarArrayW   = averageLoad / generationFactor
```

主な既定値（`createDefaultSolarPowerInput`）: 周回刻み 30 s、24 h 刻み 120 s、BOL 250 W、日照追尾係数 0.78、電力経路効率 0.90、劣化 2.5 %/年、ミッション 3 年、ベース負荷 90 W、バッテリ 650 Wh、初期 SOC 95 %、最低 SOC 30 %、充電効率 0.95、放電効率 0.94、設計マージン 20 %。

---

## 11. カバレッジ幾何とコンステレーション設計

ここには **2 系統のカバレッジ計算**があり、目的が違う。混同しないこと。

### 11.1 解析的カバレッジ（`src/lib/constellationPatterns/coverageGeometry.ts`）

球面幾何の閉形式。Streets of Coverage のサイジングと、設計オプティマイザの解析段で使う。参照は Beech, Cornara, Bello Mora, Janin, *"A Study of Three Satellite Constellation Design Algorithms"*, ISSFD 1999, eq. (1)(5)(6)(7)。

```
theta = acos( Re/(Re+h) * cos(eps) ) - eps          # 地心中心角（eq.1）
maxNadirAngle, footprintRadiusKm, slantRangeAtElevationKm
coverageCapFraction(theta)                          # 球冠の面積比
bandAreaFraction(latMin, latMax)                    # 緯度帯の面積比
capAreaLowerBoundCount(...)                         # 面積下限からの最小機数
streetHalfWidthRad(theta, satsPerPlane, fold)       # ストリート半幅
orbitalPeriodSec(h), oneWayLatencyMs, nadirLatencyMs
```

`designStreetsOfCoverage(input)` が方式生成器とオプティマイザで共有される唯一の SoC サイジング実装。`spacingSafetyFactor` の既定は **1**（0.98 にすると Iridium が P = 7 になってしまうため）。

### 11.2 サンプリングカバレッジ（`src/lib/constellationDesign/coverageKernel.ts`）

グリッド × 時刻でのアクセス判定を積算するホットループ。WGS-84（`a = 6378.137 km`, `f = 1/298.257223563`）の仰角述語と球面述語の 2 種を持ち、緯度バンド事前フィルタで衛星ごとに評価対象行を絞る。伝播方式には非依存で、呼び出し側が `sampleAt` コールバックで ECF 位置を埋める。これにより

- 粗スクリーン（`screen.ts`）: 5° グリッド、8 時刻、球面述語、**円 Kepler 運動**
- 数値検証（`verify.ts`）: 2° グリッド（高精度モードは 1°）、32 時刻（同 96）、**SGP4**、ギャップ評価は約 110 点 × 24 h × 60 s 刻み

が**同一の判定実装**を共有する。「スクリーンでは成立、検証では不成立」という不一致が幾何実装の差ではなく忠実度の差からしか生じないようにするための設計。

fold（N 重可用性）、緯度別カバレッジ行、ギャップ統計をここで扱う。§3.3 の「1 機以上」しか見ない可用性とはここが決定的に違う。

詳細は `docs/constellation-design.md`（2 段パイプライン、指標定義、Worker プロトコル、限界）。

### 11.3 解析側から見た設計方式

`src/lib/constellationPatterns/*` が 6 方式（Walker Delta / Walker Star / Streets of Coverage / Flower / Lattice Flower / Necklace Flower）を TOML から `SatelliteSpec[]` に展開する。解析にとって重要なのは副産物の `IslShellRange`:

```ts
{ key, name?, startIndex, count, planes, planeSizes?, wrapPlanes? }
```

- `planeSizes`: 面あたり機数が均等でない場合（不均等 Flower、間引き Necklace）のみ入る
- `wrapPlanes`: 最終面が面 0 と RAAN 隣接でない場合（Walker Star / SoC は 180° を張って逆行シームを持つ）に `false`

ISL の `gridPattern` トポロジと、シェル別リンクモデルの解決はこれを見て行う。生成物 `src/lib/satellites.generated.ts` は `scripts/generate-satellites.ts` が作るので手編集しない。

---

## 12. 実行基盤

| 経路 | エントリ | 中身 |
| --- | --- | --- |
| ブラウザ描画ループ | `src/lib/visualization.ts`, `src/components/useSatelliteScene.ts` | 毎フレーム SGP4。Three.js リソースは `useSatelliteScene` の cleanup で dispose する |
| 局アクセス解析 | `src/workers/stationAccessWorker.ts` | TOML パース + `visibility.ts`。UI は `terminate()` で中断 |
| ISL 経路探索 | `src/workers/islRoutingWorker.ts` | `init` / `configure` / `compute` / `sweep`。`propagateAll` のバッファを init 間で再利用 |
| ミッション設計 | `src/workers/constellationDesignWorker.ts` | `enumerate → screen → verify` を丸ごとオフスレッド。キャンセルメッセージはなく `terminate()` で中断 |
| CLI | `src/cli/main.ts`（`bun run cli` / `bun run build:cli`） | `analyzeLinkDuty` のみ。`--format json|csv`, `--summary-only`, `--duration-hours`, `--step-seconds` |
| データ生成 | `scripts/generate-satellites.ts`（`predev` / `prebuild`） | `public/*.toml` → `src/lib/satellites.generated.ts` |

Worker 越しに渡すものはすべて structured-clone 可能なプレーンデータ（`*.types.ts` に契約を分離）。`constellationDesign` 系と `isl` 系は **Three.js / React / DOM に依存しない**ことを設計制約として守っている（`coverageGeometry.ts` が `SPEED_OF_LIGHT_KM_PER_SEC` をあえて再宣言しているのはこのため）。

---

## 13. 既定値・物理定数一覧

### 13.1 物理定数（ファイルごとに独立宣言されている）

| 定数 | 値 | 宣言箇所 |
| --- | --- | --- |
| GM | 398600.4418 km^3/s^2 | `satellites.ts`, `astronomy.ts`, `satelliteEditorSerializer.ts`, `constellationPatterns/orbit.ts`, `constellationDesign/geometry.ts` |
| GM | 3.986004418e14 m^3/s^2 | `perturbation.ts`, `orbitMaintenanceAnalysis.ts` |
| 赤道半径 | 6378.137 km | `astronomy.ts`, `satelliteDerivedInfo.ts`, `isl/geometry.ts`, `coverageKernel.ts`, `visualization.ts` |
| 極半径 | 6356.7523142 km | `astronomy.ts`, `visualization.ts` |
| 扁平率 | 1/298.257223563 | `coverageKernel.ts` |
| 光速 | 299792.458 km/s | `linkGeometry.ts`, `isl/cost.ts`, `coverageGeometry.ts`（意図的に 3 箇所で再宣言） |
| 地球自転角速度 | 7.29211514670698e-5 rad/s | `linkGeometry.ts`, `constellationDesign/screen.ts` |
| 地球自転角速度 | 7.2921150e-5 rad/s | `astronomy.ts`（GEO 半径の導出用。上とわずかに異なる） |
| J2 / J3 | 1.08263e-3 / -2.532e-6 | `perturbation.ts` |
| 黄道傾斜角 | 23.4393 deg | `astronomy.ts` |
| GEO 半径 | `cbrt(GM / w^2)` ≈ 42164.17 km | `astronomy.ts` |

### 13.2 解析の既定パラメータ

| 項目 | 既定 | 出典 |
| --- | --- | --- |
| 可視性サンプル刻み | 10 s | `visibility.ts` |
| `visibilityStats` 窓 | 12 h | `visibility.ts` |
| 局／全球アクセス窓 | 24 h | `visibility.ts`, `GlobalAccessAnalysis.tsx` |
| 表示平均化 | 6 点 = 1 分 | `averageVisibilityData` |
| 最低仰角（criteria 既定） | 0 deg | `normalizeVisibilityCriteria` |
| 最低仰角（全球アクセス UI 初期値） | 30 deg | `GlobalAccessAnalysis.tsx` |
| 最大オフナディア（既定） | +Infinity | `normalizeVisibilityCriteria` |
| 全球アクセス緯度刻み | 1 deg（181 局） | `GlobalAccessAnalysis.tsx` |
| FOV 円錐の縁走査刻み | 5 deg | `orbitalCoordinates.ts` |
| ISL 最大距離 | 5000 km | `isl/types.ts` `DEFAULT_LINK_MODEL` |
| ISL 視線余裕 | 80 km | 同上 |
| ISL ホップペナルティ | 2 ms | `DEFAULT_COST_SETTINGS` |
| ISL ヒステリシス割引 | 0.2 | 同上 |
| ISL 安定性しきい値 tau\_min | 60 s | `isl/stability.ts` |
| ISL 残存時間の前方探索 | 300 s 上限 / 10 s 刻み | `isl/geometry.ts` |
| ISL 再計算間隔 | 10 シミュレーション秒 | `isl/types.ts` |
| 弾道係数（摂動関数の既定引数） | 0.012 m^2/kg | `perturbation.ts` |
| 弾道係数（軌道維持 UI 初期値） | 0.022 m^2/kg | `orbitMaintenanceAnalysis.ts` |
| 抗力適用の高度上限 | 1000 km | `perturbation.ts` |
| 指数大気の基準 | h0 = 400 km, H = 60 km, rho0 = 1e-12 | `perturbation.ts` |
| F10.7 / Ap（既定） | 150 / 15 | `perturbation.ts` |
| 軌道維持タイムライン刻み | 15 日（年次予算は 10 日、寿命推定は 30 日） | `orbitMaintenanceAnalysis.ts` |
| 電力解析 周回／日刻み | 30 s / 120 s | `solarPowerAnalysis.ts` |
| 設計スクリーン | 5 deg グリッド / 8 時刻 | `constellationDesign/screen.ts` |
| 設計検証 | 2 deg / 32 時刻（高精度 1 deg / 96） | `constellationDesign/verify.ts` |
| 設計ギャップ評価 | 24 h / 60 s 刻み | `constellationDesign/verify.ts` |
| SoC 間隔安全率 | 1 | `constellationDesign/types.ts` |

---

## 14. 通信用途での前提と未実装事項

概念設計でこのツールの出力を使うときに、**明示的に外にある**もの。

### 14.1 リンクバジェットが存在しない

- EIRP、G/T、アンテナパターン、自由空間損失、降雨減衰（ITU-R P.618 等）、大気吸収、偏波損失、実装損失 — いずれも計算しない。
- したがって `dutyRatio` / `endToEndRatio` は **可視性ベースの時間比**であって、スループットでも C/N でもない。「繋がる時間の割合」の上限値として読むこと。
- 変調・符号化、適応制御（ACM）、周波数計画、干渉（ITU 調整、同一周波数の他コンステレーションとの EPFD）も対象外。

### 14.2 伝搬モデルの単純化

- 遅延は幾何距離 ÷ 真空光速のみ（`propagationDelayModel: "geometric-vacuum"`）。電離層・対流圏遅延、機器遅延なし。
- 仰角は幾何仰角。大気屈折補正なし。低仰角では実効仰角が数分角ずれる。
- ドップラーは 1 次（`-f * rangedot / c`）。相対論補正、ドップラーレート（加速度項）は未計算。

### 14.3 ネットワーク／運用モデルの欠落

- ハンドオーバ判定、ビーム割当、セル設計、容量制約、輻輳、キュー遅延 — なし。`maxSimultaneousLinks` は幾何的な同時可視本数の最大にすぎない。
- 地上リンク（§6）と ISL（§7）の遅延は合算されない。マルチホップのエンドツーエンド遅延を 1 指標で出す機能はない。
- ISL 経路探索は最短経路 1 本のみ。冗長経路、帯域、パケットレベルの挙動は扱わない。

### 14.4 可視性・可用性の解像度

- `visibility.ts` は **AOS/LOS の二分法精密化を持たない**。10 s 刻みより短いパスは取りこぼす。精密な接触窓が必要なら `linkDutyAnalysis.ts`（§6.2）を使う。
- 可用性（§3.3）は「1 機以上見えているか」だけ。N 重可用性は `constellationDesign/coverageKernel.ts`（§11.2）側にしかない。
- t = 0 時点で既に不可視だった中断は `interruptionFrequency` に数えられない（長さは max/avg に含まれる）。
- 「全球アクセス」は単一経線 × 24 h のサンプリング（§4）。回帰軌道や 1 日で経度が閉じない構成では偏りが出る。
- 接触窓の `maxElevationDeg` 等はグリッドサンプルからのみ取るので、真のピークをわずかに下振れし得る（§6.2）。

### 14.5 力学モデルの限界

- 伝播は SGP4 のみ。要素入力経路では `bstar = 0` なので**伝播中に抗力が入らない**（§2.2）。長期の高度低下は §8 の別モデルで扱う二重構造になっている。
- 入力 `semiMajorAxisKm` と SGP4 内部半長軸に数 km の差がある（Kozai / Brouwer 変換、§2.2）。
- 摂動レートは J2 / J3 の永年項 + 簡易抗力のみ。高次項、月太陽引力、太陽輻射圧、共鳴、地球放射圧なし。
- 抗力レートは教科書形 `da/dt = -rho*B*sqrt(mu*a)` に一致することがテストで固定されているが、**密度テーブルが高め（周回平均の約 2〜3 倍）**なので、高度低下量・寿命・維持 ΔV は 2〜3 倍の保守側に出る（§8.1）。
- 影判定は円柱影で半影なし（§10.1）。
- 太陽位置は低精度級数、単位ベクトルのみ（距離を持たない、§1.4）。太陽輻射圧や日照強度の季節変動を扱えない。

### 14.6 設計オプティマイザの範囲

- 列挙対象は **Walker Delta と Walker Star（Streets of Coverage）のみ**。Flower 系 3 方式は生成器・フォームとしては実装済みだが最適化には入らない（カーネルの `T = P*S, e = 0` 高速経路が崩れるため）。
- ISL 制約は意図的に対象外（`isl?: never` フック）。
- 対象領域は「全球」または「緯度帯」のみ。任意ポリゴンや重み付き需要地図は非対応。
- 詳細は `docs/constellation-design.md` §9。

### 14.7 既知の運用上の癖

- 既定の解析開始時刻が `public/constellation.toml` のエポックから大きく離れていると、要素定義の衛星が画面外に描かれる（既存の癖として認識されている）。解析結果自体は開始時刻に対して正しいが、要素のエポックと解析窓を合わせておくのが安全。

---

## 15. ファイル → 主要関数 → テスト 対応表

| ファイル | 主な公開関数 | テスト |
| --- | --- | --- |
| `src/lib/satellites.ts` | `toSatrec` | （間接：`orbitalCoordinates.test.ts` 他） |
| `src/lib/astronomy.ts` | `gmstDeg`, `sunVectorECI`, `geoElementsFromLongitude`, `createGraticule` | — |
| `src/lib/orbitalCoordinates.ts` | `computeLVLHFrame`, `computeSensorDirection`, `computeFovConeQuaternion`, `computeTiltedConeHeight` | `tests/orbitalCoordinates.test.ts` |
| `src/lib/satelliteDerivedInfo.ts` | `getSatelliteDerivedInfo`, `isInEarthShadow` | `src/lib/satelliteDerivedInfo.test.ts` |
| `src/lib/visibility.ts` | `passesVisibilityCriteria`, `visibilityStats`, `calculateStationAccessData`, `calculateAvailabilityMetrics`, `generateVisibilityReport` | `tests/visibility-criteria.test.ts`（`tests/test-visibility-interval.ts` は `.test.` 接尾辞がなく `bun test` の対象外＝手動スクリプト） |
| `src/lib/linkGeometry.ts` | `calculateLinkGeometry` | `tests/linkGeometry.test.ts` |
| `src/lib/linkDutyAnalysis.ts` | `analyzeLinkDuty` | `tests/linkDutyAnalysis.test.ts` |
| `src/cli/main.ts`, `scenarioParser.ts` | `parseCliArguments`, `loadScenario` | `tests/cli.test.ts`, `tests/scenarioParser.test.ts` |
| `src/lib/perturbation.ts` | `calculateDetailedPerturbationRates`, `calculateAtmosphericDensity`, `atmosphericScaleHeightKm` | `src/lib/perturbation.test.ts`（J2 / J3 / 抗力）, `tests/perturbation_test_data.json`（`tests/simple_perturbation_calc.py` が生成） |
| `src/lib/orbitMaintenanceAnalysis.ts` | `analyzeOrbitMaintenance`, `createDefaultMaintenanceInput` | `src/lib/orbitMaintenanceAnalysis.test.ts` |
| `src/lib/solarPowerAnalysis.ts` | `analyzeSolarPower`, `createDefaultSolarPowerInput` | `src/lib/solarPowerAnalysis.test.ts` |
| `src/lib/rgt.ts` | `solveRgtFromAltitudeInclination` 他 | — |
| `src/lib/isl/geometry.ts` | `hasLineOfSight`, `elevationRad`, `remainingLinkTime` | `tests/isl-geometry.test.ts` |
| `src/lib/isl/candidates.ts` | `naiveIslCandidates`, `uniformGridIslCandidates`, `gridPatternIslCandidates`, `naiveGslCandidates` | `tests/isl-candidates.test.ts` |
| `src/lib/isl/cost.ts` | `edgeCostMs`, `stabilityPenaltyMs` | `tests/isl-cost.test.ts` |
| `src/lib/isl/graph.ts` | `buildSnapshotGraph` | `tests/isl-graph.test.ts` |
| `src/lib/isl/shortestPath.ts` | `findShortestPath` | `tests/isl-shortestPath.test.ts`, `tests/isl-hysteresis-scenario.test.ts` |
| `src/lib/isl/stability.ts` | `applyStabilityPenalties` | `tests/isl-stability.test.ts` |
| `src/lib/isl/participants.ts` | `resolveIslParticipantIndices` | `tests/isl-participants.test.ts` |
| `src/lib/isl/types.ts` | `reconcileIslEndpoints` | `tests/isl-endpoints.test.ts` |
| `src/lib/constellationPatterns/coverageGeometry.ts` | `earthCentralAngleRad`, `designStreetsOfCoverage`, `footprintRadiusKm` | `tests/coverageGeometry.test.ts` |
| `src/lib/constellationPatterns/*` | 6 方式の生成器 | `tests/constellationPatterns.test.ts`, `constellationPatternsBaseline.test.ts`, `constellationMigrate.test.ts`, `constellationUiMeta.test.ts` |
| `src/lib/constellationDesign/coverageKernel.ts` | `accumulateCoverage`, `accumulateGaps`, `buildRegionGrid` | `tests/constellationDesign-kernel.test.ts` |
| `src/lib/constellationDesign/enumerate.ts` | `runDesign`, `enumerateAnalytic`, `rankCandidates` | `tests/constellationDesign-enumerate.test.ts` |
| `src/lib/constellationDesign/starSizing.ts` | `enumerateStarCandidates` | `tests/constellationDesign-starSizing.test.ts` |
| `src/lib/config.ts`, `tomlParsers.ts` | `parseConfigBundle`, `buildConfigBundle` | `tests/constellationParser.test.ts`, `constellationSerializer.test.ts` |

検証コマンド: `bun run test`（Bun ネイティブテストランナー）、`bun run lint`、`bun run build`。ISL は `scripts/verify-isl-routing.ts` / `scripts/bench-isl.ts` に数値検証・ベンチもある。

---

## 16. 関連ドキュメント

- `docs/perturbation.md` — J2 / J3 / 抗力の理論式と擬似コード
- `docs/RGTorbit.md` — 回帰軌道の条件式と設計フロー
- `docs/isl-routing.md` — ISL 経路探索の理論・実装・既定値・性能
- `docs/constellation-patterns.md` — 6 設計方式と TOML スキーマ
- `docs/constellation-design.md` — ミッション駆動オプティマイザ（2 段パイプライン）
- `docs/constelation-cli-SKILLS.md` — CLI エージェント向けガイド（`dist/SKILLS.md` の元）
- `docs/analysis-roadmap.md` — 解析タブの機能ロードマップ
- `AGENTS.md` / `CLAUDE.md` — プロジェクト運用ルール
