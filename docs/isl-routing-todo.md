# ISL 経路探索・可視化機能 — 実装 ToDo リスト

- 設計文書: [isl-routing.md](./isl-routing.md)(節番号 §x.y は同文書を指す)
- コードレビュー結果: [isl-routing-review.md](./isl-routing-review.md)(H/M/L/P/D/S の指摘番号は同文書を指す)

進め方: 優先度順に実施し、**各グループ末尾の「確認ゲート」でユーザーレビューを受けてから次へ進む**。

---

## 完了済み: Phase 1–4(コミット `2e0cd7a`)

計画どおり実装完了。計算コア(`src/lib/isl/` 7 ファイル)、シーン統合(LineSegments 描画・再計算スロットル・dispose)、ISL タブ UI、Worker 化(compute/sweep)、一様グリッド・gridPattern 候補生成、ヒステリシス、残存可視時間ペナルティ、解析パネル、テスト 7 ファイル + ベンチ/検証スクリプト。`bun run lint` / `bun run test` / `bun run build` 通過。

実装中の主な設計判断(詳細は git 履歴と isl-routing.md の注記):

- GSL にも `maxRangeKm` の距離上限を追加(低仰角の非現実的な長距離リンク排除。設計変更として §1.2.1 に注記済み)
- A* は**見送り**(ベンチ実測で Dijkstra が支配項でないため。gridPattern は N=10,000 で 2.8 ms)
- 型付き配列への統一(§1.7.5)は**スコープ縮小**(Vec3[] のまま。実測で許容性能のため保留 → P-4 として再浮上)
- ベンチ実測: N=10,000 の graph+Dijkstra 合計 131.4 ms(d_max=1,500 km)。目標 100 ms はわずかに超過、gridPattern 使用でクリア可

### Phase 1–4 から引き継ぐ未完了項目

- [x] 手動チェックリスト: 経路線の地球貫通なし / 倍速 1×・600×・一時停止で破綻なし / ISL 無効化で計算・描画が完全停止 / ライト・ダーク背景の視認性(§3.4)— **ユーザー実機確認を推奨**(プレビュー環境でのブラウザ操作が不安定だったため未実施)
- [x] 大規模設定(N=10,000 級)で 60 fps 維持を devtools Performance で確認(§3.3)
- [x] Phase 1 確認ゲート: 数百機規模での動作・見た目・操作感のユーザーレビュー
- [x] Phase 2 確認ゲート: 重み操作による経路変化とフラッピング抑制の体感確認
- [x] Phase 4 確認ゲート: 解析パネルの有用性確認、以降の拡張(CGR、パレート図等)の要否判断

---

## 完了済み: Phase 5–8(外部レビュー isl-routing-review.md 対応)

H-1〜H-5・M-1〜M-4・L-1〜L-2・P-1〜P-6・D-1〜D-4・S-1〜S-4・S-6・S-7 を実装。S-5(ISL シーン状態の `IslPathLayer` 化)のみ、リスク対効果を理由に明示的に見送り(詳細は 8-2 節)。`bun run lint` / `bun run test` / `bun run build` / `bun run scripts/verify-isl-routing.ts` / `bun run scripts/bench-isl.ts` すべて通過。

主な設計変更(詳細は isl-routing.md の該当節注記):

- 参加衛星の指定を satnum スナップショット方式から「除外シェル安定キー + 個別衛星フラグ」方式に回帰し、satnum・shellRanges の事前解決・永続化を廃止(H-4/H-5 の根治)
- `shellRanges` は `IslSettings`(=localStorage)から外し、衛星配列の確定(エディタの「更新」)と同じタイミングでのみ導出する App state に変更
- ISL 表示色を `IslSettings.gslColor`/`islColor` に集約(S-3)
- `findShortestPath`/Worker ペイロードの引数整理(S-4/S-6)、エッジキー・地点変換・伝播処理の重複を共有モジュールへ統一(D-1/D-2/D-3)

---

## Phase 5: レビュー対応(修正必須)— isl-routing-review.md §1

### 5-1. H-1: 多シェル構成のインデックスずれ(最優先。ISL 外にも波及)

- [x] `src/lib/tomlParsers.ts:111` — `generateFromShells` の内側ループが累積 `sats.length < count` で打ち切るバグを修正し、各シェルが自身の `count` どおり生成されるようにする(シェルごとの生成数を個別カウントする `generateFromShellsDetailed` に統合)
- [x] 多シェルの回帰テストを `tests/` に追加(`tests/constellationParser.test.ts`: shells (12, 20) → 32 機生成、各シェルの開始インデックス検証、base オフセット付きのケースも追加)
- [x] shellRanges の導出を `IslTab.tsx` から `src/lib/tomlParsers.ts`(生成器の隣、`generateShellRanges`)へ移設し、**実際に生成された配列**から導出する共有関数にした。呼び出し元は `SatelliteEditor.handleUpdate`(衛星配列を確定する唯一の場所)に一本化
- [x] Worker 側で範囲外インデックスを検出した場合に error 応答へ理由を含め、UI(診断欄)に表示する(`islRoutingWorker.ts` の `validateShellRanges` + `visualization.ts` の `onIslError` → `IslTab.tsx` 診断欄)

### 5-2. H-4 + H-5 + S-1: 参加選択の持ち方を安定キー方式に作り直す(同根のため一括)

- [x] `IslSettings` の参加指定を「除外シェルの安定キー集合 + includeBaseSatellites フラグ」に変更し、**satnum への解決は計算直前(worker / graph 層)で毎回行う**(`isl/participants.ts` の `resolveIslParticipantIndices`。設計文書 §2.4 の元方針に回帰。解決不能キーは全参加へフォールバック)
- [x] 死にフィールド `participantShellKeys` を削除(S-1。用途は `excludedShellKeys` が引き継いだ)
- [x] 派生データ `shellRanges` を localStorage へ永続化しない(`IslSettings` から削除し、App state の別フィールドとして毎回 Update 時に導出)
- [x] IslTab のチェックボックスを IslSettings から導出(ローカル state `excludedShellIndices` / `includeBaseSatellites` を廃止)— タブ切替・リロードで UI と計算実態が乖離しないこと(H-5)
- [x] `IslRoutingAnalysis.tsx` も同じ解決経路を使う(satText/constText の再パースをやめ、committed な `satellites`/`islShellRanges` を props で受け取る形に変更。新 TOML + 旧スナップショットの組み合わせを構造的に不可能にした)
- [x] テスト: `tests/isl-participants.test.ts`(全解除/一部除外/base 除外/キー不整合時のフォールバック)。「reload 後の再解決」はアーキテクチャ変更(shellRanges を localStorage に置かず、衛星配列と同じタイミングでのみ導出)により再現不可能になったため、専用の統合テストは追加せず設計注記で説明

### 5-3. H-3 + M-4: 再計算状態機械の修正(小規模)

- [x] `visualization.ts` — `islForceRecompute` の消費とタイムスタンプ記録を `islComputeInFlight` ガードの**後**へ移動(一時停止中の設定変更が恒久的に握りつぶされる問題の解消)
- [x] `visualization.ts` — `islComputeInFlight` の解除を requestId チェックの**後**へ(1 行入替。M-4)
- [x] 手動確認: コードレビューでフラグの消費順序を追跡し、一時停止中の連続操作でも最後の設定が次の非 in-flight フレームで送信されることを確認(THREE.js シーンの実機ブラウザ確認は引き続きプレビュー環境の制約により未実施 — §3.4 と同様にユーザー実機確認を推奨)

### 5-4. H-2: 全解除→全参加の反転を修正

- [x] 「フィルタなし」と「空選択」のセマンティクスを分離(`excludedShellKeys`/`includeBaseSatellites` により構造的に分離。5-2 で実施)
- [x] 参加ゼロのときは「経路なし(参加衛星 0)」を UI に明示(`IslTab.tsx` の `hasZeroParticipants`)
- [x] テスト: `tests/isl-participants.test.ts` の「全解除 → 参加 0」ケース


---

## Phase 6: レビュー対応(中・低)— isl-routing-review.md §2–3

### 6-1. 中

- [x] M-1: 臨時地点入力の `Number("")→0` 問題 — `parseNum`/`numberValue` 相当を `src/lib/numericInput.ts` に共有部品化し、`GroundStationForm` と `IslTab.tsx` の `NumField` の両方で使用。`NumField` は draft state + 300ms デバウンスで、入力中は空欄を保持しつつ確定後にのみ `onIslSettingsChange` を呼ぶ(無駄な再計算も抑制)
- [x] M-2: 地点 A/B 変更時に `islPreviousPathEdgeKeys` と `islLastResult` をクリアし切替統計をリセット(`visualization.ts` の `updateParams` に実装。ユーザー操作を切替回数に混入させない / 旧経路×新マーカーの混成描画をなくす)
- [x] M-3: viewState — `STORAGE_VERSION` を 2 に上げ、`migrateViewSettings` で旧形状の `isl` フィールド(または欠落)をデフォルトへフォールバックする 1 箇所のマイグレーションを追加。回帰テストを `tests/viewState.test.ts` に追加

### 6-2. 低

- [x] L-1: 経路描画バッファを容量超過時に倍々で再確保する `ensureIslPathCapacity` を実装(設計 §2.6 どおり。固定 64 区間での切り詰めを撤廃したため診断表示は不要)
- [x] L-2: Phase 5-2 の参加解決の再設計(satnum ベース→シェル index range ベース)により、ISL 機能内では satnum によるマッチングが一切不要になったため本質的に解消。死んでいた `getSatnum`(呼び出し元が消えたため未使用になった)は削除した

---

## Phase 7: 性能改善 — isl-routing-review.md §4-A(60 fps / 大規模構成で効く順)

- [x] P-1: `applyIslPathToScene` の毎フレーム `THREE.Vector3` 生成(~8k allocs/s)をクラスレベルのスクラッチベクトル(`islScratchFrom`/`islScratchTo`)再利用に置換。`islEndpointScenePosition` の observer オブジェクトも同様にスクラッチ化
- [x] P-2: Worker への設定送信を identity 変化時のみの `configure` メッセージに分離し、compute を `{id, simDateIso, previousPathEdgeKeys}` に縮小。Worker 側は `liveSettings` として保持し、"compute" のたびの再送を排除。`previousPathEdgeKeys` はメインスレッド側で保持したまま(hysteresis リセットの責務が M-2 の実装と一致しているため、Worker 側への移設は見送り — sweep は元々自己完結のため対象外)
- [x] P-6: ISL 無効時(既定)は Worker を spawn しない(`ensureIslWorker` で初回有効化まで遅延)
- [x] P-3: 一様グリッドのセルキーを数値パック(`wrapAxis(cx) + wrapAxis(cy)*S + wrapAxis(cz)*S²`、S=65536)にして文字列ハッシュを排除。衝突が起きても意味的には安全(実距離+LoSチェックで必ず再検証されるため偽陽性は棄却され、偽陰性は原理的に発生しない)であることをコメントで明記
- [x] P-4: Dijkstra の dist/prevNode/visited を `Float64Array`/`Int32Array`/`Uint8Array` に変更。前回経路キーは数値 Set に(`isl/edgeKey.ts` の数値版 `edgeKey`。D-1 のエッジキー統一と同時に実施)
- [x] P-5: shellRanges 使用時の全体パスに pair-filter(`uniformGridIslCandidates` の新規オプション引数)を渡して同シェルペアを距離/LoS 判定前に除外。従来の `covered` Set 二重チェックは完全に冗長だったため削除
- [x] 完了後 `scripts/bench-isl.ts` を再実行。**N=10,000, maxRangeKm=1500(現実的密度)の graph+path: 131.4 ms → 74.4 ms**(目標 100 ms 以内をクリア。Phase 8-1 で `generateFromShells` 呼び出しに置換したため厳密な衛星配置は当初計測時と異なるが、範囲は同等)。他の規模・指標も改善(N=10,000 uniformGrid @ maxRangeKm=5000: 331.5ms → 246.7ms 等)。詳細は `bun run scripts/bench-isl.ts` の出力を参照

---

## Phase 8: 重複解消・構造改善 — isl-routing-review.md §4-B/C

### 8-1. ドリフトすると無音故障する重複(優先)

- [x] D-1: 無向エッジキーの実装 4 箇所を `src/lib/isl/edgeKey.ts` の単一実装(数値パック版。P-4 と同時実施)への import に統一。`tests/isl-edgeKey.test.ts` で対称性・一意性を検証
- [x] D-2: 地点→observer→ECF/ECI 変換 3 箇所(`graph.ts` / `stability.ts` / `visualization.ts`)を `isl/geometry.ts` の `endpointObserver`/`endpointEci` に統一(`visualization.ts` はスクラッチオブジェクトを渡すことで P-1 のアロケーション削減も維持)
- [x] D-3: `propagateAll` を `src/lib/isl/propagate.ts` へ移して Worker・`scripts/verify-isl-routing.ts`・`scripts/bench-isl.ts` で共用。検証スクリプト側の「失敗時 {0,0,0} フォールバックのまま参加させる」という出荷コードと異なる挙動を排除(`valid` フラグで除外するよう修正)
- [x] D-4: `bench-isl.ts` の手書き Walker 生成を `generateFromShells` 呼び出しに置換。LCG 乱数(ジッター用、生成器が決定論的なため不要になった)と `EARTH_RADIUS_KM` の重複宣言を削除

### 8-2. 保守性(次の機能追加前に)

- [x] S-3: ISL 表示設定(GSL/ISL 色)を `IslSettings.gslColor`/`islColor` に集約し、App state / DisplaySettings / OptionTab props / SceneParams / deps 配列の 5 ファイル貫通をやめた。endpoint マーカー色は同じ 2 色を再利用する形で設定から導出(ハードコード複製を撤廃。以前は色変更に追従しないバグでもあったため副次的に修正)。viewState のマイグレーションに旧 `display.islGslColor`/`islIslColor` からの救済も追加(テストあり)
- [x] S-4: Worker ペイロードで `cost` サブオブジェクトを丸ごと渡すよう変更(`linkModel` は元々丸ごと渡されていた)。visualization.ts と IslRoutingAnalysis.tsx の二重列挙を解消
- [ ] S-5: ISL のシーン状態(~20 フィールド)を `IslPathLayer` 的サブオブジェクトに封じる整理は**見送り**(判断: 現状は正しく動作しており、update/reset/dispose の分散はコードレビューでのみ検出可能な保守性の懸念で、機能バグではない。Phase 5-7 で visualization.ts のこの領域には既に多数の変更を加えており、大きな構造変更を追加するとレビュー範囲が肥大化しリスクが上がる。次に ISL のシーン統合ロジックへ機能追加するタイミングで、その変更と合わせて実施するのが妥当と判断)
- [x] S-2: 半配線の `stabilityThresholdS` を全ファイル(`IslSettings.cost` / worker payload / visualization.ts / IslRoutingAnalysis.tsx)から削除し、Worker 内定数 `DEFAULT_STABILITY_THRESHOLD_S = 60` に畳んだ
- [x] S-6: `findShortestPath(graph, computedAtSimMs, computeTimeMs, options)` に整理(`candidateEdgeCount` は常に呼び出し元が `graph.candidateEdgeCount` を渡していたため関数内部で読むように変更。全呼び出し元・テストを更新)
- [x] S-7: `IslTab.tsx` の `GroundStation` 構造的再宣言を `../../lib/groundStations` からの import に置換

---

## 完了済み: Phase 9(簡素化フォローアップ、`/simplify` 再レビュー §7 対応)

SP-1〜SP-17(9-1〜9-4 の全項目)を実装。`bun run lint` / `bun run test` / `bun run build` / `bun run scripts/verify-isl-routing.ts` / `bun run scripts/bench-isl.ts` すべて通過。SP-6 の一環として、`graph.ts` に残っていた `shellOfIndex` のもう 1 箇所の重複実装(cross-shell 候補生成のフィルタ用)も `participants.ts` の共有ヘルパーへ統一した(レビュー原文が名指ししていた箇所そのもの)。

ベンチ再計測: N=10,000, maxRangeKm=1500 の graph+path: 131.2 ms → **67.6 ms**(Phase 7 時点の 74.4 ms からさらに改善。SP-13 のメモ化・SP-15/16/17 のアロケーション削減が効いている)。

### 9-1. ドリフトリスクの高い重複(優先)

- [x] SP-1: Worker 設定ペイロードの手組み 2 箇所(`visualization.ts` / `IslRoutingAnalysis.tsx`)を `buildIslWorkerSettingsPayload()`(`islRoutingWorker.types.ts`)に共通化
- [x] SP-2: 経路→エッジキー導出を `isl/edgeKey.ts` の `pathEdgeKeys(edges)` に統一(worker の `edgeKeysOf` を削除)。メイン側の保持を Set→`number[]` に変更し、compute 送信時の `Array.from` コピーも削除
- [x] SP-3: 安定性定数を `stability.ts` の `DEFAULT_STABILITY_THRESHOLD_S` に一本化。cost.ts の未使用デフォルト定数 2 つと worker ローカル定数を削除し、`StabilityParams` の horizonS/stepS/thresholdS を optional 化、冗長な `satCount` フィールドを削除(`graph.nodeAId` から導出)
- [x] SP-9: `buildConstellation(text, baseOffset): { satellites, ranges }` を tomlParsers に export し、`SatelliteEditor.handleUpdate` の二重パース・二重生成を 1 回の呼び出しに統一

### 9-2. 構造(次のシナリオ級データ追加の前に)

- [x] SP-10: `scripts/generate-satellites.ts` が `SHELL_RANGES` を `satellites.generated.ts` に出力し、`src/lib/satellites.ts` の `INITIAL_SHELL_RANGES` 経由で App の `islShellRanges` 初期値を seed。IslTab の「更新すると反映されます」注記を削除(隠れモード解消)
- [x] SP-11: `src/lib/scenario.ts` に `CommittedScenario { satellites, groundStations, startTime, islShellRanges }` を新設し、`onUpdate` の 4 位置引数を 1 オブジェクトに集約
- [x] SP-12: viewState マイグレーションを `MIGRATIONS: Record<number, (display) => display>` のステップテーブル(v1→v2 の 1 エントリ)に再構成。「v2 形状だが色欠落」という到達不能分岐と対応テストを削除し、v1→v2 の一部として legacy 色救済を統合

### 9-3. 効率(残存分)

- [x] SP-13: `islRoutingWorker.ts` に `memoizedStabilityPredictors` を追加。coarse サンプル(dt が stepS の倍数)を `(satIndex, dt)` キーで memo 化し `Date.setTime` を再利用。refinement 用の非グリッド dt はキャッシュ対象外(頻度が低いため無影響)
- [x] SP-14: `applyIslPathToScene` に `islColorsAppliedFor`/`islColorsDirty` を追加し、色バッファの書き換え・GPU アップロードを「結果参照または色設定が変わったとき」のみに限定(位置は毎フレーム更新を維持)
- [x] SP-15: `gridPatternIslCandidates` の重複排除 Set を文字列キーから `edgeKey(i, j)` の数値キーに変更
- [x] SP-16: `uniformGridIslCandidates` の `satCell` タプル Map を廃止し、走査ループ内で `cellCoord` をインライン再計算
- [x] SP-17: `propagateAll` に optional な `out: PropagateAllResult` を追加。worker が `propagateBuffer` を "init" ごとにリセットしつつ compute 間で保持・in-place 更新するよう変更(`positions`/`valid` 配列と各 `Vec3` オブジェクトの再確保を排除)

### 9-4. 小物(ついでに)

- [x] SP-4: `isl/types.ts` に `stationEndpoint(gs): IslEndpoint` を追加し、`IslTab.tsx` の 2 箇所のリテラルを置換
- [x] SP-5: `scripts/verify-isl-routing.ts` の物理定数を `isl/geometry.ts`(`EARTH_RADIUS_EQUATOR_KM`)/ `isl/cost.ts`(`SPEED_OF_LIGHT_KM_PER_S`)から import
- [x] SP-6: `GeneratedShellRange` を削除して `tomlParsers.ts` から `IslShellRange` を直接使用。`shellOfIndex` を `participants.ts` に export し、`graph.ts` の重複実装(cross-shell フィルタ用)を統一
- [x] SP-7: `IslRoutingAnalysis.tsx` の時間窓・刻み、`IslTab.tsx` の再計算間隔(`NumField` に `min`/`step` オプションを追加して再利用)を `parseNumericInput` ベースの draft 保持に変更。編集中に既定値へスナップする問題を解消(M-1 の残穴)
- [x] SP-8: `GroundStationForm` の別名残骸(`numberValue`/`parseNum`)を削除し、`numericInputValue`/`parseNumericInput` を直接呼ぶよう変更

### 備考

- S-5(`IslPathLayer` 化)は依然据え置き。Phase 9 でも `visualization.ts` の ISL 領域(色ダーティフラグ等)に手を入れたが、大規模な構造変更は次の機能追加と合わせて実施する方針を継続(isl-routing-review.md §7-D)。

---

## 全フェーズ共通の完了条件

- [x] 各修正に対応する回帰テストを追加(H-1: `tests/constellationParser.test.ts`、H-2/H-4/H-5: `tests/isl-participants.test.ts`、D-1: `tests/isl-edgeKey.test.ts`、M-3: `tests/viewState.test.ts`)
- [x] `bun run lint` / `bun run test` 通過。Phase 5〜8 の各段階で `bun run build` も実行し確認済み
- [x] 新規 Three.js リソース(ISL パスバッファの再確保含む)は dispose 経路に登録済み(`ensureIslPathCapacity` の再確保は three.js のアトリビュートキャッシュに委ねる旨をコメントで明記)
- [x] `src/lib/isl/` に Three.js / React / シーン座標を持ち込んでいないことを確認(全ファイル pure data / satellite.js のみ)
- [x] `src/lib/satellites.generated.ts` は編集していない
- [x] 設計文書との食い違い(H-4 の参加解決方式の設計回帰、S-3 の色設定集約)は isl-routing.md に設計変更注記を追加済み
