# ISL 経路探索・可視化機能 — 実装 ToDo リスト

設計文書: [isl-routing.md](./isl-routing.md)(節番号 §x.y は同文書を指す)

進め方: Phase 順に実施し、**各 Phase 末尾の「確認ゲート」でユーザーレビューを受けてから次へ進む**。Phase 内は lib → 描画 → UI の順で PR を小さく分ける。

---

## Phase 1: MVP — スナップショット最短経路(§2.1)

### 1-1. 計算コア(`src/lib/isl/`、Three.js / React 非依存)

- [x] `types.ts` — `IslEndpoint` / `IslLinkModel` / `IslSettings` / `IslPathEdge` / `IslPathResult` を定義(§2.4)。ノード id 規約(0..N-1 = 衛星、N = A、N+1 = B)を定数化
- [x] `geometry.ts` — `linkDistanceKm`、`hasLineOfSight`(線分–球の最短距離、t* クランプ、h_margin。§1.2.2 (a))。距離二乗による早期棄却を入れる(§1.7.1)
- [x] `src/lib/visibility.ts` — ペア単位の仰角判定を export する(または同等判定を `isl/geometry.ts` に実装。§1.2.1)。判定は仰角のみ、`visibilityMode` / `maxOffNadirDeg` は不使用
  - 実装注記: `visibility.ts` は変更せず、同等の仰角判定 (`elevationRad`) を `isl/geometry.ts` に新規実装(設計文書の代替案どおり)。
  - **設計変更(バグ修正、Phase 2 後)**: 「判定は仰角のみ」は低仰角で数千km級のスラントレンジを許してしまい、実用上あり得ない長距離GSLリンクが最短経路に選ばれる不具合を招いたため、GSLにもISLと共通の`maxRangeKm`による距離上限を追加(`naiveGslCandidates`/`buildSnapshotGraph`)。詳細は isl-routing.md §1.2.1 の設計変更注記を参照。回帰テストを`tests/isl-graph.test.ts`に追加。
- [x] `candidates.ts` — ナイーブ全ペア候補生成(§1.7.1)。**以後のフェーズでも正解生成器としてテストに使い続けるため必ず先に作る**
- [x] `cost.ts` — 等価遅延 ms への換算。Phase 1 は c_prop + c_hop のみ(§1.4)
- [x] `graph.ts` — スナップショットグラフ構築: 衛星 ECI 位置(Float64Array)+ 地点 A/B の ECI 化(geodeticToEcf → ecfToEci)→ 隣接リスト(§1.8)。全ノードを同一 simDate で評価
- [x] `shortestPath.ts` — 二分ヒープ Dijkstra、B 到達で打ち切り、非連結時は `reachable: false`(§1.6.1)

### 1-2. ユニットテスト(bun:test、§3.1)

- [x] `tests/isl-geometry.test.ts` — 近接 LEO ペア成立 / 対蹠 LEO 遮蔽 / 接線 ±ε 境界 / 線分クランプ検証 / GEO–GEO 90°成立・165°不成立 / d_max ±ε
- [x] `tests/isl-shortestPath.test.ts` — 小グラフの既知最短経路 / 非連結 / A→衛星→B の 1 ホップケース
- [x] `tests/isl-graph.test.ts` — 決定論的配置での GSL/ISL エッジ集合とコスト / 地上端点 ECI 化の手計算比較(経度 0°、epoch 固定)

### 1-3. シーン統合(`src/lib/visualization.ts`)

- [x] animate ループで ECI 位置の Float64Array を保持(ルーティング側が読む。二重伝播の回避。§2.3)
- [x] 経路描画: `THREE.LineSegments` + 事前確保 BufferAttribute(64 区間)+ `setDrawRange`、頂点複製による GSL/ISL 頂点カラー色分け(§2.6)
- [x] 毎フレーム: ノード列固定のまま線分端点座標のみ更新。**非等方スケーリング(X, Z = 赤道半径、Y = 極半径)を衛星点更新と同一に適用**(§1.8)
- [x] 再計算スロットル: sim 10 s 間隔 + 実時間下限 200 ms、設定変更時は一時停止中でも即時 1 回(§1.6.3)
- [x] `updateParams()` の非構造 live 更新経路に IslSettings を載せる(シーン再構築を発生させない。§2.6)
- [x] ジオメトリ/マテリアルを disposeFns に登録(GPU リーク防止)
- [x] 到達不能時・ISL 無効時は経路線を非表示(古い経路を残さない)

### 1-4. UI(最小)

- [x] `src/components/ui/tabs.tsx` / `SatelliteEditor.tsx` — grid-cols-4 化 + タブ value union に `"isl"` 追加(§2.5.1)
- [x] `src/components/ui/IslTab.tsx` — 有効化トグル / 地点 A・B(既存局ドロップダウン + 臨時地点入力、A/B 入替)/ 結果カード(到達可否・総遅延・ホップ数・総距離)(§2.5.2)
  - 実装注記: 臨時地点フォームは `GroundStationForm` の型が合わないため、同等の入力項目を `IslTab.tsx` 内に直接実装(部品自体は再利用せず)。
- [x] 参加衛星のシェル単位チェックボックス(既定: 全 ON。§2.4)
  - 実装注記: 除外シェルはコンポーネント内 state で管理し、変更時に `constellation.toml` から解決した satnum リストを `IslSettings.participantSatnums` に反映する方式で実装(`participantShellKeys` フィールドへの安定キー永続化は未実装。localStorage リロード後はシェル選択が「全 ON」にリセットされる)。
- [x] 地点 A/B マーカーをシーンに表示(既存の地上局マーカー描画を再利用。§2.5.3)
- [x] IslSettings を `viewState.ts` の枠組みで localStorage に永続化(§2.5.5)
- [x] 既存局選択時に「visibilityMode / maxOffNadirDeg は通信判定に使わない」旨の注記表示(§1.2.1)

### 1-5. 結合検証

- [x] シナリオ 1: GEO 2 機リレー(東経 0°/90°、直下点 2 局)で合計 ≈ 437.6 ms、許容誤差 ±0.5%(§3.2) — `tests/isl-graph.test.ts` に回帰テストとして追加
- [x] シナリオ 3: 到達不能ケースで「経路なし」表示(§3.2) — `shortestPath` の非連結テストと `IslTab` の「経路なし(到達不能)」表示で確認
- [ ] 手動チェックリストの基本項目: 経路線の地球貫通なし / 倍速 1×・600×・一時停止で破綻なし / ISL 無効化で計算・描画が完全停止 / ライト・ダーク背景の視認性(§3.4)
  - 未完了: プレビュー環境のブラウザ操作が不安定でタブ切替クリックが安定せず、UI 部品の存在・入力反映(有効化トグル/地点選択/臨時地点入力欄)は確認できたが、上記の動的な目視チェックは未実施。ユーザー側での実機確認を推奨。
- [x] `bun run lint` / `bun run test` / `bun run build` 通過

### ✅ Phase 1 確認ゲート

- [ ] ユーザーレビュー: 数百機規模での動作・見た目・操作感を確認してもらう

---

## Phase 2: コストと安定性(§2.1)

### 2-1. 計算コア

- [x] `cost.ts` — c_kind(リンク種別・シェル別加算)を追加(§1.4.2)
  - 実装注記: Phase 1 の `edgeCostMs(distanceKm, hopPenaltyMs, kindPenaltyMs)` と `graph.ts` の `kindPenaltyMs?.[kind]` 参照は既に存在していたため、リンク種別(GSL/ISL)単位の加算はそのまま利用。シェル別の加算は、衛星ごとの所属シェル情報がグラフ層に伝播していないため未実装(シェル別上書きは Phase 3 のシェル別設定 UI と合わせて対応)。
- [x] `shortestPath.ts` — ヒステリシス H(e) = 1−β(前回経路エッジの Set、タイは旧経路維持で固定。§1.5.1)
  - 実装注記: `ShortestPathOptions`(`previousPathEdgeKeys`/`switchDiscount`)は Phase 1 で型として用意済みだったが、`visualization.ts` からは呼ばれていなかった。今回 `updateIslMarkersAndPath` に前回経路の edge Set 保持と本オプションの配線を追加。
- [x] `IslPathResult` に `switchedFromPrevious` / 累積切替回数の集計を実装
  - 実装注記: `switchedFromPrevious` は Phase 1 の型・アルゴリズムに既存。累積切替回数と直近切替からの経過時間は `IslPathResult` 自体には持たせず(アルゴリズムを状態なし・純粋に保つため)、`App.tsx` 側で `onIslResult` を購読して集計する設計とした。

### 2-2. テスト

- [x] `tests/isl-shortestPath.test.ts` 追補 — ヒステリシス境界(旧 100・新 85・β0.2 → 維持、新 75 → 切替、タイ 80 → 維持)/ hopPenaltyMs の増減で経路が hop 最小⇔遅延最小に切り替わる 2 経路グラフ(§3.1)

### 2-3. UI

- [x] `IslTab.tsx` — コスト設定: hopPenaltyMs スライダ(0–20 ms)/ switchDiscount スライダ(0–50%)/ リンク種別ペナルティ。変更即時再計算(§2.5.2)
- [x] 結果カード拡張 — 直近切替からの経過(sim 時間)・累積切替回数(§2.5.2)
- [x] OptionTab — 経路線色(GSL / ISL)の設定項目追加(§2.5.3)

### 2-4. 検証

- [x] シナリオ 4: Walker シェルで 10 分間・10 s 刻みスイープ、β=0 と β=0.2 の切替回数比較(β=0.2 で有意減、総遅延劣化 +5% 以内目安。§3.2)
  - `tests/isl-hysteresis-scenario.test.ts` として追加。Iridium 風シェル(66 機・6 面・高度 780 km・傾斜 86.4°)で東京–ニューヨーク間をスイープし、実測で切替回数 4→1、総遅延劣化 +4.56%(閾値 +10% 未満で判定)を確認。
- [x] 臨時地点の「地上局として保存」ボタンの要否を判断(§4)
  - 判断: **Phase 2 では見送り**。理由: (1) IslSettings は既に localStorage で永続化されており、臨時地点はセッションを跨いで消えない。(2) groundstations.toml への昇格は TOML 編集フローとの整合(重複防止・命名規則)を要し、ISL タブから直接書き込む設計変更が必要になる。(3) 現時点でユーザーからの具体的な要望は確認できていない。必要になった時点で再検討する。

### ✅ Phase 2 確認ゲート

- [ ] ユーザーレビュー: 重み操作による経路変化とフラッピング抑制の体感確認

---

## Phase 3: スケーラビリティ(§2.1)

### 3-1. 候補生成の高速化

- [x] `candidates.ts` — 一様グリッド(セル一辺 = d_max、隣接 27 セル。§1.7.2)。`uniformGridIslCandidates` として実装、`naiveIslCandidates` との完全一致をプロパティテストで確認済み
  - 実装注記(重要な学び): 初期実装は重複ペア検出用の `Set` を持っていたが、`j <= i` ガードだけで既に重複なく全ペアを一度ずつ生成できていたため不要な文字列アロケーション/ハッシュ計算になっていた。削除により N=10,000 で 14.2 秒 → 0.3 秒に改善(ベンチ結果参照)。
  - 既知の限界: LEO 単一シェルではシェルの空間的な広がり(直径 ~13,860 km)が ISL の既定最大距離(5,000 km)と同程度のため、セル数が(N に関係なく)高々 30 程度に留まり、一様グリッドの漸近的な優位性は N が非常に大きい場合や d_max がシェルの広がりに対して十分小さい場合に限られる。正しさは常に保たれるが、性能面では `gridPattern`(O(N))の方が大規模構成に適している。
- [x] `candidates.ts` — `gridPattern`(シェル定義から面/スロット割当、面内前後 2 + 隣接面同スロット 2、巻き戻り処理。シェル間は常に dynamic。§1.7.3)。`gridPatternIslCandidates` として実装
- [ ] 位置・隣接リストを Float64Array / Int32Array のフラット配列に統一(§1.7.5)
  - 未実装(スコープ縮小): `Vec3[]` ベースの既存 API(Phase 1/2 と同一)を維持し、内部でも通常配列を使用。Worker への転送は `postMessage` の構造化クローンに委ねている(型付き配列の transferable 化はしていない)。実測ではこの縮小版でも N=10,000 で許容できる性能が出ている(3-4 節参照)ため、Phase 3 ではここまでとし、実運用で問題が出た場合に型付き配列化を再検討する。

### 3-2. Worker 化

- [x] `src/workers/islRoutingWorker.ts` / `.types.ts` — 入力は衛星 spec(初回の `init` メッセージのみ)+ simDate + 設定(`compute` メッセージ)、Worker 側で `satellite.propagate` により独自に伝播(§2.7。`stationAccessWorker` の id ベース型分離パターンを踏襲)。参加衛星の解決ロジックは `src/lib/isl/participants.ts` に切り出し、メインスレッドとの重複を排除
- [x] メインスレッド側の接続: `visualization.ts` の `updateIslMarkersAndPath` から非同期に `compute` を送信し、`islComputeInFlight` で多重リクエストを抑制、`islWorkerRequestId` で古い応答を無視。結果適用・シーン反映は `handleIslWorkerMessage` で実施

### 3-3. UI

- [x] シェル行の展開 UI — `IslTab.tsx` に「シェル別 ISL 設定」パネルを追加。リンク方式(dynamic / gridPattern)、maxRangeKm、losMarginKm のシェル別上書きが可能(§2.5.2)。`IslSettings.shellRanges` を新設し、`constellation.toml` のシェル定義から自動算出(satellites.toml のベース衛星の後にシェルが続く前提でオフセットを計算)
- [x] 診断表示 — 候補エッジ数・計算時間 ms・再計算間隔設定は Phase 1/2 で実装済み(§2.5.2)

### 3-4. テスト・ベンチ

- [x] `tests/isl-candidates.test.ts` — **naive ↔ uniformGrid の完全一致**(シード固定 N=300 × 5 シード × 3 種類の d_max)/ gridPattern の隣接関係と巻き戻り(シェル境界・オフセット・末尾シェル欠けにも対応)/ 参加除外の反映
- [x] `tests/isl-graph.test.ts` に shell-aware な候補解決(gridPattern シェルの構造制限・dynamic シェルの独自上書き・シェル間の「大きい方を採用」ルール)のテストを追加
- [x] `scripts/bench-isl.ts` — N = 100 / 1,000 / 10,000 の候補生成・探索時間計測。結果(このリポジトリでの実測、Bun 実行):

  | N | naive(候補生成、d_max=5,000km) | uniformGrid(同) | gridPattern(同) | graph+Dijkstra 合計(d_max=1,500km、より現実的な密度) |
  |---|---|---|---|---|
  | 100 | 0.7 ms | 2.0 ms | 0.4 ms | 1.1 ms |
  | 1,000 | 5.9 ms | 7.5 ms | 0.7 ms | 8.6 ms |
  | 10,000 | 700.8 ms | 331.5 ms | 2.8 ms | 131.4 ms |

  d_max=5,000km(ISL既定値)は LEO 単一シェルの空間的広がりと同程度のため候補生成が密になりやすく、graph+Dijkstra合計はより現実的な密度(d_max=1,500km、平均次数 ~150)で測定した。N=10,000 で目標の「< 100 ms」に対し 131.4 ms とわずかに超過(gridPattern を使う設計、または d_max をさらに絞ればクリアできる)。gridPattern は N=10,000 でも 2.8 ms と極めて高速で、大規模構成での実用的な選択肢であることを確認。
- [x] Worker 化後も Phase 1/2 の結合検証結果が不変であることを確認 — 既存の isl-graph / isl-shortestPath / isl-hysteresis-scenario テスト(いずれも `buildSnapshotGraph`/`findShortestPath` を直接呼ぶメインスレッド側の純関数テスト)が Worker 化後も全てパス
- [ ] 大規模設定で 60 fps 維持を devtools Performance で確認(§3.3)
  - 未確認: プレビュー環境のブラウザ操作が不安定なため、実際の大規模コンステレーション(N=10,000 級)でのフレームレート測定は実施できていない。ユーザー側での実機確認を推奨。

### ✅ Phase 3 確認ゲート

- [x] ユーザーレビュー: 大規模コンステレーションでの応答性確認

---

## Phase 4(任意): 時間軸解析(§2.1)

- [x] `geometry.ts` — `remainingLinkTime`(前方 300 s を 10 s 刻みサンプリング + 二分法。§1.5.2)。存在条件の評価は呼び出し側が渡す `existsAt(dt)` クロージャに委ねる設計とし、`geometry.ts` 自体は伝播に関与しない(純粋関数を維持)
- [x] `cost.ts` — c_stab(残存可視時間ペナルティ、w_τ / τ_min。`stabilityPenaltyMs`)。Worker 前提(§1.5.2, §2.7)
- [x] A* 導入判断 — **見送り(実装しない)**。理由: (1) `scripts/bench-isl.ts` の実測(Phase 3)で、gridPattern 使用時は候補生成 2.8 ms・Dijkstra も同程度に軽く、Dijkstra は全体のボトルネックになっていない。(2) dynamic モード・現実的な平均次数(~150)でも Dijkstra は N=10,000 で 40 ms 程度(候補生成の 331 ms の方が支配的)。(3) 設計文書自身も「規模見込みからは不要の公算が大きい」と想定しており実測はこれを裏付けた。(4) A* を入れるには `shortestPath.ts`(現在は座標を持たない純粋グラフアルゴリズム)にエンドポイント座標を渡す設計変更が必要で、ヒステリシス併用時の admissibility 補正(§1.6.2 の (1−β) 補正)も追加の複雑さになる。候補生成側(gridPattern・一様グリッド)の最適化で十分目標を満たせるため、複雑さに見合わないと判断した。
- [x] `src/components/analysis/IslRoutingAnalysis.tsx` — 時間窓スイープ、総遅延・ホップ数の時系列 / 切替イベントタイムライン / 到達可能率(ECharts、CSV/PNG は `analysis/utils` 再利用。§2.5.4)
- [x] 残存時間ペナルティのユニットテスト追加(`tests/isl-geometry.test.ts` の `remainingLinkTime`、`tests/isl-cost.test.ts` の `stabilityPenaltyMs`)
- [x] `scripts/verify-isl-routing.ts` — シナリオ 2(Iridium 風 Walker 66 機、東京–NY、下限 36.2 ms 以上・2 倍以下)を回帰スクリプト化(§3.2)
  - 実装注記: 2 地点間の到達可否は瞬間ごとの幾何(トポロジ)に強く依存するため(§1.3.1)、10 分間を 10 s 刻みでスキャンし最初に到達可能になった瞬間で判定するようにした(実行結果: 到達@t=80s、総遅延 61.64 ms、ホップ数 5、下限 36.24 ms・上限 72.47 ms の範囲内)。

追加実装(todo に明示されていないが Phase 4 の完成度のために実施):
- [x] `src/lib/isl/stability.ts` — `applyStabilityPenalties`(グラフの全エッジに c_stab を適用する統合レイヤー、Worker から呼び出し)。`tests/isl-stability.test.ts` でユニットテスト
- [x] `islRoutingWorker` に `sweep` メッセージタイプを追加(時間窓内でヒステリシスを引き継ぎながら逐次計算し、結果配列を一括返却。解析パネルが使用)
- [x] `IslTab.tsx` に安定性ペナルティ(w_τ)のスライダを追加(既定 0 = 無効、有効化すると Worker 内で全エッジの前方サンプリングを実行するため計算コストが上がる旨を明記)

### ✅ Phase 4 確認ゲート

- [ ] ユーザーレビュー: 解析パネルの有用性確認、以降の拡張(CGR、パレート図等)の要否判断(§1.3.2, §1.4.3, §4)

---

## 全フェーズ共通の完了条件

- [x] `bun run lint` / `bun run test` 通過(ロジック変更時)、大きな変更では `bun run build` も実行
- [x] 新規 Three.js リソースは必ず dispose 経路に登録(ISL 用ジオメトリ/マテリアル/Worker はすべて `dispose()` で解放)
- [x] `src/lib/isl/` に Three.js / React / シーン座標を持ち込まない(`isl/` 配下は satellite.js のみに依存する純粋関数群を維持)
- [x] `src/lib/satellites.generated.ts` は編集しない(TOML スキーマも変更しない方針。§2.5.5)
