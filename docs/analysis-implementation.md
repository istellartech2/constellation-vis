# 衛星コンステレーション／通信解析 — 実装まとめ

衛星位置の計算は `satellite.js` の **SGP4/SDP4** を使う。その位置からアクセス・通信経路・日照を評価する。軌道を決める設計計算と、長期の高度低下を見積もる寿命計算はそれぞれ別の役割を持つ。

初めて読む場合は、[計算の概要](how-it-works.md)から始めてほしい。本ドキュメントは、各機能の式・単位・既定値・実装箇所を調べるための詳細リファレンスである。

---

## 0. 位置づけと既存ドキュメント対応

| テーマ | 深掘りドキュメント | 本ドキュメントの担当 |
| --- | --- | --- |
| 摂動（J2 / J3 / 大気抗力）の理論式 | [perturbation.md](perturbation.md) | 実装との差分、既定値、テストで固定されている範囲（§8） |
| RGT（回帰軌道） | [RGTorbit.md](RGTorbit.md) | API 形と使いどころ（§9） |
| ISL 経路探索 | [isl-routing.md](isl-routing.md)（理論+実装で自己完結） | 位置づけと他モジュールとの境界（§7） |
| コンステレーション設計方式（6 方式）と TOML | [constellation-patterns.md](constellation-patterns.md) | 解析側から見た `shellRanges` 等の意味（§11） |
| ミッション駆動の設計オプティマイザ | [constellation-design.md](constellation-design.md) | 「解析的カバレッジ」と「サンプリングカバレッジ」の使い分け（§11） |
| CLI（`constelation-cli`）の使い方 | [constelation-cli-SKILLS.md](constelation-cli-SKILLS.md) | 解析エンジンとの関係（§12） |
| **座標系・時刻系、プロパゲータ、可視性、リンク幾何、デューティ、日照** | **（本ドキュメント）** | §1〜§6, §10 |

---

<a id="coordinates"></a>

## 1. 座標系と時刻系

実際の衛星の伝播は `satellite.js` v6（SGP4/SDP4）。ただし設計の粗スクリーニングは円 Kepler 運動（§11.2）、長期減衰は別のレート積分（§8.2）である。座標変換は `satellite.js` のヘルパを基本とし、設計検証では同じ ECI→ECF 回転をバッファへ直接計算する。

ここで ECI と呼ぶ SGP4 出力は TEME であり、J2000/GCRF ではない。GMST のみで回す ECF は極運動を含む厳密な ITRF 変換ではない。時刻は JavaScript `Date` の UTC を使い、UT1−UTC や TT/TDB への変換、地球姿勢パラメータ（EOP）は扱わない。[Vallado et al., Revisiting Spacetrack Report #3](https://celestrak.org/publications/AIAA/2006-6753/AIAA-2006-6753.pdf) が TEME と地球固定系変換の理論上の参照先。

### 1.1 使用するフレーム

| フレーム | 生成元 | 用途 |
| --- | --- | --- |
| ECI（実体は TEME） | `satellite.propagate(satrec, date).position` / `.velocity`、単位 km, km/s | 描画・アクセス・詳細検証の起点 |
| ECF / ECEF | `satellite.eciToEcf(eci, gmst)` | 地上局との相対幾何、カバレッジ判定 |
| 測地座標（緯度・経度・高度） | `satellite.eciToGeodetic(eci, gmst)` | 直下点、地上軌跡 |
| Look angles（方位・仰角・スラントレンジ） | `satellite.ecfToLookAngles(observer, satEcf)` | 可視性判定、リンク幾何 |
| LVLH | `src/lib/orbitalCoordinates.ts` | センサ指向（オフナディア円錐） |
| 描画（Three.js）座標 | `src/lib/visualization.ts` | 可視化専用 |

`gmst = satellite.gstime(date)` を各時刻で 1 回だけ求め、その時刻の全衛星に使い回す（`visibility.ts`, `isl/propagate.ts`, `constellationDesign/verify.ts` はいずれもこの規律に従う）。

### 1.2 LVLH フレーム（`src/lib/orbitalCoordinates.ts`）

```
R          = normalize(r)              # 地心位置 r の単位ベクトル
V          = v                         # 慣性系の速度
radial     = R                         # 地心 → 衛星
alongTrack = normalize(W x R)          # 速度の接線成分方向（楕円軌道では速度全体とは異なる）
crossTrack = W = normalize(R x V)      # 軌道角運動量方向（進行方向を見て「左」）
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

`R_equator = 6378.137 km`、`R_polar = 6356.7523142 km`。衛星位置は上の非等方スケールで変換し、地球の描画グループは別途 `scale(1, R_polar/R_equator, 1)` で扁平化する。**解析コードはこの座標系に依存しない**（`src/lib/isl/*`, `constellationDesign/*` は Three.js に依存しないことをファイル冒頭で明言している）。

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

**距離は持たない（単位ベクトル）**。太陽視差や光行差は無視。§10 の簡易日照判定に使う。太陽輻射圧や高精度な半影計算は対象外。

---

<a id="propagation"></a>

## 2. プロパゲータ

### 2.1 位置伝播と別モデルの区別

衛星位置の高忠実度数値積分器は存在しない。描画・アクセス・リンク・設計の詳細検証は `satellite.js` の SGP4/SDP4 で行う。設計の粗スクリーニングには円 Kepler 運動、自然減衰にはレートのオイラー積分を使う。摂動（§8）は**別建ての解析的レートモデル**であり、伝播そのものには寄与しない。

### 2.2 衛星定義の 2 形態（`src/lib/satellites.ts`）

```ts
type SatelliteSpec =
  | { type: "tle";      lines: [string, string]; meta?: SatelliteMetadata }
  | { type: "elements"; elements: OrbitalElements; meta?: SatelliteMetadata }
```

`toSatrec(spec)` が両者を `satrec` に落とす。`elements` の場合、衛星番号が 5 桁以内なら **一度 TLE 文字列を組み立ててから `twoline2satrec` に通す**（`elementsToTle`）。6〜9 桁の衛星番号は固定列の TLE に収まらないため、UTC エポックと軌道要素を OMM JSON として `json2satrec` に直接渡す。どちらの経路でも平均運動は次式で求め、BSTAR と平均運動の時間微分は 0 とする。

```
n_rad      = sqrt(mu / a^3),  mu = 398600.4418 km^3/s^2
meanMotion = n_rad * 86400 / (2*pi)     [rev/day]  -> TLE 2行目に 8 桁で書き込む
```

以下は軌道要素から合成する TLE の仕様。外部から読み込んだ TLE の B* は元データを使い、0 へ書き換えない。6 桁以上の衛星番号を使う OMM 経路には、TLE 固定列の丸め制約はない。

| 項目 | 実装値 | 影響 |
| --- | --- | --- |
| 角度（i, RAAN, ω, M） | 小数 4 桁 | 量子化 ~1e-4 deg |
| 離心率 | 7 桁 | 量子化 1e-7 |
| 平均運動 | 8 桁 | — |
| `satnum` | 5 桁ゼロ埋め | 6 桁以上のカタログ番号は表現不可 |
| B\*（`bstar`）| **0 固定** | SGP4 の伝播中に大気抗力が入らない |
| ndot / nddot | **0 固定** | SGP4 はこれらの TLE フィールドを伝播に使わない。抗力の有無は B* とモデルに依存 |

**重要な帰結**: 入力の `semiMajorAxisKm` は Kepler 平均運動として TLE に書かれるが、SGP4 はこの平均運動を **Kozai 型平均運動**として解釈し、内部で Brouwer 型へ変換する。そのため SGP4 内部の半長軸は入力値と一致しない。計算例（a = 6928.137 km, e = 0, i = 97.6°）:

```
入力 a            = 6928.137 km
satrec.a * 6378.135 = 6925.128 km      # 差 -3.0 km
```

数 km の差は被覆境界や接触時刻にも影響し得る。**高度をパラメータとして掃引する解析で「入力高度」と「実効高度」を突き合わせるときは要注意**。

### 2.3 導出情報（`src/lib/satelliteDerivedInfo.ts`）

`getSatelliteDerivedInfo(spec, at)` が UI 用の一括値を返す。

| 出力 | 算出 |
| --- | --- |
| `periodMinutes` | `2*pi / satrec.no` |
| `perigee/apogeeAltitudeKm` | `satrec.a * 6378.137 * (1 ± e) - 6378.137` |
| `currentAltitudeKm` | `\|r_TEME\| - 6378.137`（赤道球基準の高度。測地高度ではない） |
| `latitudeDeg`, `longitudeDeg` | `eciToGeodetic`（測地緯度・東経正） |
| `eciSpeedKmPerSec` | 伝播速度ベクトルのノルム |
| `eclipseMinutes`, `eclipseRatio`, 次の食入り／日照復帰までの時間 | §10.1 の影判定を 10 s 刻みで走査、遷移は 18 回二分法で精密化。探索窓は周期の 2.5 倍 |

（`satrec.a` は SGP4 内部で WGS-72 の 6378.135 km を単位とするが、ここでは 6378.137 km を掛けている。半長軸の差は `satrec.a * 0.002 km` で、LEO では約 2 m。）

### 大規模表示（J2 永年解析解, `src/lib/j2Propagator.ts`, `src/lib/massSatelliteLayer.ts`）

3D 表示の衛星総数（エディタ衛星＋大規模カタログ）が `MASS_MODE_THRESHOLD`（20,000 機）を超えると、全衛星を GPU の頂点シェーダで伝播する。

- モデル: SGP4 `sgp4init` と同一の un-Kozai 平均運動と永年率（`mdot`/`argpdot`/`nodedot`、J2・J2²・J4 項）を平均要素に適用し、ケプラー方程式を解く。短周期・長周期項、BSTAR 抗力、深宇宙の日月項は含まない。SGP4 との差は LEO で 1 日あたり数〜15 km 程度（`tests/massCatalog.test.ts`）。
- float32 精度: 角度を基準時刻で再基準化（`j2AnglesAt`）し、シェーダは `率 × (t − 基準)` のみ加算。シミュレーション時刻が基準から 24 h 離れるたびに CPU で再基準化する。
- 可視色: 地上局 32 局まで、測地上方向との内積による仰角判定をシェーダで全機に適用。
- リンク線・FOV コーン: 時間予算付き（1 フレーム 3 ms）の逐次走査で見つけた可視ペア最大 500 組と選択衛星のみ描画。
- 選択・軌道線・地上軌跡・追従カメラ: 描画点と一致させるため CPU 版の同じ J2 モデルを使う（情報カードの軌道要素は SGP4 由来）。
- 解析タブと ISL 経路はエディタ衛星のみが対象で、大規模カタログは含まない。

---

<a id="visibility"></a>

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

**「OR」モードは存在しない**（`default` は `elevation_only` にフォールバック）。`off_nadir_only` は仰角も地球遮蔽も検査しないため、地平線下の局まで条件を満たす場合がある。地平線上かつ視野内を求める場合は `and` と非負の最低仰角を使う。

### 3.1.1 衛星 FOV（局アクセス解析で任意に追加）

`StationAccessAnalysis.tsx` の「衛星の視野」条件は既定 OFF。ON のときだけ、表示設定の半角・along-track/cross-track 傾きを `SatelliteFovCriteria` として渡し、局の条件に AND する。

```
b = computeSensorDirectionEci(r, v, alongTrackDeg, crossTrackDeg)
b_ecf = eciToEcf(b, gmst)
FOV条件 = acos(clamp(b_ecf_hat · (r_station-r_sat)_hat, -1, 1)) <= halfAngle
可視 = 局の可視条件 && FOV条件
```

速度が使えない場合は純 nadir にフォールバックする。円錐の半角は全開口角の半分。全球アクセス UI、CLI の `calculateLinkGeometry`、ISL、ミッション設計はこの表示設定の FOV を渡さないので、同じ衛星でも結果が一致するとは限らない。

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

`visibleSeconds = visibleStepCount * stepSec`、つまり**サンプル数 × ステップ幅による矩形近似**。`visibility.ts` には AOS/LOS の二分法精密化がない（それを持つのは §6 の `linkDutyAnalysis.ts` だけ）。したがって 10 s より短いパスは取りこぼし得る。区間境界の精度はサンプル刻みに制限される。

時系列は `t <= end` で終点も含む。24 h / 10 s は 8641 点であり、全点が可視なら `visibleSeconds` は 86410 s になる。不可視区間の長さもサンプル数 × 刻みなので、窓全体が不可視なら 24 h + 10 s。これらは厳密な区間積分ではなく、終点を含むサンプル集計である。

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

<a id="global-access"></a>

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

24 h は太陽日であり、恒星日（約 86164 s）とは異なる。衛星も同時に運動するため、単一経線の時系列を全経度の同時評価と同一視できない。これは選択した経線の緯度別アクセスであり、全球の面積平均や最悪地点の可用性を保証しない。

局側の解析（`StationAccessAnalysis.tsx`）は同じ `visibility.ts` を使い、Worker（`src/workers/stationAccessWorker.ts`）に逃がして実行する。

---

<a id="link-geometry"></a>

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

<a id="link-duty"></a>

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

粗いグリッド走査 → 符号反転区間を二分法で詰める、という 2 段構成。**検出済みの遷移区間を `eventToleranceSeconds` まで精密化する。ただし両端が不可視の間に完結する短いパスや、同じ状態に戻る複数遷移は見落とす。接触窓の検出と窓内統計は依然としてステップ幅に依存する。**

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

`LinkDutyAnalysisResult`（`schemaVersion: 1`、`generator.name: "constelation-cli"`、`generator.version` は `package.json` のバージョン）。`analysis` ブロックにモデル規約が入る（§5.2）。`satellites[].{duty, links, contactWindows}` と、時刻ごとの `samples`（`includeSamples: false` / CLI の `--summary-only` で省略可）、`warnings`。

CLI からの使い方は [constelation-cli-SKILLS.md](constelation-cli-SKILLS.md) を参照。

---

<a id="isl"></a>

## 7. 衛星間リンク（ISL）経路探索

`src/lib/isl/*` + `src/workers/islRoutingWorker.ts`。**理論・実装・既定値・テストは [isl-routing.md](isl-routing.md) に自己完結してまとめられている**ので、ここでは他モジュールとの境界だけ示す。

`linkGeometry.ts` / `linkDutyAnalysis.ts`（地上リンク）と `isl/*`（経路探索）は**独立**である。ISL は GSL を含めた「地上 A → 衛星 → ISL → 衛星 → 地上 B」の合計を出せるが、§6 の接触窓・デューティとは統合しない。

`IslPathResult.totalDelayMs` は各エッジの**伝搬遅延 + ユーザー指定ペナルティ**の合計（割引前）である。物理的な真空伝搬遅延だけなら `totalDistanceKm / c * 1000`。ヒステリシス割引は経路選択にだけ適用し、報告する `totalDelayMs` には適用しない。

`IslShellRange` の `planeSizes` / `wrapPlanes` の意味論は [constellation-patterns.md](constellation-patterns.md) §9 を参照。

---

<a id="perturbation"></a>

## 8. 摂動と軌道維持

### 8.1 摂動レート（`src/lib/perturbation.ts`）

`calculateDetailedPerturbationRates(elements, ballisticCoefficient = 0.012, atmosphereModel?)` は、J2 / J3 / 抗力 / 合計の簡易レートを返す。短周期成分は扱わず、SGP4 の位置伝播にも加算しない。

式・単位・大気密度モデル・検証範囲は [摂動モデル](perturbation.md) を参照。関数の既定は指数大気、軌道維持解析は Harris-Priester 風モデルを指定する。J2 平均近点角補正と J3 の検証範囲も同資料に記載する。

<a id="maintenance"></a>

### 8.2 軌道維持解析（`src/lib/orbitMaintenanceAnalysis.ts`）

`analyzeOrbitMaintenance(spec, satelliteLabel, startTime, input)`。大気モデルは **Harris-Priester 風モデルに固定**（`normalizeInput` が `atmosphereModel: "harris-priester"` を強制）。抗力レートは [摂動モデル](perturbation.md) の式を使い、この解析では高度上限を `lowOrbitLimitKm = 1500` に上書きする（摂動関数の既定は 1000 km）。

自然減衰は抗力レートの単純オイラー積分。以下の a・Re・高度は km、レートは km/year、年は 365.25 日:

```
for step in 0 .. totalSteps:               # 刻み timelineStepDays（既定 15 日）
    record(a, e, step)                    # 更新前の状態を記録
    if step == totalSteps or perigeeAltitude(a, e) <= deorbitAltitudeKm:
        continue                         # 閾値以下では以降の更新を止める
    rates = calculateDetailedPerturbationRates({a, e, ...}, B, atmosphere)
    a += rates.drag.da_dt * (stepDays / 365.25)
    e = clamp(e + rates.drag.de_dt * (stepDays / 365.25), 0, 0.8)
    a = max(a, Re + deorbitAltitudeKm)
```

タイムラインに記録される `densityKgPerM3` / `densityReferenceAltitudeKm` は `max(perigeeAltitude, 120 km)` で評価した表示用の値。**積分に使う摂動レートの計算には生の近地点高度が渡される**（Harris-Priester 側がテーブル下端 150 km で自前にクリップする）。

維持 ΔV は「1 年分落ちた平均高度を円軌道間の Hohmann 2 インパルスで元に戻す」で見積る（`buildAnnualBudget`、年内は 10 日刻みで再積分）:

```
# r1, r2 は変更前後の軌道半径 [m]、mu は m^3/s^2、dv は m/s
# Isp は比推力 [s]、g0 = 9.80665 m/s^2、質量は kg
dv = |sqrt(mu/r1)*(sqrt(2*r2/(r1+r2)) - 1)| + |sqrt(mu/r2)*(1 - sqrt(2*r1/(r1+r2)))|
推進剤 = dryMass * (exp(dv / (Isp*g0)) - 1)                    # ツィオルコフスキー
必要量（マージン込み）= 推進剤合計 * (1 + propellantMarginPercent/100)
```

減衰・年次予算とも `ceil(duration/step)` で窓を丸めるので、終点が要求期間を超え得る（年次予算は 365.25 日を 370 日まで計算）。各年は同じ入力高度から再開し、推進剤は各年のドライ質量基準の見積りを加算する。楕円軌道の維持、面変更、RAAN 維持、デオービット噴射はこの ΔV に含めない。減衰の初期 e/i は選択した衛星要素を参照する。

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

<a id="rgt"></a>

## 9. 回帰軌道 RGT（`src/lib/rgt.ts`）

理論は [RGTorbit.md](RGTorbit.md)。J2 平均要素ベースで「整数回帰比 (revs, days)」を満たす高度／傾斜角を解く。

| 関数 | 用途 |
| --- | --- |
| `suggestRgtRatioFromAltitudeInclination` | 高度・傾斜角から近い整数比を提案 |
| `solveAltitudeFromInclinationAndRatio` | 傾斜角と比を固定して高度を解く |
| `solveInclinationFromAltitudeAndRatio` | 高度と比を固定して傾斜角を解く |
| `solveRgtFromAltitudeInclination` | 上をまとめた入口 |

RGT は設計方式（Walker 等）と直交する**横断ヘルパ**として位置づけられており、方式そのものではない（[constellation-patterns.md](constellation-patterns.md) §8）。UI は `src/components/ui/RgtConstraintSection.tsx`。

---

<a id="solar-power"></a>

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

含まれないもの: 半影（penumbra）／本影の円錐、地球扁平、大気による屈折・減光、太陽の有限角径。食入り／食出の遷移は瞬時として扱う。

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

`E` と容量は Wh、発生／負荷は W なので、上の `dt` は **時間（h = stepSeconds/3600）**。初期点では更新せず、以後は区間右端の電力で更新する。

代表日 4 点（同じ UTC 年の 3/20・6/21・9/22・12/21、時分秒は開始時刻から流用）を比較し、**4 点のうち最低 SOC の日**を返す。年間全日の最悪ケースではない。各日は同じ初期 SOC から独立に開始し、1 変数感度掃引も返す。

必要太陽電池出力の下限見積り:

```
averageLoad = (baseLoad + payloadLoad*duty) * (1+margin)
            + (sunlightExtra*sunlightRatio + eclipseExtra*(1-sunlightRatio)) * (1+margin)
generationFactor = degradation * sunTrackingFactor * powerPathEfficiency * sunlightRatio
minSolarArrayW   = averageLoad / generationFactor
# margin = designMarginPercent/100、電力は W、sunlightRatio は 0〜1 の割合
```

KPI の定義と近似:

- `dailyGenerationWh` / `dailyLoadWh` は `sum(P_sample * stepSeconds/3600)`。初期点・終点とも数えるため、24 h / 120 s では 721 点 = 24 h + 120 s 相当。周回 KPI でも同名フィールドはその周回窓の合計であり、24 h 換算ではない。
- `minBatteryRequiredWh = eclipseLoadW * (eclipseMinutes/60) / max(1-minSocPercent/100, 0.05)`。日照復帰までのエネルギー下限見積りで、初期 SOC と放電効率を式に入れない。`eclipseMinutes` は §2.3 の次の食区間から取る。
- `minSolarArrayPowerRequiredW` も平均負荷の下限見積りで、バッテリの充放電損失を含めない。これらの値だけで SOC 条件の成立を保証しない。
- `sunlightRatio` はサンプル比、`maxContinuousEclipseMinutes` は連続食サンプル数 × 刻み。SOC 計算は容量でクリップし、負荷未達の時間や充電余剰の量は記録しない。
- `designStatus` は最小 SOC がしきい値以下なら `critical`、それ以外で発電量 < 消費量なら `warning`、他は `nominal`。

主な既定値（`createDefaultSolarPowerInput`）: 周回刻み 30 s、24 h 刻み 120 s、BOL 250 W、日照追尾係数 0.78、電力経路効率 0.90、劣化 2.5 %/年、ミッション 3 年、ベース負荷 90 W、バッテリ 650 Wh、初期 SOC 95 %、最低 SOC 30 %、充電効率 0.95、放電効率 0.94、設計マージン 20 %。

---

<a id="coverage"></a>

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

が同じ集計カーネルを使う。位置モデル・幾何判定・サンプル設定は異なるので、評価値の一致は保証しない。

fold（N 重可用性）、緯度別カバレッジ行、ギャップ統計をここで扱う。§3.3 の「1 機以上」しか見ない可用性とはここが決定的に違う。

詳細は [constellation-design.md](constellation-design.md)（2 段パイプライン、指標定義、Worker プロトコル、限界）。

### 11.3 解析側から見た設計方式

`src/lib/constellationPatterns/*` が 6 方式（Walker Delta / Walker Star / Streets of Coverage / Flower / Lattice Flower / Necklace Flower）を TOML から `SatelliteSpec[]` に展開する。解析にとって重要なのは副産物の `IslShellRange`:

```ts
{ key, name?, startIndex, count, planes, planeSizes?, wrapPlanes? }
```

- `planeSizes`: 各面の機数が既定の先頭詰め配置と異なる場合に入る（不均等 Flower、Necklace の間引き、故障による欠損など）
- `wrapPlanes`: Walker Star や通常の SoC ではシームを跨ぐ構造リンクを張らないため `false`。SoC が全周配置になる場合は `true`（[配置方式 §9](constellation-patterns.md)）

ISL の `gridPattern` トポロジと、シェル別リンクモデルの解決はこれを見て行う。生成物 `src/lib/satellites.generated.ts` は `scripts/generate-satellites.ts` が作るので手編集しない。

---

## 12. 実行基盤

| 経路 | エントリ | 中身 |
| --- | --- | --- |
| ブラウザ描画ループ | `src/lib/visualization.ts`, `src/components/useSatelliteScene.ts` | 毎フレーム SGP4。Three.js リソースは `useSatelliteScene` の cleanup で dispose する |
| 局アクセス解析 | `src/workers/stationAccessWorker.ts` | TOML パース + `visibility.ts`。UI は `terminate()` で中断 |
| ISL 経路探索 | `src/workers/islRoutingWorker.ts` | `init` / `configure` / `compute` / `sweep`。`propagateAll` のバッファを init 間で再利用 |
| ミッション設計 | `src/workers/constellationDesignWorker.ts` | `enumerate → screen → verify` を丸ごとオフスレッド。キャンセルメッセージはなく `terminate()` で中断 |
| CLI | `src/cli/main.ts`（`bun run cli` / `bun run build:cli`） | `analyzeLinkDuty` のみ。`--format json\|csv`, `--summary-only`, `--duration-hours`, `--step-seconds` |
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
| 抗力適用の高度上限 | 関数既定 1000 km / 維持解析 1500 km | `perturbation.ts`, `orbitMaintenanceAnalysis.ts` |
| 指数大気の基準 | h0 = 400 km, H = 60 km, rho0 = 1e-12 kg/m^3 | `perturbation.ts` |
| F10.7 / Ap（既定） | 150 / 15 | `perturbation.ts` |
| 軌道維持タイムライン刻み | 15 日（年次予算は 10 日、寿命推定は 30 日） | `orbitMaintenanceAnalysis.ts` |
| 電力解析 周回／日刻み | 30 s / 120 s | `solarPowerAnalysis.ts` |
| 設計スクリーン | 5 deg グリッド / 8 時刻 | `constellationDesign/screen.ts` |
| 設計検証 | 2 deg / 32 時刻（高精度 1 deg / 96） | `constellationDesign/verify.ts` |
| 設計ギャップ評価 | 24 h / 60 s 刻み | `constellationDesign/verify.ts` |
| SoC 間隔安全率 | 1 | `constellationDesign/types.ts` |

---

<a id="limits"></a>

## 14. 解析範囲と限界

| 対象 | 結果に含まれないもの・解釈の注意 | 詳細 |
| --- | --- | --- |
| 地上リンク | RF リンクバジェット（EIRP、G/T、自由空間・降雨損失など）、変調・符号化、干渉、容量・ビーム割当・ハンドオーバを評価しない | §5・§6 |
| 距離・Doppler | 真空中の幾何遅延と一次 Doppler。大気屈折、機器遅延、相対論補正、Doppler レートは含まない | §5 |
| 可用性 | 有限サンプルの評価。局アクセスは 1 機以上、設計は指定 fold 以上を数える。「全球アクセス」は単一経線 | §3・§4・[設計指標](constellation-design.md#availability-metrics) |
| 通信経路 | 単一 A/B 間の経路コスト。帯域・輻輳・冗長経路・パケット動作を扱わず、地上リンクのデューティとも統合しない | [ISL の制限](isl-routing.md#limitations) |
| 寿命・推進剤 | 簡易大気とレート積分。密度モデル・楕円軌道近似・刻みの誤差保証はない | §8・[摂動モデル](perturbation.md) |
| 日照・電力 | 円柱影、固定の日照追尾係数、代表 4 日の比較。半影や年間全日の最悪条件は評価しない | §10 |
| ミッション設計 | Walker Delta / Star の全球・緯度帯探索。Flower 系、任意ポリゴン、需要分布、ISL 接続性は対象外 | [設計の限界](constellation-design.md#limitations) |

RGT/J2 補正と J3 は [RGT §4.1](RGTorbit.md#implemented-rates)・[摂動モデル](perturbation.md)、長期維持・電力サイジングの近似は §8・§10 を参照。エポックから離れた解析では、入力データの有効性も確認すること。

---

<a id="implementation-tests"></a>

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

- [perturbation.md](perturbation.md) — J2 / J3 / 抗力の理論式と擬似コード
- [RGTorbit.md](RGTorbit.md) — 回帰軌道の条件式と設計フロー
- [isl-routing.md](isl-routing.md) — ISL 経路探索の理論・実装・既定値・性能
- [constellation-patterns.md](constellation-patterns.md) — 6 設計方式と TOML スキーマ
- [constellation-design.md](constellation-design.md) — ミッション駆動オプティマイザ（2 段パイプライン）
- [constelation-cli-SKILLS.md](constelation-cli-SKILLS.md) — CLI エージェント向けガイド（`dist/SKILLS.md` の元）
- `AGENTS.md` / `CLAUDE.md` — プロジェクト運用ルール
