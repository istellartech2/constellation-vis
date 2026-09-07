# コンステレーション設計方式 — リファレンス

*(Markdown 上のプレーンテキスト数式、LaTeX 不使用)*

「コンステレーション編集」ダイアログの各シェルは、6 つの設計方式(パターン)のいずれかで定義できる: **Walker Delta / Walker Star / Streets of Coverage / Flower / Lattice Flower(2D-LFC) / Necklace Flower**。本ドキュメントは各方式の意味・入力・数式・派生値・バリデーションと、方式を跨いで共通する仕組み(RGT ヘルパー、ISL の `planeSizes`/`wrapPlanes`)をまとめたリファレンスである。

実装は `src/lib/constellationPatterns/` にあり、各方式は同じ `PatternGenerator` インターフェース(`plan` / `derive` / `validate`)を実装して `registry.ts` の `PATTERN_REGISTRY` に登録されている。TOML キーの一覧は `fields.ts` の `FIELD_REGISTRY` が唯一の情報源で、両パーサ(`tomlParsers.ts` / `constellationSerializer.ts`)・バリデーション・エディタ UI がここを読む。

---

## 1. `pattern` フィールドと後方互換性

`[[constellation.shells]]` の `pattern` キーが設計方式を選ぶ。**省略した場合は `walker_delta` として扱われる**(`DEFAULT_PATTERN_ID`)。これにより、パターン導入前に書かれた既存の `constellation.toml` は一切変更せずに読み込め、生成される衛星要素はビット単位で従来と同一になる(`tests/constellationPatternsBaseline.test.ts` がこれを固定するスナップショットテスト)。

後方互換性のために保たれている規約:

- **`pattern` は `walker_delta` のときだけ書き出さない**。他の 5 方式ではシリアライズ時に必ず `pattern = "..."` 行が書かれる(`constellationSerializer.ts`)。
- **`count` と `planes` は全パターンで必ず TOML に書き出される**。Streets of Coverage / Flower / Lattice Flower / Necklace Flower のように値が設計から導出される方式でも、導出済みの実際の値(`derived.totalSats` / `derived.planes`)がそのまま書かれる。理由は 2 つ: `EditorTab.tsx` が `count =` 行を正規表現で数えて衛星総数を把握していること、ISL の `IslShellRange.planes` が実際の面数を必要とすることの 2 点。ユーザー入力として直接編集するのは Walker Delta / Walker Star のみ(`USER_SIZED_PATTERNS`)で、他方式では読み取り専用の表示になる。
- **角度は常に `[0, 360)` に正規化されて書き出される**(`normalizeAngleDeg`)。ただし正規化は `((x % 360) + 360) % 360` ではなく、素の `%` に負の場合だけ 360 を足す実装になっている。これは IEEE754 の丸めで `(0.1 + 360) % 360 !== 0.1` となるケースを避けるためで、既存 TOML の値をわずかに動かさないための意図的な選択である。
- 未知の `pattern` 文字列は検証エラーではなく **`walker_delta` 扱いにフォールバック**しつつ、警告メッセージで知らせる(`validateShell`)。

---

## 2. Walker Delta

### 概要

古典的な Walker ローゼット。全 T 機を P 面に均等配置し、面間の位相を F で与える標準表記 `T/P/F: i` そのもの。パターン導入前の唯一の生成ロジックであり、他方式(2D-LFC など)の実装基盤としても再利用される。

### 通信ミッションでの用途

グローバルな低遅延ブロードバンド(Starlink・Kuiper 型)。傾斜角を選べるため中緯度〜低緯度への集中配置がしやすい半面、南北両極付近のカバレッジは傾斜角に依存して弱くなる。

### 入力

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `count` | int | 1 | 総衛星数 T |
| `planes` | int | 1 | 軌道面数 P |
| `phasing` | number | 0 | 位相係数 F |
| `apogee_altitude` | number | 0 | 遠地点高度 [km] |
| `eccentricity` | number | 0 | 離心率 |
| `inclination` | number | 0 | 傾斜角 [deg] |
| `raan_range` | number | 360 | 面群が占める RAAN 範囲 [deg] |
| `raan_start` | number | 0 | 先頭面の RAAN [deg] |
| `argp` | number | 0 | 近地点引数 [deg] |
| `mean_anomaly_0` | number | 0 | 基準平均近点角 [deg] |

### 数式

面ごとの RAAN と面内衛星(スロット `j = 0..⌈T/P⌉-1`、面 `p = 0..P-1`)の平均近点角は次の通り(`walkerDelta.ts::planWalkerDelta`):

```
Ω_p     = raan_start + raan_range · p / P
M(p, j) = ( mean_anomaly_0 + (360 / T) · (p·F + j·P) ) mod 360
```

**注意**: この 2 式は旧実装 `generateFromShellsDetailed` からの**文字通りの移植**であり、`360/T` を先に割ったり `raan_range/P` を定数化したりする代数的な簡約はしていない。浮動小数の最下位ビットまで一致させることが目的で、崩すと `tests/constellationPatternsBaseline.test.ts` が壊れる。

`wrapPlanes = true`(最終面は面 0 の RAAN 隣接面として扱われる。ISL の +Grid ではリングが閉じる)。

### 派生値

- Walker 表記 `T/P/F: i`
- 等価 2D-LFC の `Nc`(`lfcNcFromWalker`): `count` が `planes` で割り切れず、`phasing` が整数でない場合は `null`
- 標準の派生セット(半長軸・周期・面内/面間角度間隔・RGT 近似比)は §7 参照

### バリデーション

Walker Delta 固有のエラー/警告はない(`validate` は常に空配列)。数値の非有限チェックと `count ≥ planes` チェックは registry / serializer 側の共通ルールで行われる。

---

## 3. Walker Star

### 概要

面群を半球(既定 180°)にしか展開せず、最初と最後の面が**逆回転で隣接するシーム**を持つ Iridium 型のレイアウト。極軌道に近い傾斜角でのみ意味を持つ。

### 通信ミッションでの用途

極域を含む全球均一カバレッジ(Iridium 型)。Streets of Coverage が「必要な被覆条件から面数を逆算する」のに対し、Walker Star は面数・位相をユーザーが直接指定する素の版。

### 入力

Walker Delta の共通キーに加えて:

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `raan_range` | number | **180**(star/soc 既定) | シーム込みで面群が占める RAAN 範囲 |
| `raan_spacing` | number | `raan_range / planes`(格納されている `raan_range` を用いる) | 明示的な同方向面間隔 Δco。既定値と一致していてもシリアライザは**常に書き出す**(`alwaysWrite`) |
| `phasing` | number | **planes / 2**(半スロットずらし) | 面間位相 F |
| `inclination` | number | **90**(star/soc 既定) | 傾斜角。極 ± 10° を外れると警告 |

### 数式

```
Ω_p  = raan_start + p · Δco         (Δco = raan_spacing が明示されていればその値、
                                      なければ raan_range / planes)
seam = raan_range − (planes − 1) · Δco
M(p, j) = ( mean_anomaly_0 + (360 / T) · (p·F + j·P) ) mod 360     (F は既定 P/2)
```

`raan_spacing` を省略すると `Ω_p` は Walker Delta と同じ式 `raan_start + raan_range·p/planes` になるため、**`raan_range = 180` の Walker Delta とビット単位で一致する**(`walkerStar.test.ts` の等価性テスト)。

シームは Δco より広い RAAN ギャップになる(その両側の衛星は逆方向に運動するため)。したがって `wrapPlanes = false`: 最終面は +Grid トポロジ上で面 0 の隣接面として扱われない。

### 派生値

- Walker 表記、位相 F
- `coSpacingDeg`(実効 Δco)、`seamDeg`
- `inclinationPolar`(傾斜角が極 ± 10° 以内かどうか)

### バリデーション

| 条件 | 種別 | 内容 |
|---|---|---|
| `raan_spacing` が正でない | error | 「軌道面間隔は正の数が必要です」 |
| `(planes−1)·raan_spacing ≥ raan_range` | error | シームが残らない(シーム幅を提示) |
| 傾斜角が極 ± 10° の外 | warning | シーム構造が成立しない旨の警告(保存はブロックしない) |

---

## 4. Streets of Coverage

### 概要

Walker Star の一種だが、**面数・面間隔・面間位相はユーザーが打ち込むのではなく、被覆条件(仰角・被覆重複度・対象緯度・1 面あたりの衛星数)から寸法計算で導出される**。実装は Beech, Cornara, Bello Mora, Janin, *"A Study of Three Satellite Constellation Design Algorithms"*, 14th ISSFD, 1999 の式 (1), (5), (6), (7)。この寸法計算関数 `designStreetsOfCoverage`(`coverageGeometry.ts`)は、パターン生成器とミッション設計エンジンの Star 系候補の**両方から呼ばれる単一実装**であり、最適化が提案した候補と、それをシェルとして追加した結果は同一の構成になる。

### 通信ミッションでの用途

「最低仰角 ε 以上を常時確保する」という通信要件をそのまま入力にできる。Iridium がこの方式の代表例。

### 入力

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `apogee_altitude` | number | 0 | 高度 h [km](離心率は通常 0 として扱う) |
| `soc_min_elevation` | number | 10 | 最低仰角 ε [deg] |
| `soc_coverage_fold` | int | 1 | 被覆重複度 n |
| `soc_target_latitude` | number | 0 | 保証すべき最大緯度 λ_n(0 = 全球) |
| `soc_sats_per_plane` | int | 11 | 1 面あたりの衛星数 S |
| `inclination` | number | 90(既定) | 傾斜角 |

`planes` と `count` はこの入力から導出され、常に書き戻される(ユーザーが直接編集する値ではない)。

### 数式

地球中心角(式 1、正の仰角の場合の被覆円半径角):

```
θ = acos( Re/(Re+h) · cos ε ) − ε
```

面内ストリート半幅(式 5。S 機を等間隔配置した 1 面が掃く被覆帯の半幅):

```
cos c = cos θ / cos(m·π/S)     (m = 1 で c₁、m = n で c_n)
```

必要な RAAN スパン(式 6。P 面 + 1 本のシームで λ_n 以下を n 重に覆うために必要な角度):

```
span(P) = 2P · asin[ cos λ_n · cos((P − n)π/(2P)) ]
```

P 面で埋められる条件(式 7):

```
(P − 1)(θ + c_n)·safety + (c₁ + c_n) ≥ span(P)
```

これを満たす最小の P ≥ n を探索し、

```
Δseam = c₁ + c_n
Δco   = (span(P) − Δseam) / (P − 1)
ω     = asin(sin λ_n / cos θ) − asin[(sin λ_n / cos θ)·cos(nπ/S)] + π/S
```

**Iridium 参照値**(h = 780 km, ε = 8.2°, n = 1, λ = 0, S = 11): θ = 19.925°, c₁ = 11.527°, **P = 6, T = 66**, Δco = 31.389°, Δseam = 23.054°, ω = 16.364°(`tests/coverageGeometry.test.ts`)。

面間の平均近点角オフセットは通常のように探索されるのではなく、設計から解析的に導出される:

```
F = T · ω / 360
```

**実装上の逸脱(計画からの意図的な変更)**:
- `safety`(`spacingSafetyFactor`)の既定値は **1**(当初計画は 0.98)。理由は `streets_of_coverage.ts` がシェル保存時に常に safety = 1 で再計算するため、最適化エンジンが 0.98 でサイズした候補をこのパターンでシェル化すると *面数が変わってしまう*(Iridium 例: 0.98 なら P = 7/T = 77 になるところ、シェル化すると P = 6/T = 66 に戻る)。安全余裕はステージ 2 の数値検証が担う設計になっている(詳細は `docs/constellation-design.md`)。
- `soc_coverage_fold > 1`(n 重被覆)の寸法計算は**近似**であり、`fold_approximation` 警告が出る。面内 n 重のストリート半幅を用いるだけで、面間の重なりは考慮していない。実際の可用率は数値検証(§カバレッジカーネル)で確認する必要がある。
- 目標緯度が低い n ≥ 2 では式 (6) の必要 RAAN 範囲が 360° になり、面が全周に並ぶ(Walker Delta 相当の配置)。このとき `full_circle_layout` 警告が出て、ISL 用の `wrapPlanes` は true になる。
- `apogee_altitude` が 0 以下(未入力を含む)の場合、`designStreetsOfCoverage` は例外を投げず `feasible: false` + `infeasible_coverage` 警告を返し、生成器は格納された `planes`/`count` にフォールバックする。

### 派生値

`StreetsOfCoverageDesign`(`feasible`, `thetaDeg`, `c1Deg`, `cnDeg`, `planes`, `count`, `spanDeg`, `achievedSpanDeg`, `deltaCoDeg`, `deltaSeamDeg`, `omegaDeg` など)が UI の「成立バッジ」に表示される。

### バリデーション

| 条件 | 種別 |
|---|---|
| 高度 ≤ 0 | error |
| `soc_sats_per_plane` が 1 未満の整数でない | error |
| `soc_coverage_fold` が 1 未満の整数でない | error |
| `soc_min_elevation` が [0, 90) の外 | error |
| `soc_target_latitude` が [-90, 90] の外 | error |
| 寸法計算が不成立(`MAX_PLANES = 200` 以内に解なし) | warning(格納値へフォールバックして描画は継続) |
| n 重近似の警告 | warning |

### 例(Iridium)

```toml
[[constellation.shells]]
name = "Iridium 相当"
pattern = "streets_of_coverage"
count = 66
planes = 6
apogee_altitude = 780
eccentricity = 0
inclination = 86.4
raan_start = 0
raan_range = 180
argp = 0
mean_anomaly_0 = 0
soc_min_elevation = 8.2
soc_coverage_fold = 1
soc_target_latitude = 0
soc_sats_per_plane = 11
```

`count`/`planes` は保存時に導出値(66 / 6)へ上書きされる。`src/lib/constellationPresets.ts` の `iridium-next` プリセットそのもの。

---

## 5. Flower Constellation

### 概要

D. Mortari, M. P. Wilkins, C. Bruccoleri, *"The Flower Constellations"*, Journal of the Astronautical Sciences 52(1-2), 2004 のオリジナル定式化。全衛星が同一の反復地上軌跡(RGT)互換軌道(同じ a, e, i, ω)を共有し、(Ω, M) だけが衛星ごとに異なる。

### 通信ミッションでの用途

繰り返し地上軌跡が必要な観測連携・特定地域への周期的な高仰角パスを重視するミッション、あるいは楕円軌道(モルニヤ型)による高緯度滞留に向く。通信専用というより、RGT 拘束付きの特殊配置が要る場合の選択肢。

### 入力

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `count` | int | – | 配置衛星数 Ns |
| `flower_np` | int | – | Np(反復軌道回数) |
| `flower_nd` | int | – | Nd(反復日数) |
| `flower_fn` | int | 1 | Fn |
| `flower_fd` | int | `planes` の値 | Fd(= 面数そのもの) |
| `flower_fh` | int | 0 | Fh(0..Nd−1) |
| `eccentricity`, `inclination`, `argp` | number | 既存どおり | 軌道形状 |
| `apogee_altitude` | number | 0 | ソルバーの初期値 兼 不一致チェック用 |

### 数式

```
Ω_k = Ω₀ + 360°·k·Fn/Fd
M_k = M₀ − 360°·k·(Np·Fn + Fd·Fh)/(Fd·Nd)     (mod 360°),  k = 0..Ns−1
```

この式は位相不変量 `Np·Ω_k + Nd·M_k ≡ 一定 (mod 360°)` を保つ、つまり全衛星が同一の相対軌道を描く。

**半長軸は自由パラメータではない**。(i, e, Np, Nd) から反復地上軌跡条件(`docs/RGTorbit.md` 参照)を満たす a を `rgt.ts::solveAltitudeFromInclinationAndRatio` で解く。`apogee_altitude` はソルバーの初期推定値、および解けた値との不一致チェックにのみ使われる。ソルバーが失敗した場合は `solver_failed` 警告を出して格納値にフォールバックする(例外は投げない)。

配置上限:

```
Ns_max = Nd·Fd / gcd(Nd, Np·Fn + Fd·Fh)
```

を超えると衛星が同一 (Ω, M) スロットに重複配置される(`fc_duplicate_slots` 警告)。

**参照値**(`tests/constellationPatterns.test.ts`): (Np=15, Nd=1, i=45°, e=0) → a = 6866.79 km。(Np=14, i=86.4°) → a = 7244.286 km。

### 派生値

`np`, `nd`, `fn`, `fd`, `fh`, `ns`, `nsMax`, `solvedSemiMajorAxisKm`, `solvedApogeeAltitudeKm`, `apogeeAltitudeMismatchKm`, `harmonicNc`(コロケーション調和数 G)。

### バリデーション

| 条件 | 種別 |
|---|---|
| Np/Nd/Fn/Fd が 1 未満の整数 | error |
| gcd(Np, Nd) ≠ 1 または gcd(Fn, Fd) ≠ 1 | error |
| Fh が 0..Nd−1 の範囲外 | error |
| Ns > Ns_max | error(重複配置を明示) |
| ソルバー失敗・半長軸不一致 | warning |

---

## 6. Lattice Flower Constellation(2D-LFC)

### 概要

M. E. Avendaño, J. J. Davis, D. Mortari, *"The 2-D lattice theory of Flower Constellations"*, Celestial Mechanics and Dynamical Astronomy 116, 2013 の式 (2)。No 面 × Nso 面内スロットの格子で、格子条件 `0 ≤ Nc ≤ No−1` を持つ整数 Nc(lattice configuration number)で位相を決める。

### 通信ミッションでの用途

OneWeb のような均一格子コンステレーション。Walker Delta と等価だが、格子理論の語彙(No/Nso/Nc)で設計・比較したい場合に使う。

### 入力

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `planes` | int | 1 | No(面数) |
| `count` | int | 1 | T = No·Nso(Nso はここから逆算) |
| `lfc_nc` | int | 0 | Nc(0..No−1) |

### 数式

```
Ω_ij = 2π·i/No
M_ij = (2π/Nso)·(j − Nc·i/No)   (mod 2π),   i = 0..No−1, j = 0..Nso−1
```

**Walker 等価性と符号規約**: 格子式の `−Nc·i/No` 項は面番号 i が増えるほど平均近点角を*減少*させるが、Walker の F 項は*増加*させる(`M = (360/T)·(i·F + j·P)`)。そこで

```
F = (No − Nc) mod No
```

と置くと、両者は `360·i/Nso` だけ、つまり**面ごとに整数個の面内スロットぶん**だけ異なる。これは「同じ衛星集合を、面ごとに 1 スロットずつずらしてラベル付けし直しただけ」であることを意味する(Walker のスロット j == 格子のスロット j+i)。この事実により、この方式は独自ループを持たず `planWalkerDelta` へ**そのまま委譲**する(1 つの生成経路、1 組の浮動小数結果)。

**等価性の検証済みケース**(`tests/constellationPatterns.test.ts`): (No, Nso, Nc) = (4,5,1), (4,5,3), (8,6,2), (6,9,3) のいずれも、格子生成と Walker Delta 生成が要素単位で完全一致。

### 派生値

`no`, `nso`, `nc`, `ncAdmissible`, `deltaMDeg`(= −360·Nc/(No·Nso))、等価 Walker 表記 `walkerNotation` と `walkerF`。

### バリデーション

| 条件 | 種別 |
|---|---|
| Nc が 0..No−1 の整数でない | error(`nc_out_of_range`) |
| `count` が `planes` の倍数でない(T = No·Nso が成立しない) | error |

### 例(OneWeb 相当)

```toml
[[constellation.shells]]
name = "OneWeb 相当"
pattern = "lattice_flower"
count = 648
planes = 18
apogee_altitude = 1200
eccentricity = 0
inclination = 87.9
raan_start = 0
raan_range = 360
argp = 0
mean_anomaly_0 = 0
lfc_nc = 1
```

18 面 × 36 機の格子。Walker Delta 648/18/17 と等価(`src/lib/constellationPresets.ts` の `oneweb` プリセット)。

---

## 7. Necklace Flower Constellation(2D-NFC)

### 概要

M. E. Avendaño, J. J. Davis, D. Mortari の格子理論、および "Necklace theory on flower constellations"(Celestial Mechanics and Dynamical Astronomy, 2011–2014)。2D-LFC(No 面 × Nso スロット、格子数 Nc)のうち、**面内スロットの部分集合 G(「ネックレス」)だけを占有**する。G は面 0 で 1-based のパール(スロット)番号の集合として与えられ、後続の各面は同じネックレスをシフト k だけ回転させたものになる。

### 通信ミッションでの用途

OneWeb 型の均一格子コンステレーションを、機数を抑えつつ均等な間引きで実現したい場合(例: 全スロットの 1/3 だけ使う疎な格子)。

### 入力

| キー | 型 | 既定値 | 意味 |
|---|---|---|---|
| `planes` | int | 1 | No(面数) |
| `nec_pearls` | int | – | Nso(面内スロット総数。占有・非占有を含む) |
| `lfc_nc` | int | 0 | Nc(背後にある格子の配置数) |
| `nec_necklace` | int[] | – | 占有パール番号(1-based、1..Nso) |
| `nec_shift` | int | 1 | シフト k(面ごとにネックレスを回転させる量) |

`count` はこの入力から `No × |G|` として導出される。

### 数式

```
Ω_i     = raan_start + 360°·i/No
ΔM      = −360°·Nc/(No·Nso) + 360°·k/Nso
M_{i,g} = m0 + 360°·(g−1)/Nso + i·ΔM      (mod 360°),  g ∈ G
```

**許容条件**: シフト k は無条件に使えるわけではない。ネックレスが自己対称性を持つ最小回転を

```
Sym(G) = min{ 1 ≤ r ≤ Nso : G + r ≡ G (mod Nso) }
```

とすると、設計が許容されるのは

```
Sym(G) | (k·No − Nc)
```

のときだけ。これはラップアラウンド(面 No−1 → 面 0)を跨いでもネックレスの形状が矛盾なく一致するための条件で、満たさない場合は `necklace_not_admissible` 警告となり、許容される k の一覧が提示される。

`G = {1..Nso}`(全パール占有)のときはこの式が**そのまま 2D-LFC に一致**する(`tests/constellationPatterns.test.ts` の帰着テスト)。

パールはリング順(g の昇順)で生成される。平均近点角順に再ソートしないのは、+Grid ISL トポロジが「隣接インデックス = 沿軌道方向の隣接衛星」を前提にしており、シフトがネックレスを 0/360° の境界を跨いで回転させても物理的な隣接関係を保つ必要があるため。

**参照値**(`tests/constellationPatterns.test.ts`): (No=6, Nso=9, Nc=3, G={1,4,6}, k=2) → Sym(G) = 9、許容、count = 18。(G={1,4,7}) → Sym(G) = 3、Nc=3・k=1 は許容だが Nc=1・k=1 は非許容(3 が (1·6−1)=5 を割り切らない)。

### 派生値

`no`, `nso`, `nc`, `necklace`(占有パール一覧)、`occupied`、`shift`、`symmetry`、`admissible`、`admissibleShifts`、`deltaMDeg`、および背後の**完全格子**の Walker 表記。

### バリデーション

| 条件 | 種別 |
|---|---|
| `nec_pearls`(Nso)が 1 未満の整数でない | error |
| `lfc_nc` が 0..No−1 の整数でない | error |
| `nec_necklace` が空(占有パールなし) | error |
| `nec_shift` が 1 未満の整数でない | error |
| シフトが非許容 | error(該当フィールドに紐付け) |

### 例

```toml
[[constellation.shells]]
name = "Necklace サンプル"
pattern = "necklace_flower"
planes = 6
count = 18
apogee_altitude = 1200
inclination = 87.9
lfc_nc = 3
nec_pearls = 9
nec_necklace = [1, 4, 6]
nec_shift = 2
```

6 面 × 9 スロットの格子のうち 3 パール(1, 4, 6)だけを占有し、面ごとに k=2 スロットずつ回転させる。18 機。`PATTERN_DEFAULTS.necklace_flower` の既定値そのもの。

---

## 8. RGT — 方式横断の制約ヘルパー

RGT(Repeat Ground Track、反復地上軌跡)は独立した設計方式ではなく、**全方式に横断的に使える制約ヘルパー**として提供される(`src/lib/rgt.ts`、理論と手順の詳細は `docs/RGTorbit.md`)。

- `rgt_repeat_orbits` / `rgt_repeat_days` は全パターンで書き込み可能な**メモ用**フィールド(informational)で、生成される衛星要素そのものには影響しない。エディタの「RGT条件」ボタンが平均軌道要素を埋めるのに使う。
- Flower Constellation だけは RGT 条件がハードな設計制約になる: 半長軸がユーザー入力ではなく `solveAltitudeFromInclinationAndRatio(高度, 傾斜角, Np, Nd, e)` で解かれた値になる(§5)。
- ミッション設計エンジン(`docs/constellation-design.md`)でも RGT を有効にすると、自由な高度グリッドの代わりに、その傾斜角で実際に反復地上軌跡を閉じる離散高度だけが候補になる。

---

## 9. ISL の `planeSizes` / `wrapPlanes` 意味論

`src/lib/isl/candidates.ts::gridPatternIslCandidates` は「面内前後 2 機 + 隣接面同スロット 2 機」の構造的トポロジ(+Grid)を、探索なし O(N) で候補生成する。この生成器は各シェルの面レイアウトについて 2 つの追加情報を必要とする(`IslShellRange` / `ShellIndexRange`、`src/lib/isl/types.ts`, `src/lib/isl/candidates.ts`):

- **`planeSizes?: number[]`** — 各面の衛星数。省略時は `greedyPlaneSizes(count, planes)`(`ceil(count/planes)` を先頭の面から詰める既定レイアウト)が仮定される。Flower の不均等配置や Necklace の間引きのように、実際の面ごとの機数がこの既定と異なる場合にのみ明示される。`significantPlaneSizes()`(`registry.ts`)がこの判定を行い、既定と一致するときは `undefined` を返す — これは `scripts/generate-satellites.ts` が `Object.entries` でオブジェクトをシリアライズするため、常時キーを持たせると既存の `satellites.generated.ts` を無条件に書き換えてしまうのを避けるため。
- **`wrapPlanes?: boolean`** — `false` のとき、最終面から面 0 への「隣接面同スロット」リンクを張らない。Walker Star / Streets of Coverage のように面群がシームを挟んで逆回転する方式で使う(シームを跨ぐ幾何関係は速く変化するため、構造的リンクとしては扱わない)。省略時は `true` 相当(リングが閉じる)。面内リング(前後 2 機)は `wrapPlanes` の値に関係なく常に閉じる。

各パターンの `wrapPlanes` 値:

| パターン | `wrapPlanes` |
|---|---|
| walker_delta | true |
| walker_star | false |
| streets_of_coverage | false(不成立時のフォールバックも false)。ただし n ≥ 2 で必要 RAAN 範囲が 360° に達した場合は面が全周に並びシームが消えるため **true** になり、`full_circle_layout` 警告が付く |
| flower | true |
| lattice_flower | true |
| necklace_flower | true |

---

## 10. TOML キー一覧

`[[constellation.shells]]` はすべてフラットキー。`pattern` を省略すると `walker_delta`。

| キー | 型 | 既定値 | 対象パターン |
|---|---|---|---|
| `pattern` | string | walker_delta | 全 |
| `count`, `planes` | int | 1, 1 | 全(導出パターンでは導出値を必ず書く) |
| `phasing` | number | 0(star は P/2) | delta, star, soc |
| `apogee_altitude` | number | 0 | 全 |
| `eccentricity` | number | 0 | 全 |
| `inclination` | number | 0(star/soc は 90) | 全 |
| `raan_range` | number | 360(star/soc は 180) | 全 |
| `raan_start` | number | 0 | 全 |
| `argp` | number | 0 | 全 |
| `mean_anomaly_0` | number | 0 | 全 |
| `raan_spacing` | number | raan_range/planes(常に書き出し) | star, soc |
| `soc_min_elevation` | number | 10 | soc |
| `soc_coverage_fold` | int | 1 | soc |
| `soc_target_latitude` | number | 0 | soc |
| `soc_sats_per_plane` | int | 11 | soc |
| `flower_np` | int | – | flower |
| `flower_nd` | int | – | flower |
| `flower_fn` | int | 1 | flower |
| `flower_fd` | int | planes の値 | flower |
| `flower_fh` | int | 0 | flower |
| `lfc_nc` | int | 0 | lattice, necklace |
| `nec_pearls` | int | – | necklace |
| `nec_necklace` | int[] | – | necklace |
| `nec_shift` | int | 1 | necklace |
| `rgt_repeat_orbits`, `rgt_repeat_days` | int | – | 全(任意メモ) |
| `mission_objective`, `mission_min_elevation`, `mission_fold`, `mission_region`, `mission_lat_min`, `mission_lat_max`, `mission_alt_min`, `mission_alt_max` | string/number | – | 全(ミッション設計ウィザード由来、任意) |

`mission_*` はミッション設計ウィザード(`docs/constellation-design.md`)が候補をシェル化する際の由来情報で、生成される衛星要素には影響しない。

---

## 11. 参考文献

- G. Beech, S. Cornara, M. Bello Mora, G. Janin, "A Study of Three Satellite Constellation Design Algorithms", 14th International Symposium on Space Flight Dynamics (ISSFD), 1999.
- D. Mortari, M. P. Wilkins, C. Bruccoleri, "The Flower Constellations", Journal of the Astronautical Sciences 52(1-2), 2004.
- M. E. Avendaño, J. J. Davis, D. Mortari, "The 2-D lattice theory of Flower Constellations", Celestial Mechanics and Dynamical Astronomy 116, 2013.
- D. Casanova, M. Avendaño, D. Mortari, "Necklace Flower Constellations", 2011 / "Necklace Theory: A Space Debris Application", 2014.
- W. Rider, "Analytic Design of Satellite Constellations for Zonal Earth Coverage Using Inclined Circular Orbits", Journal of the Astronautical Sciences, 1985.
- J. R. Wertz (ed.), *Space Mission Analysis and Design (SMAD)*.
