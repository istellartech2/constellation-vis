# ISL 経路探索機能 コードレビュー結果

- 対象: コミット `2e0cd7a`「ISL経路探索・可視化機能を追加(Phase 1-4)」(32 ファイル、+4,918 行)
- 方法: 8 観点(逐行スキャン / 削除挙動 / ファイル横断トレース / 再利用 / 簡素化 / 効率 / 実装深度 / 規約)の独立レビューで 43 候補を抽出 → 重複排除 → 個別に検証(コード読解 + 一部は bun スクリプトでの実行検証)。検証で棄却された候補は除外済み。
- 行番号は本コミット時点(HEAD)のもの。

## 結論サマリ

- **修正必須(高)が 5 件**。うち 1 件は既存 `generateFromShells` の潜在バグ(多シェル構成で衛星数が仕様どおり生成されない)が ISL で Worker クラッシュとして顕在化するもので、**ISL 以外にも影響する**。
- 中 4 件、低 2 件。ほかに性能・重複・構造の改善推奨をまとめた(§4)。
- 単位・座標変換・時刻・Three.js リソース破棄・テスト規約(bun:test)・配布性は問題なしを確認(§6)。

---

## 1. 重大度: 高(修正必須)

### H-1. 多シェル構成で shellRanges のインデックス範囲が実際の衛星配列とずれ、gridPattern 選択時に Worker がクラッシュする

- 該当: `src/components/ui/IslTab.tsx:100`(shellRanges 計算)、根本原因は `src/lib/tomlParsers.ts:111`(既存コード)
- 内容: `IslTab` は「各シェルが `shell.count` 機ちょうど生成される」前提で `startIndex` を累積計算する。しかし `generateFromShells` の内側ループは**累積の** `sats.length < count` で打ち切るため、2 番目以降のシェルは切り詰められる。**実行検証済み**: shells (count=12, count=20) → 生成は合計 20 機(2 番目のシェルは 8 機のみ)。shells (6, 8) → 合計 8 機。
- 影響:
  - gridPattern モードを 2 番目以降のシェルに設定すると、`gridPatternIslCandidates` が `satEciPositions` の範囲外を読み `TypeError` → Worker が毎回 error 応答 → **ISL 機能が恒久停止**(console.error のみでユーザーへの通知なし)。
  - dynamic モードでもシェル別上書き(maxRangeKm 等)と参加選択が誤ったインデックス範囲に適用される。
  - **注意: `generateFromShells` の切り詰め自体は ISL 以前からの既存バグ**であり、多シェル constellation.toml では画面に表示される衛星数自体が定義より少ない。ISL とは独立に修正すべき。
- 修正案: (1) `tomlParsers.ts` の内側ループをシェルごとの生成数でカウントするよう修正。(2) shellRanges の計算を UI から `src/lib`(生成器の隣)へ移し、**実際に生成された配列**から導出する共有関数にする(H-4 の恒久対策と同じ方向)。

### H-2. 参加衛星を全解除すると「全衛星参加」に反転する

- 該当: `src/components/ui/IslTab.tsx:141-159`、`src/lib/isl/participants.ts:9-11`
- 内容: 全シェル除外 + ベース衛星除外で `participantSatnums: []` が書き込まれるが、`resolveIslParticipantIndices` は空配列を「フィルタなし = 全衛星参加」と解釈する。ユーザー意図の正反対の動作。UI に全解除を防ぐガードもない。
- 修正案: 「フィルタなし」と「空選択」を区別する(例: `participantSatnums: null` = 全参加、`[]` = 参加なし)。または UI 側で全解除時に警告して最後の 1 つを解除不可にする。前者を推奨(セマンティクスが型で明確になる)。

### H-3. 計算中に届いた設定変更が握りつぶされ、一時停止中は新設定が恒久的に反映されない

- 該当: `src/lib/visualization.ts:971-981`(`updateIslMarkersAndPath`)
- 内容: `islForceRecompute` の消費(971 行)と `islLastRecomputeSimMs/RealMs` の記録(972-973 行)が `if (this.islComputeInFlight) return;`(981 行)の**前**にあり、ガードで return しても再アーム(flag の復元)がない。設定変更で `islWorkerRequestId` はバンプされないため、in-flight の旧設定の結果はそのまま適用される。
- 影響: 一時停止中(sim 時刻凍結)にコストスライダ等を操作すると、先行 compute が in-flight の場合に変更が消失し、`dueBySim` が二度と真にならないため**再開まで旧設定の経路が表示され続ける**。再生中でも最大 `recomputeIntervalSimS`(既定 10 sim 秒)の遅延。UI の「即時反映」の約束(§2.5.2)に反する。
- 修正案: flag の消費とタイムスタンプ記録を in-flight ガードの**後**へ移動する(最小修正)。または in-flight 中の force を保留フラグとして持ち、応答受信時に即座に次の compute を発行する。

### H-4. constellation.toml の再適用・ページリロード後に participantSatnums / shellRanges が陳腐化し、黙って誤った衛星集合で経路計算する

- 該当: `src/components/ui/IslTab.tsx:100-119, 135-159`(唯一の生成箇所)、消費側 `src/lib/visualization.ts:990,994`、`src/components/analysis/IslRoutingAnalysis.tsx:46-48, 90,94`
- 内容: `participantSatnums`(解決済み satnum のスナップショット)と `shellRanges` は IslTab マウント中にしか更新されないが、localStorage(viewState)に永続化される。生成 satnum は毎パースで 1 から振り直されるため(`tomlParsers.ts:91`)、エディタで constellation.toml を編集して「更新」した後やリロード後は、**新しい衛星配列に対して古いスナップショットがそのまま適用される**。ISL タブを開かない限り修復されない。解析パネル(`IslRoutingAnalysis`)は新 TOML で衛星を作りつつ旧設定と組み合わせるため、同じ不整合に別経路で到達する。
- 影響: 経路・スイープ結果がもっともらしく表示されるが、参加集合・シェル別設定が実際とずれている(エラーなし)。シェル範囲が新配列の範囲外になると H-1 と同じ Worker クラッシュにも到達。
- 修正案: 設計文書の元方針(シェルの安定キー + 解決不能時は全参加へフォールバック)に戻す。除外指定(シェル index 集合 + includeBase フラグ)を IslSettings に保存し、**satnum への解決は計算直前(worker/graph 層)で毎回行う**。派生データ(shellRanges)は永続化しない(§4-C も参照)。

### H-5. 参加チェックボックスがタブ切替で実態と乖離し、次の操作で除外が黙って解除される

- 該当: `src/components/ui/IslTab.tsx:61-62`
- 内容: `excludedShellIndices` / `includeBaseSatellites` はコンポーネントローカル state。Radix の `TabsContent`(forceMount なし)により IslTab はタブ切替でアンマウントされ、チェック状態は「全 ON」へリセットされる一方、永続化された `participantSatnums` は除外を保持し続ける。UI 表示と計算実態が矛盾し、さらに**別のチェックボックスを 1 つ触っただけで全 ON ベースラインから再計算され、以前の除外が黙って解除される**。
- 修正案: H-4 と同根。選択状態を IslSettings 側に一本化し、チェックボックスは設定から導出する(ローカル state を持たない)。

---

## 2. 重大度: 中

### M-1. 臨時地点の数値入力欄がクリアできず、空にした瞬間 0°(ギニア湾沖)へ経路が飛ぶ

- 該当: `src/components/ui/IslTab.tsx:663`(NumField)、520-539(adhoc 入力)
- 内容: `onChange={(e) => onChange(Number(e.target.value))}` は空文字を 0 に強制変換する。キーストロークごとに islSettings が更新され `islForceRecompute` が立つため、緯度を入力し直そうと欄を空にした瞬間に endpoint が 0° に移動して再計算が走る。既存 `GroundStationForm.tsx:22-27` は `parseNum`(空/"-" → NaN → 空欄表示)で正しく処理しており、実装が分岐している。
- 修正案: `GroundStationForm` の `parseNum`/`numberValue` 相当を共有部品化して NumField を置き換える。あわせて設定変更→再計算に短いデバウンス(~300 ms)を入れると入力中の無駄計算も消える。

### M-2. 地点 A/B の変更が「経路切替回数」に混入し、1 フレーム古経路が新マーカーに接続して描画される

- 該当: `src/lib/visualization.ts:946, 958-959, 977`、`src/App.tsx:118-125`
- 内容: (a) `islPreviousPathEdgeKeys` は無効化時にしかクリアされないため、endpoint 変更後の初回計算は `switchedFromPrevious=true` となり、ユーザー起因の変更が自律的ハンドオーバとして累積切替回数に加算される。(b) endpoint マーカーは即時移動するが `islLastResult`(旧経路)は Worker 往復完了まで描画され続けるため、旧経路の末端衛星から**新しい**マーカー位置へ幾何的にあり得ない線が一時的に描かれる。
- 修正案: endpoint(および参加集合)変更時に `islPreviousPathEdgeKeys` と `islLastResult` をクリアし、切替統計をリセットするフックを App 側に追加する。

### M-3. viewState に必須フィールドを追加したのに STORAGE_VERSION が 1 のまま

- 該当: `src/lib/viewState.ts:14, 56-58, 94-98`
- 内容: `isl` / `islGslColor` / `islIslColor` を**非 optional** で追加したが、バージョンも `isValidViewSettings` も据え置きのため、本コミット以前に保存されたビューは `display.isl === undefined` のまま型を偽って通過する。現在の読み出し 2 箇所は `?? createDefaultIslSettings()` でガードしており今日はクラッシュしないが、型を信頼する将来のコードは旧データで落ちる。名前付きビューは移行されず古い形のまま残り続ける(applyView は不完全な設定を lastView に書き戻しさえする)。
- 修正案: フィールドを optional として宣言する(実態に合わせる)か、STORAGE_VERSION を 2 に上げて読み込み時にデフォルト補完するマイグレーションを 1 箇所に置く。

### M-4. 計算中の設定変更で古い応答が 1 世代分適用され得る(H-3 の周辺)

- 該当: `src/lib/visualization.ts:1013-1014`
- 内容: `handleIslWorkerMessage` が `islComputeInFlight` の解除を requestId チェックの**前**に行う。送信は 1 フレーム 1 回・`!inFlight` ゲートのため未処理リクエストは最大 2 で有界(無限の積み上がりはない)が、Worker の計算時間が再計算間隔(実時間 200 ms)を超える状況では応答が常に 1 世代遅れて破棄され続けるレジームがあり得る。
- 修正案: 解除を id チェックの後へ移す(1 行の入れ替え)。H-3 の修正と同時に行うのが自然。

---

## 3. 重大度: 低

### L-1. 65 区間以上の経路が無警告で途中までしか描画されない(設計文書との不一致)

- 該当: `src/lib/visualization.ts:60, 1039`
- 内容: `ISL_PATH_MAX_SEGMENTS=64` を `Math.min` で切り詰め、再確保パスも診断表示もない。設計文書 §2.6 は「既定容量 64 区間。**超過時のみ再確保**」と規定しており不一致。結果カードは全ホップ数を表示するため、3D 表示だけが途切れる。既定設定では 65 エッジ経路はほぼ選ばれない(hopPenaltyMs=2 で 128 ms 以上のペナルティ)が、hopPenaltyMs=0 + maxRangeKm を小さくした場合に到達し得る。
- 修正案: 超過時にバッファを 2 倍に再確保する(設計どおり)。最低限、切り詰め発生時に診断欄へ表示する。

### L-2. Alpha-5 形式のカタログ番号を持つ TLE 衛星が参加選択から黙って除外される

- 該当: `src/lib/satellites.ts:75`、`src/lib/isl/participants.ts:15`
- 内容: `getSatnum` の正規表現 `/^1\s+(\d+)/` は Alpha-5(例 "A1234"、satnum ≥ 100000)にマッチせず null。satellite.js v6 の `satrec.satnum` は文字列で、`Number("A1234")=NaN` のため `wanted.has(NaN)` は常に false。参加フィルタ使用時にこれらの衛星が黙って除外される。CelesTrak 経路は GP JSON(数値 NORAD ID)なので露出は「ユーザーが Alpha-5 TLE を TOML に貼った場合」に限られる(実カタログ番号はまだ 10 万未満)。
- 修正案: satnum を数値でなく**文字列キー**で扱う(satellite.js の型に合わせる)。当面は既知の制限としてコメントを残すでも可。

---

## 4. 改善推奨(バグではないが対応価値が高い順)

### A. 性能(60 fps / 大規模構成)

| # | 該当 | 内容 | 提案 |
|---|---|---|---|
| P-1 | `visualization.ts:917, 1042` | ISL 有効中、毎フレーム `applyIslPathToScene` がエッジごとに新規 `THREE.Vector3` ×2 + endpoint の observer オブジェクトを生成(64 区間で ~8k allocs/s)。シーンの他の毎フレーム処理はアロケーションフリーで、ここだけ GC 圧を生む | クラスレベルのスクラッチ Vector3 を再利用し、`islPathPosAttr` へ直接 x/y/z を書く |
| P-2 | `visualization.ts:985-1000` | compute のたびに participantSatnums(最大 ~10k 要素)・shellRanges・previousPathEdgeKeys を含む全設定を構造化クローンで再送(最大 5 回/秒)。postMessage の直列化はメインスレッド同期処理 | 設定は identity 変化時のみ `configure` メッセージで送り、compute は `{id, simMs}` に縮小。previousPathEdgeKeys は Worker 側で保持(sweep 側は既にそうしている) |
| P-3 | `src/lib/isl/candidates.ts:64, 93` | 一様グリッドのセルキーがテンプレート文字列(挿入 1 + 近傍走査 27 回/衛星)。N=10k で ~28 万文字列/再計算 | セル座標を 1 つの数値にパック(`(cx+B) + (cy+B)*S + (cz+B)*S²`)して `Map<number, number[]>` に |
| P-4 | `src/lib/isl/shortestPath.ts:99` | Dijkstra の緩和ごとに `edgeKey()` 文字列を生成(hysteresis 有効時 = 初回以降常時)。dist/visited/prev が Map/Set | ノード id は密なので `Float64Array`/`Int32Array`/`Uint8Array` に。前回経路キーは `min*(N+2)+max` の数値 Set に |
| P-5 | `src/lib/isl/graph.ts:187-205` | shellRanges 使用時、シェル別パスに加えて全体を widestRange でもう 1 周し、同シェルペア(大多数)を距離+LoS 判定後に文字列 Set で捨てている — 候補生成コストが約 2 倍 | 全体パスに pair-filter を渡して同シェルペアを判定前にスキップ。`covered` は数値キーに |
| P-6 | `visualization.ts`(constructor) | ISL 無効(既存全ユーザーの既定)でもシーン再構築ごとに Worker を spawn し全衛星 spec を送信 | 初回有効化まで Worker 生成を遅延する |

### B. 重複の解消(ドリフトすると hysteresis や幾何が黙って壊れる箇所)

| # | 内容 | 提案 |
|---|---|---|
| D-1 | 無向エッジキー `${min}-${max}` の実装が **4 箇所**(`shortestPath.ts:58` の export 済み `edgeKey`、`graph.ts:111` `pairKey`、`stability.ts:55` インライン、`islRoutingWorker.ts:104` `edgeKeysOf`)。Worker 産のキーを `findShortestPath` が自前フォーマットで照合しており、どれか 1 つの形式が変わると hysteresis が無音で無効化する | `edgeKey` を全箇所で import。形式一致のユニットテストを 1 本追加 |
| D-2 | 地点→observer→ECF/ECI 変換が **3 箇所**(`graph.ts:233`、`stability.ts:119`(前方サンプリングごとに geodeticToEcf 再実行)、`visualization.ts:902`)。経路判定・安定性予測・マーカー描画が別実装 | `isl/geometry.ts` に `endpointObserver()`/`endpointEci()` を 1 つ置き共用 |
| D-3 | `scripts/verify-isl-routing.ts:64` / `scripts/bench-isl.ts:71` の伝播ループが Worker の `propagateAll` と重複し、しかも**失敗時 {0,0,0} フォールバック**という Worker 側で修正済みのバグを再現している(検証スクリプトが出荷コードと違う挙動を検証している) | `propagateAll` を `src/lib/isl` に移して Worker・両スクリプトで共用 |
| D-4 | `scripts/bench-isl.ts:44` が Walker 生成を手書きし「generateFromShells と一致」とコメントで主張(呼べばよい)。LCG 乱数も `tests/isl-candidates.test.ts:13` とコピー、EARTH_RADIUS のローカル再宣言が 4 ファイル | `generateFromShells` を呼ぶ。乱数・定数は共有フィクスチャ or `isl/geometry.ts` から import |

### C. 構造・保守性

| # | 内容 | 提案 |
|---|---|---|
| S-1 | `IslSettings.participantShellKeys` が**死にフィールド**(生成時 `[]` のまま誰も読み書きしない。doc コメントだけが参照)。viewState に直列化され事実上のスキーマになっている | H-4 の修正で本来の用途(安定キー)に使うか、削除 |
| S-2 | `stabilityThresholdS` が半配線(4 ファイルを通るが代入箇所ゼロ、Worker 内 `?? 60` に常時フォールバック) | UI ができるまで Worker 内の定数 `DEFAULT_STABILITY_THRESHOLD_S = 60` に畳む |
| S-3 | ISL の色設定 2 つが IslSettings に入らず 5 ファイル(App state / DisplaySettings / OptionTab props / SceneParams / deps 配列)を貫通。endpoint マーカー色はその既定値のハードコード複製で UI から変えられない | 表示設定を IslSettings(または islDisplay サブオブジェクト)に集約。マーカー色は設定から導出 |
| S-4 | Worker ペイロードが `IslSettings.cost` を手動でフラット化し、送信 2 箇所(visualization.ts / IslRoutingAnalysis.tsx)が独立に列挙 — 追加 1 項目に 6 ファイル修正、片方忘れるとライブ表示とスイープ解析が黙って食い違う | `cost` / `linkModel` サブオブジェクトを丸ごと渡す(プレーンデータなのでそのまま構造化クローン可) |
| S-5 | ISL のシーン状態が `SatelliteScene` に約 17 個の裸フィールドとして追加され、リセットが constructor / 無効化分岐 / dispose の 3 箇所に手動分散 | `IslPathLayer` 的なサブオブジェクトに封じ、update/reset/dispose を 1 箇所に |
| S-6 | `findShortestPath(graph, computedAtSimMs, candidateEdgeCount, computeTimeMs, options)` — 隣接する数値の位置引数 3 つ。`candidateEdgeCount` は常に `graph.candidateEdgeCount` | graph から読む + 残りは options に畳む |
| S-7 | `IslTab.tsx:452` が `GroundStation` 型を構造的に再宣言(CLAUDE.md「domain models を src/lib に」に抵触)。`applyParticipation` のドメインロジック(シェル→satnum 解決)もコンポーネント内 | `GroundStation` を import。解決ロジックは `isl/participants.ts` 側へ(H-4 の修正で自然にそうなる) |

---

## 5. レビュー観点別の総評

| 観点 | 評価 | 要点 |
|---|---|---|
| 1. 仕様適合 | △ | 設計文書との主要な乖離: 参加選択の永続化方式(安定キー→satnum スナップショット。H-4)、64 区間の再確保(L-1)、「即時反映」の約束(H-3)。それ以外(コスト体系・ヒステリシス・gridPattern・Worker 分離)は設計どおり |
| 2. 計算ロジック | ○ | LoS(線分クランプ)、Dijkstra/ヒープ、ヒステリシス、グリッド近傍列挙、面/スロット巻き戻りは検証で問題なし。GEO 手計算・naive↔grid 一致・ヒステリシスのシナリオテストも実装済み |
| 3. 単位・座標・時刻 | ○ | deg→rad 変換、km/ms、ECI/ECF(gmst 共有)、シーン座標の非等方スケーリングの適用は全箇所一致を確認 |
| 4. 可視化の正しさ | △ | 座標変換は正しい。ただし endpoint 変更直後の 1 サイクルに旧経路と新マーカーの混成描画(M-2)、65 区間以上の無警告切り詰め(L-1) |
| 5. 表示の分かりやすさ | △ | 色分け・結果カードは良好。切替回数にユーザー操作が混入(M-2)、Worker エラー時にユーザー向け表示がない(H-1 の顕在化経路) |
| 6. UI/UX | × | H-2(全解除の反転)、H-5(チェックボックス乖離)、M-1(入力欄クリア問題)は要修正 |
| 7. 性能 | △ | アーキテクチャ(Worker 分離・スロットル)は妥当。毎フレームアロケーション(P-1)と設定再送(P-2)は 60fps/大規模時に効く。ホットループの文字列キー(P-3/P-4/P-5)は Phase 3 の目標規模で支配項になり得る |
| 8. コード品質 | △ | lib/UI 分離・命名は概ね良好。エッジキー 4 重複(D-1)と地点変換 3 重複(D-2)はドリフト時に無音故障するため優先度高 |
| 9. テスト | ○ | 7 テストファイル・境界値・naive↔grid 一致・回帰シナリオと充実。ただし検証スクリプトの挙動乖離(D-3)と、H-1〜H-5 の領域(UI 状態同期・多シェル)はテスト空白 |
| 10. ブラウザ互換・配布性 | ○ | Worker は既存 stationAccessWorker と同じ Vite パターン。新規外部依存なし。静的配布に影響なし |
| 11. セキュリティ | ○ | 外部入力は TOML/数値フォームのみ、API キーなし、eval/innerHTML なし。指摘なし |
| 12. 保守性 | △ | §4-C 参照。特に S-3/S-4(設定 1 項目の追加コストが 5-6 ファイル)と S-5 は次の機能追加で効いてくる |

## 6. 問題なしを確認した事項(検証済み)

- ECI→シーン座標変換(軸入替 + 非等方正規化)は衛星点・マーカー・経路頂点で完全一致
- Three.js リソースの dispose(Worker terminate 含む)は CLAUDE.md 規約に適合
- 全テストが bun:test を使用、`satellites.generated.ts` 非編集、Tailwind 設定変更なし
- Worker のノード id 規約・init→compute 順序・無効化時の requestId バンプは整合
- タブ union 型の拡張・grid-cols-4 化・AnalysisTab の呼び出し元はすべて更新済み
- `IslRoutingAnalysis` のスイープは専用 Worker で実行され、メインスレッドをブロックしない(finally で terminate)
- satellite.js v6 のエラー時戻り値(null)に対する `??` フォールバックは正しく機能する(実行確認。レビュー候補 1 件をこれで棄却)

## 推奨する修正順序

1. **H-1**(generateFromShells の修正は ISL 外にも波及するため最優先。shellRanges 導出の lib 移設も同時に)
2. **H-4 + H-5 + S-1**(参加選択の持ち方を安定キー方式に作り直す — 同根なので一括)
3. **H-3 + M-4**(再計算状態機械の 2 行修正)
4. **H-2**(空配列セマンティクスの分離)
5. **M-1**(入力部品の共有化)、M-2、M-3
6. §4 の P-1/P-2、D-1/D-2/D-3(性能と無音故障リスクの高い重複)
7. 残りは次フェーズの改修時に随時

---

## 7. 簡素化フォローアップレビュー(/simplify、コミット `92b99cf` 時点)

§1–4 の指摘は Phase 5–8(コミット `92b99cf`)で S-5 を除き対応済み。本節は 2 コミット(`2e0cd7a` + `92b99cf`)を対象に再利用/簡素化/効率/実装深度の 4 観点で再レビューした結果で、**修正コミット自体が持ち込んだ残存・新規の簡素化ポイント**をまとめる(バグ指摘ではない。修正は未適用 — ToDo は isl-routing-todo.md の Phase 9)。

### 7-A. 重複の再発・残存(ドリフトすると無音で挙動が割れる箇所を優先)

| # | 該当 | 内容 | 提案 |
|---|---|---|---|
| SP-1 | `visualization.ts:1032-1042` / `IslRoutingAnalysis.tsx:92` | Worker 設定ペイロード(8 フィールド)を 2 箇所で手組みしている。項目追加時に片方を忘れるとライブ表示とスイープ解析が黙って食い違う — **H-4 で構造的に潰したはずの乖離クラスの再発** | `buildIslWorkerSettingsPayload(islSettings, shellRanges, endpointA, endpointB)` を `islRoutingWorker.types.ts` に export し両方から呼ぶ |
| SP-2 | `islRoutingWorker.ts:113` / `visualization.ts:1097-1099` | 経路→エッジキー Set の導出(`edgeKeysOf`)が Worker とメインスレッドに二重実装。「どのエッジをヒステリシス対象にするか」の変更が 2 箇所同期修正になる(D-1 と同じドリフトクラス) | `pathEdgeKeys(edges)` を `isl/edgeKey.ts` に export して共用。あわせてメイン側の保持を Set→`number[]` にすれば compute ごとの `Array.from` コピーも消える(SP-17 参照) |
| SP-3 | `cost.ts:5` / `islRoutingWorker.ts:24` / `stability.ts:18` | 安定性チューニング定数が三重管理: cost.ts の `DEFAULT_STABILITY_THRESHOLD_S`/`DEFAULT_STABILITY_WEIGHT_MS` は誰も使わないデフォルト引数(weight=20 は実質死にコード。実際の既定は types.ts の 0)、worker はローカルで 60 を再宣言、`StabilityParams` の horizonS/stepS/thresholdS は全呼び出し元が同一値(300/10/60)を明示的に渡す必須フィールド | 定数の一次ソースを stability.ts に一本化(StabilityParams の 3 フィールドを optional + 内部デフォルトに)。cost.ts の 2 定数と worker のローカル const を削除。ついでに `StabilityParams.satCount` も冗長(常に `graph.nodeAId` と一致)なので削除 |
| SP-4 | `IslTab.tsx:401-408, 435-442` | `GroundStation → IslEndpoint` の 7 フィールドリテラルが EndpointEditor 内に 2 回コピー(モード切替と局選択) | `stationEndpoint(gs): IslEndpoint` ヘルパーを 1 つ置いて両方から呼ぶ |
| SP-5 | `scripts/verify-isl-routing.ts:18` | `SPEED_OF_LIGHT_KM_PER_S` と `EARTH_RADIUS_KM` をローカル再宣言。回帰スクリプトの物理境界値が出荷コードの定数からドリフトし得る(D-3 で潰したのと同じ失敗モード) | `isl/cost.ts` / `isl/geometry.ts` から import(遅延下限は `propagationDelayMs` を直接使うのでも可) |
| SP-6 | `tomlParsers.ts:85` / `isl/types.ts:25` | `GeneratedShellRange` が `IslShellRange` のフィールド単位の複製(構造的型付けで偶然一致しているだけ)。また index→シェル逆引きループが `participants.ts:20` と `graph.ts:170` に二重実装 | `GeneratedShellRange` を削除して `IslShellRange` を import(isl/types.ts は依存ゼロなので方向は健全)。`shellOfIndex` を isl/ 配下の共有ヘルパーに |
| SP-7 | `IslRoutingAnalysis.tsx:213, 224` / `IslTab.tsx:369` | 時間窓・刻み・再計算間隔の数値入力 3 箇所が `Number(e.target.value) \|\| 1` を手書き — M-1 で潰した「編集中に既定値へスナップする」問題が同じ機能内に残存し、数値入力の流儀が 2 系統ある | `numericInput.ts` の `parseNumericInput` で確定時のみ commit(+clamp)、または NumField に min プロップを足して再利用 |
| SP-8 | `GroundStationForm.tsx:23` | NumField 共通化の残骸: `const numberValue = numericInputValue; const parseNum = parseNumericInput;` という毎レンダーの別名付けだけが残っている | 別名を削除して直接呼ぶ(または import 時にリネーム) |

### 7-B. 構造(修正の実装深度が浅い箇所)

| # | 該当 | 内容 | 提案 |
|---|---|---|---|
| SP-9 | `SatelliteEditor.tsx:343-344` | `handleUpdate` が constText を **2 回パースし、シェル衛星を 2 回生成**している(`parseConstellationToml` と `generateShellRanges` がそれぞれ内部で `generateFromShellsDetailed` を呼ぶ)。H-1 の不変条件「shellRanges は使用中の配列と必ず対応する」が、**独立した 2 回の呼び出しがたまたま同じテキストを受け取ること**でしか保証されていない。大規模構成では O(N) の二重生成コストも | `buildConstellation(constText, baseOffset): { satellites, ranges }` を tomlParsers に export し、handleUpdate は 1 回呼んで分割代入 — 対応関係を構成上保証する |
| SP-10 | `App.tsx:117` / `IslTab.tsx:178-182` | 初期ロード時は `islShellRanges=[]` のため、「更新」を押すまでシェル除外・シェル別設定・gridPattern が無効という**隠れた 2 モード**が存在する(UI は「更新を押してください」の注記で回避)。同一 TOML でも起動直後と更新後で挙動が違い、再現困難なレポートを生む | predev の `scripts/generate-satellites.ts` に `generateFromShellsDetailed` を呼ばせて `SHELL_RANGES` を `satellites.generated.ts` に出力し、App の初期値を INITIAL_SATS と同様に seed する(注記テキストも不要になる) |
| SP-11 | `App.tsx:469` ほか | committed シナリオが 4 本の並列 state/props(`onUpdate(s, gs, start, shellRanges)` の 4 位置引数)として 6 ファイルを貫通 — S-3/S-4 で批判した多ファイル波及の形が新データで再発。「satellites と islShellRanges は必ず対応する」不変条件もコメント 3 箇所での記述のみ | `CommittedScenario { satellites, groundStations, startTime, shellRanges }` を 1 つの state/props に集約。次のシナリオ級データ追加をシグネチャ変更ゼロにする |
| SP-12 | `viewState.ts:112, 118` | v2 マイグレーションが「バージョン許容集合 + 形状スニッフィングの一枚岩関数」で、保存版数を**遷移ステップの選択に使っていない** — v3 追加時に条件分岐を編み足す構造。さらに「v2 形状だが色欠落」分岐は出荷コードが書き得ない状態で、テストだけが人工的に通す到達不能コード | `MIGRATIONS: Record<number, (v) => unknown>` のステップテーブルを保存版数から順に適用する形へ。到達不能分岐と対応テストは削除 |

### 7-C. 効率(残存分。優先度順)

| # | 該当 | 内容 | 提案 |
|---|---|---|---|
| SP-13 | `islRoutingWorker.ts:85`(`predictSatPosition`) | 安定性ペナルティ有効時、同一 (衛星, サンプル時刻) の伝播をエッジごとに再計算(衛星あたり平均 4+ エッジ → 4–8 倍の冗長 propagate。E×30 サンプル×2 で数百万回/compute になり得る)。毎回 `new Date` も生成 | 粗サンプルは共有グリッドに載るので `Map<number, Vec3>`(キー = `satIndex*(horizon/step+1)+dt/step`)で memo 化。Date は `setTime` で再利用。**本機能の文書化済みボトルネックへの最有効打** |
| SP-14 | `visualization.ts:1148` | `applyIslPathToScene` が**色バッファを毎フレーム全書き換え + GPU 再アップロード**している(色が変わるのは新しい結果か色設定変更時のみ = 最大 5 回/秒。位置と違い毎フレーム更新は不要) | 直前に適用した result 参照と色 dirty フラグを持ち、変化時のみ色ループと `needsUpdate` を実行 |
| SP-15 | `candidates.ts:193` | `gridPatternIslCandidates` の重複排除 Set が文字列キー `${i}-${j}` のまま(P-3/P-4 で潰したパターンの残存。10k 機 × 5 compute/s で ~10 万文字列/s) | `edgeKey(i, j)` の数値キーに置換 |
| SP-16 | `candidates.ts:91` | `uniformGridIslCandidates` が参加衛星ごとに `[cx,cy,cz]` タプル配列を Map に確保し、走査ループで Map.get で引き直している(~10k タプル + Map エントリ/compute) | satCell Map を廃止し、走査ループ先頭でセル座標をインライン再計算(除算 3 回 < Map.get) |
| SP-17 | `isl/propagate.ts:23` / `visualization.ts:1056` | `propagateAll` が compute ごとに N 個の `{x,y,z}` リテラル + 配列 2 本を新規確保(satRec 数は init 後固定)。メイン側の `islPreviousPathEdgeKeys` も Set で保持→毎 compute `Array.from` コピーの往復無駄 | out パラメータ(worker が init 時に確保したバッファを in-place 更新)を optional で受ける。previous keys は `number[]` のまま保持して postMessage に直渡し(SP-2 と同時に) |

### 7-D. S-5(据え置き判断)の現状メモ

Phase 5–8 で `SatelliteScene` の ISL フィールドは約 20 → 約 26 個に増加(worker 関連 6 フィールド追加)。一方で worker のライフサイクル(遅延生成 / requestId 失効 / dispose)は自己完結した状態機械になっており、**切り出しの縫い目はむしろ明確になった**。据え置き判断自体は妥当のままだが、次に visualization.ts の ISL 領域へ機能追加する際は S-5(`IslPathLayer` 化)を先行または同時に実施するのが良い。

### 7-E. 確認して問題なしとした事項

- viewState の `createDefaultIslSettings`/色デフォルトの再利用、新テスト 3 ファイルのフィクスチャ(意図的な差異であり統合不要)
- worker configure/compute の順序保証(単一送信サイト + worker 側ガード + シーン再構築時の worker 再生成)
- `ensureIslPathCapacity` の倍々確保(汎用機構として妥当)、`onIslError` の単一チャネル
- sweep が設定を自己完結で持つこと(ワンショット解析として妥当)、NumField の draft/デバウンス state(M-1 修正に固有のもの)、`naiveIslCandidates` の存置(テスト・ベンチの正解生成器として現役)
