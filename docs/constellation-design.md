# ミッション駆動コンステレーション設計 — 理論と実装

*(Markdown 上のプレーンテキスト数式、LaTeX 不使用)*

「コンステレーション編集」ダイアログの「✨ ミッションから設計」は、通信衛星ミッションの**目的**(何を最小化・最大化したいか)と**制約**(仰角・被覆重複度・対象領域・高度範囲など)を入力すると、その条件を満たすコンステレーション候補を自動で列挙し、上位候補を数値検証したうえで、選んだ候補をシェルとして追加できる機能である。実装は `src/lib/constellationDesign/` にあり、重い計算は `src/workers/constellationDesignWorker.ts` にオフロードされる。

本ドキュメントは最適化パイプラインの理論・実装・検証指標の意味と、**設計上の前提と限界**をまとめたリファレンス。個々の設計方式(Walker Delta/Star, Streets of Coverage など)の式は `docs/constellation-design.md` ではなく `docs/constellation-patterns.md` を参照。

---

## 1. 目的

入力は「通信ミッションの目的 + 制約」、出力は「候補コンステレーションのランキング + 検証済み指標」。目的は 3 つ(`DesignObjective`):

| 目的 | 意味 |
|---|---|
| `minSatellites` | 制約を満たす最小衛星数を探す |
| `paretoCountVsAltitude` | 高度ごとに最小衛星数を並べ、衛星数 vs 高度(≈遅延)のトレードオフを見せる |
| `fixedBudget` | 衛星数上限を固定し、その範囲でカバレッジを最大化する |

制約(`DesignConstraints`)の主なもの: `minElevationDeg`(最低仰角)、`fold`(同時被覆数、1〜4)、`region`(全球 or 緯度帯)、`altitudeMinKm`/`altitudeMaxKm`(高度範囲)、任意で `inclinationMinDeg`/`inclinationMaxDeg`、`maxPlanes`/`maxSatsPerPlane`、`families`(対象方式)、`rgt`(反復地上軌跡を課すか)。ISL 制約は明示的に対象外で、`constraints.isl` は型上 `never` にされており、実行時にそれが渡されると `assertSupportedRequest` が例外を投げる(フック名だけ予約し、黙って無視することはしない)。同関数は高度範囲の前提(`altitudeMinKm > 0` かつ `altitudeMaxKm ≥ altitudeMinKm`)も検査し、満たさなければ日本語のメッセージで例外を投げる。

対象とする方式は **Walker Delta と Walker Star(= Streets of Coverage の元になる Star 系)のみ**。Flower / Lattice Flower / Necklace はフォームと生成器だけを持ち、列挙・検証カーネルには含まれない。理由はカバレッジカーネルの高速経路が `T = P·S`(面数 × 面内衛星数)と `e = 0`(離心率ゼロ)を前提にしており、Flower 系はこの前提を満たさないため(`src/lib/constellationDesign/types.ts::PatternFamily` のコメント)。

---

## 2. 2 段パイプライン

```
ステージ 1a: 解析的サイジング(Star のみ、メインスレッドで即時)
    ↓
ステージ 1b: 粗い数値スクリーニング(荒いグリッド・少ないタイムステップ)
    ↓
ステージ 2: 上位 K 件の SGP4 数値検証(細かいグリッド・多いタイムステップ)
    ↓
    ランキング(目的別)
```

### 2.1 ステージ 1a — Walker Star の解析的サイジング(`starSizing.ts`)

Streets of Coverage の寸法計算式(`designStreetsOfCoverage`、`docs/constellation-patterns.md` §4)は閉形式なので、高度 × S(1 面あたり衛星数)の組み合わせごとに面数が即座に決まる。数百候補が伝播計算ゼロ、数マイクロ秒で列挙される。`enumerateStarCandidates` はメインスレッドで呼べる関数で、Worker の応答を待たずに UI へ即座に候補を出せる。

n 重被覆(fold > 1)は 2 通りの戦略で列挙される(fold = 1 では前者だけが使われる):

- **面内 n 重**: `fold` をそのまま寸法計算に渡す。ストリートを広げ、各面を厚くする。
- **面間 n 重**: 単一被覆でサイジングしたあと、同じ RAAN スパンに `P = ceil(n·P₁)` 面を詰め込み、隣接面同士の重なりで n 重を作る。

面間位相 F は探索されない。寸法計算が生成する ω から

```
F = T · ω / 360
```

として解析的に決まる。これは `streets_of_coverage.ts` がシェル化時に再計算する式そのものであり、異なる F を選ぶと検証済みの候補とシェルが食い違ってしまうため。

**実測値の例**(`tests/constellationDesign-starSizing.test.ts`): Iridium 相当(h=780km, ε=8.2°, S=11)は P=6, T=66, Δco=31.389°, F=3。2 重被覆(S=20)の面内サイジングは **P=13, T=260**, Δco=27.788°, F=6.5 になる。同じ 2 重被覆の面間サイジングは P=10, T=200 になるが、これはスクリーニングで棄却される(後述)。

### 2.2 ステージ 1b — Walker Delta の探索(`deltaSizing.ts`)

Star と異なり、Walker Delta には「対象領域を満たす最小 T」の閉形式がない。計画時点の素朴な案(T を下界から 1 ずつ増やし、あらゆる分割 P と位相 F を試す)は現実的な時間で終わらない: 全球 25° 単一被覆で下界は約 185、実際の最小 T はその 1.5〜2.5 倍、しかも T あたり σ(T) ≈ 2.5·T 通りの (P, F) 組み合わせを 1 回約 1.3 ms でスクリーニングすると、(高度, 傾斜角) セル 1 つあたり数分かかる計算になる。

代わりに次の 4 つの高速化を組み合わせている:

1. **高度軸のウォームスタート**: 傾斜角を固定すると、高度が高いほど θ(地球中心角)が大きくなり、被覆可能な T の集合はその上位互換になる(T の最小値は高度に対して単調非増加)。そこで高度は高い方から低い方へ走査し、各セルは直前のセルの答えのすぐ下から探索を始める。
2. **幾何級数ラダー + 二分法**: T を ×1.15 刻みで増やしながら最初に成立する値を探し、その後に最後の不成立値との間を二分探索で追い込む。得られるのは「探索格子上の最小 T」であり、この事実は診断メッセージにも明記される。
3. **合成数へのスナップ**: 各プローブ値は +3 の範囲で最も約数の多い値へ寄せられる。素数の T はほぼ分割方法がなく、それだけで「不成立」に見えてしまい、二分法を誤った方向に収束させるため。
4. **形状・位相の順序付け**: T を成立させるには 1 つの (P, F) が成功すれば十分なので、P は √T に近い順、F は P/2(半面ずらし)付近から試す。P ≤ 6 のときだけ F を全探索する。

これに加えて**スクリーニング回数の予算**(セルごと・全体)を設け、上限に達した場合は打ち切って `diagnostics.warnings` に記録する(結果を偽らない)。

### 2.3 ランキング(`enumerate.ts::rankCandidates`)

| 目的 | 並べ替え |
|---|---|
| `minSatellites` | T 昇順 → 高度昇順 → アスペクト比(P と √T の近さ)昇順 |
| `paretoCountVsAltitude` | 高度ごとに最小 T の候補を 1 件だけ残す(支配されない集合) |
| `fixedBudget` | `T ≤ budget`(`==` ではない。素数の予算だと空集合になるため)で可用率降順 |

RGT が有効な場合は、傾斜角ごとに `suggestRgtRatioFromAltitudeInclination` → `solveAltitudeFromInclinationAndRatio` で高度を量子化する(§5)。

---

## 3. カバレッジカーネル(`coverageKernel.ts`)

解析的スクリーニングと数値検証は**同じ幾何述語の実装を共有**する(`accumulateCoverage`)。呼び出し側が衛星位置を埋める `sampleAt` コールバックだけを渡し、円ケプラー運動(スクリーニング)と SGP4(検証)を差し替える。これにより「スクリーニングでは成立、検証では不成立」という食い違いが、忠実度の違いからのみ発生し、2 つの微妙に異なる幾何実装から発生することがない。

### 3.1 等面積格子

緯度・経度グリッドは緯度バンドごとに等面積になるよう経度点数を調整する(`buildRegionGrid`)。素朴な等間隔格子だと極付近に点が過剰に集中するため。

### 3.2 球面判定 vs 楕円体判定、そして悲観性

| 述語 | 使用箇所 | 判定 |
|---|---|---|
| 球面(`spherical`) | ステージ 1b スクリーニング | 単位ベクトルの内積が cos θ 以上か |
| WGS-84 楕円体(`ellipsoid`) | ステージ 2 検証 | 測地上向き法線ベクトルとの内積から実仰角を判定 |

球面判定は LEO において**悲観的**(実際より被覆を過小評価する)ことがテストで確認されている(`tests/constellationDesign-kernel.test.ts`)。したがってスクリーニングのゲートは検証の閾値よりわずかに緩め(`SCREEN_THRESHOLD_MARGIN = 0.002`)、検証で通る候補をスクリーニング段階で誤って捨てないようにしている。

緯度バンドの事前絞り込み(prefilter)は、球面判定では厳密だが楕円体判定では余裕を持たせる必要がある(測地法線は測心半径から最大 0.19° 傾き、極半径は赤道半径より 21 km 小さい)。そのマージンは定数ではなく、θ を計算した赤道球に対して扁平な高緯度面が同じ軌道半径からどこまで見えるか(`θ_polar = acos((a(1−f)/r)·cos ε) − ε`、`r = a·cos ε / cos(θ+ε)`)を毎回求め、測地法線の傾き 0.1924° を足したものを用いる(`ellipsoidBandMarginRad`)。固定 0.5° は上界にならない(h = 300 km, ε = 0 では約 0.66° 必要)ためである。バンドあり/なしの結果が一致することは低高度・低仰角の組を含めてテストで固定されている。

### 3.3 T_orb/S 時間窓 + 黄金比ディザ

一様な位相配置(`kernelFastPath: true`)では、被覆点集合が `Δt = T_orb / S`(軌道周期 ÷ 1 面あたり衛星数)ごとに不変になる。これは円軌道・面内等間隔・`T = P·S` が成り立つ場合にのみ言える性質で、フルの軌道周期をサンプリングする代わりにこの短い窓だけをサンプリングすれば統計的に同じ結果が得られ、約 26 倍高速になる(`tests/constellationDesign-kernel.test.ts` で meanFold の差 <0.01 を確認)。

ただしディザなしでは、同じ地表経度の並びを毎ステップ繰り返し観測することになり、**Iridium のシーム付近の穴を見逃す**ことがテストで示されている。そのため衛星位置に黄金比増分(0.6180339887 回転/ステップ)で経度ディザを掛ける。ディザあり・なしで `foldAvailability` が異なる値になり、かつどちらもフル周期の参照値の 1e-4 以内に収まることが確認されている。

固定点の**ギャップ長**(§4)はこの高速経路と根本的に相性が悪い: ギャップ長は「実時間で連続してどれだけ不可視だったか」を測る量なので、ディザや短縮窓を使うと意味を持たない。したがってギャップ測定は常にフル 24 時間・undithered・専用の固定点集合(`buildGapPointSet`、緯度 5° 刻み × 経度 3 点、約 110 点)で別パスとして行う。

---

## 4. 検証指標とその意味

ステージ 2(`verify.ts::verifyCandidate`)は SGP4 で衛星を伝播し、2 つの独立したパスを走らせる。

### 4.1 面積パス — `foldAvailability` が実行可能性の判定基準

```
foldAvailability = fold 条件を満たした (地点, 時刻) の割合
```

**フィージビリティの判定には常に `foldAvailability` を使い、閾値は既定 0.9999**(`continuousThreshold`)。

`minFold`(サンプルした (地点, 時刻) 全体での最小同時被覆数)は**分解能に依存する**値であり、格子を細かくするほど悪化する一方の下界にすぎない。実例: Iridium を仰角 8.2° で検証すると、2° グリッド・32 ステップでは `foldAvailability ≥ 0.999` を確認できるが、`minFold` はグリッドを 1°・96 ステップに細かくした途端に 0 へ落ちる(`tests/constellationDesign-kernel.test.ts` のコメント)。したがって **`minFold` はフィージビリティ判定に使ってはならない**。UI・診断の両方でこの区別を明示している(`VerifiedMetrics.minFoldIsResolutionSensitive` は常に `true`)。

`perLatitude[]` は緯度ごとの `meanFold`/`foldAvailability`/`minFold` で、UI の「最悪緯度はどこか」の表示に使う。

### 4.2 ギャップパス — 実時間での連続不可視時間

固定 110 点・24 時間・60 秒刻みで、fold 条件を割った連続区間の長さを集計する(`maxGapSec`, `meanGapSec`, `gapCount`)。ウィンドウ終了時点でまだ開いているギャップも「最悪ケース」として含める(打ち切りではなく実測値として扱う)。

### 4.3 遅延(閉形式)

伝播遅延は幾何から閉形式で得られる(`docs/constellation-patterns.md` のカバレッジ幾何と同じ式):

```
latencyAtEpsilonMs = slantRangeAtElevation(h, ε) / c × 1000
latencyNadirMs     = h / c × 1000
```

数値伝播は不要で、`AnalyticMetrics` に格納されて検証結果と一緒に表示される。

### 4.4 忠実度(`fidelity: "standard" | "high"`)

| 設定 | グリッド | タイムステップ | 時間窓 | ディザ |
|---|---|---|---|---|
| `standard`(既定) | 2° | 32 | 高速経路(可能なら T_orb/S) | あり(高速経路時) |
| `high` | 1° | 96 | 常にフル軌道周期 | なし |

`high` は高速経路を完全に放棄する。最終判断がディザの統計的十分性に依存しないようにするための、あえて遅い確認用モード。

---

## 5. RGT 量子化(傾斜角ごと)

`constraints.rgt.enabled` を立てると、`searchGrid.ts::altitudeSamplesForInclination` が自由な高度グリッドを**置き換える**: その傾斜角で実際に反復地上軌跡を閉じる離散高度だけを候補にする。自由な高度は制約の趣旨(「高度がもう自由変数ではない」)に反するため、代替ではなく置換になっている。理論は `docs/RGTorbit.md` を参照。実装は `rgt.ts::suggestRgtRatioFromAltitudeInclination`(整数比 N_S/N_D の推定)→ `solveAltitudeFromInclinationAndRatio`(その比を満たす高度を数値的に解く)の 2 段。

---

## 6. Worker プロトコル

`src/workers/constellationDesignWorker.ts` + `.types.ts`。`islRoutingWorker.types.ts` / `stationAccessWorker.types.ts` と同じ `id` 付き request/response union 規約。

| メッセージ | 方向 | 内容 |
|---|---|---|
| `design` | → Worker | `DesignRequest` 一式 |
| `ack` | ← Worker | 受理直後、計算開始前 |
| `progress` | ← Worker | `{ phase: "screen" \| "verify", done, total, message? }` |
| `partial` | ← Worker | 候補 1 件がスクリーニングまたは検証され次第ストリーミング |
| `result` | ← Worker | `DesignResult` 一式 |
| `error` | ← Worker | エラーメッセージ |

**中止に専用メッセージはない**。呼び出し側は `terminate()` を呼んで Worker を破棄し、必要なら新しい Worker を生成し直す(`StationAccessAnalysis.tsx` と同じ流儀)。すべての境界越えデータ(`DesignRequest`/`DesignResult`/`DesignCandidate`)は構造化複製可能なプレーンオブジェクトで、`Date` やクラスインスタンス、関数を含まない。

---

## 7. 候補 → シェル変換(`toShell.ts`)

`candidateToShell` は「検証した構成と、シェルとして追加した構成が寸分違わず一致する」ことを保証する変換で、2 つの落とし穴を明示的に扱っている。

1. **Streets of Coverage として書けるのは、寸法計算がその候補の設計入力から同じ面数・総数を再現できるときだけ**。`streets_of_coverage` シェルは常に `spacingSafetyFactor = 1` で寸法を再計算するため(`docs/constellation-patterns.md` §4 の「実装上の逸脱」参照)、それ以外の安全係数でサイジングした候補はこの形で表現できない。`isExpressibleAsStreetsOfCoverage` が一致を確認し、一致しなければ角度をすべて保持した明示的な `walker_star` シェルにフォールバックする。
2. **面間 n 重(cross-plane)の Star 候補は常に `walker_star` として書き出す**。`P = ceil(n·P₁)` という面数は面内サイジング式が生成しない値だからである。

Delta 候補は常に `walker_delta`(`raan_range = 360`)。どちらのパターンでも `rgt_repeat_orbits`/`rgt_repeat_days`(候補が RGT 量子化から来ている場合)と `mission_*`(目的・制約の由来情報)が書き込まれる。

結果が空だった場合、`relaxationSuggestions` が緩和案を安いものから順に提示する: 最低仰角を 15° まで緩和 → 高度上限を 500 km 引き上げ(2000 km 上限)→ 被覆重複度を 1 段階緩和 → 全球から緯度 ±60° 帯へ縮小。いずれも元の制約オブジェクトを変更せず新しいオブジェクトを返す。

---

## 8. 性能

コードコメントに記録されている実測感覚値(`src/lib/constellationDesign/types.ts`):

- 粗いスクリーニング 1 回(5° グリッド、8 ステップ、数百衛星)は**約 0.3 ms**。既定の全体予算 20,000 回は**約 6 秒**相当で、これがプログレスバーを表示すべき境目になっている。予算なしの分割・位相探索は数分かかりうる。
- セルごとの予算は既定 400 回。全体・セルいずれかの予算に達すると打ち切り、`diagnostics.warnings` に記録して結果は返す(黙って劣った答えを返さない)。

専用ベンチマークスクリプト(`scripts/bench-isl.ts` に相当するもの)は現時点では存在しない。上記はテスト・コードコメントに残る参考値であり、環境依存の絶対値ではなく「オーダー感」として扱うこと。

---

## 9. 前提と限界

| 項目 | 内容 |
|---|---|
| **円軌道のみ** | カバレッジカーネルの高速経路(`kernelFastPath`)は `e = 0` を前提にしている。Flower など離心率を持つ方式は最初から最適化対象に含めていない。 |
| **Walker Delta の最小 T は探索格子上の最小値** | 「本当の最小」を保証する式はなく、幾何級数ラダー + 二分法 + 予算で打ち切った探索の結果。`diagnostics.warnings` に常に明記される。 |
| **N 重 Streets of Coverage は近似** | 面内 n 重のストリート半幅、または面間の P = ceil(n·P₁) のどちらの見積りも近似であり、実際の可用率は数値検証の結果で判断する必要がある。 |
| **時間窓内は J2 を無視** | ステージ 1b の解析的スクリーニングは円ケプラー運動を使い、摂動を含めない。ステージ 2 の SGP4 検証は摂動を含むが、時間窓自体(`T_orb/S` の高速経路)は無摂動の周期性を前提に選ばれている。 |
| **リンクバジェット・地形・ISL は扱わない** | `constraints.isl` は型上禁止され実行時にも例外になる。電波リンクバジェットや地形遮蔽、衛星間リンクの接続性は最適化の目的関数に一切含まれない。 |
| **格子バイアス** | 等面積格子・T_orb/S 窓・黄金比ディザはいずれも統計的な近似であり、格子や乱数シードの選び方に依存した誤差を持つ(`high` 忠実度で緩和できるが除去はできない)。 |
| **対象方式は Walker Delta / Star のみ** | Flower / Lattice Flower / Necklace は列挙・検証カーネルの対象外(§1)。 |
| **仰角は最低仰角のみ** | 方位角制約、ジンバル可動範囲、太陽・月方向の回避などは扱わない(`docs/isl-routing.md` §5 の既知の制限と同種の割り切り)。 |

---

## 10. 関連ドキュメント

- `docs/constellation-patterns.md` — 各設計方式(Walker Delta/Star, Streets of Coverage, Flower 系)自体の式とスキーマ。
- `docs/RGTorbit.md` — 反復地上軌跡(RGT)条件の理論と数値解法。
- `docs/isl-routing.md` — 生成されたコンステレーションに対する衛星間経路探索(本ドキュメントの対象外)。
