# 依存更新と検証（2026-10-30）

Bun を継続し、直接依存は調査時点の最新安定版へ更新した。更新対象のないパッケージも `bun outdated` で確認した。ベータ／RC は使っていない。検証用のベンチマーク、GPU負荷シナリオ、画像、生成された `dist/` はコミット対象に含めない。

## 変更点と新機能の確認

| ライブラリ | 更新内容・確認した機能 | このアプリでの判断と検証 |
| --- | --- | --- |
| Bun | 1.4.4。実行環境と `@types/bun` を揃えた | `packageManager` に指定し、CI はその指定を参照。frozen-lockfile インストール、Bunテスト、データ生成、API／CLIバンドルを確認 |
| TypeScript | 5.8.3 → **7.0.2**。Goベースのネイティブコンパイラ、並列型検査、新しい既定値 | `baseUrl` を削除、必要な `types` を明示。ビルドの `tsc -b` は7系。高速化率は依存と条件が変わるため主張しない |
| React / React DOM | 19.1.0 → 19.3.1。19.2のEffect Events・Activity・Performance Tracks、19.3のView Transitions・Fragment refs等 | 外部要求を受ける解析ダイアログの通知に `useEffectEvent` を使用。フォーム検証は派生値として計算し、propsからの初期化は条件付きで同一コンポーネントの状態を更新。ActivityやView Transitionsは自動導入せず、Three.jsのライフサイクルを維持 |
| Three.js / 型定義 | 0.176.0 → 0.186.1 / 0.186.0。WebGPU/TSLの拡張、Object3Dのdispose、描画・変換APIの変更 | r176〜r186の移行ガイドを確認。アプリはWebGLと独自GLSLを継続。Object3Dの独自サブクラスや変更対象の行列更新APIは使っていない。通常表示、21,003機のGPU表示、選択、通常表示への復帰でシェーダー警告・エラーなし |
| ECharts | 5.6.0 → 6.1.0。新テーマ、テーマ切替、軸ラベルの重なり／はみ出し防止、matrix・chord・jitter・broken axis等。6.1では軸・丸め・ツールチップ等の修正 | 新しい標準描画を使用し、既存の色・配置指定を維持。新しいグラフ種別は必要な分析要件がないため追加しない。実際の解析と感度切替、HTML出力を確認。ISLの軸名はテーマ色を明示してダーク背景での可読性を維持 |
| echarts-for-react | 3.0.2 → 3.0.6。ECharts 6対応、親から渡されたイベントだけを解除する修正、DOM props転送等 | 設定済みのResizeObserverアダプタを維持。解析の開閉・再実行とグラフ生成を確認 |
| KaTeX | 0.16.22 → 0.19.1。信頼オプションの継承による問題の修正、数式組版修正、strict時の欠落文字メトリクス診断の変更 | 固定の摂動数式6件をブラウザで確認。外部入力の信頼を許可しない既定値を維持。公式型定義を同梱するため `@types/katex` は削除 |
| Radix Checkbox / Dialog / Label / Select / Slot / Tabs | 1.4.1 / 1.3.1 / 2.1.17 / 2.4.1 / 1.5.0 / 1.2.1。ARIA参照やフォーカス等の修正、tree-shaking改善 | 既存のプリミティブを維持。タブ、ダイアログの開閉・再初期化、選択、チェック、テーマ操作を確認 |
| Lucide React | 0.519.0 → 1.64.0。アイコン追加と図形修正（最新では文字・数字カテゴリ等） | 使用中の名前付きimportはビルドと画面で確認。新アイコンを目的なくUIへ追加しない |
| tailwind-merge | 3.3.1 → 3.7.0。新しいTailwindユーティリティ対応、色／論理方向／サイズの競合処理修正 | 共通の `cn()` を維持。フォーム、ダイアログ、ライト／ダーク表示を確認 |
| tw-animate-css | 1.3.4 → 1.4.0。spacingとprefixの扱いを分離 | CSSにprefix設定がないため通常の `tw-animate-css` importを継続。開閉アニメーションを確認 |
| idb-keyval | 6.2.2 → 6.3.0。公開API・ストア利用方法を確認 | 既存の画像キャッシュAPIを継続。新規originで地球テクスチャを表示。キャッシュ内容の変更や移行は不要 |
| smol-toml | 1.9.0 → 1.9.1。不正な浮動小数点の指数符号を拒否する修正 | 既存の設定・コンステレーション・編隊・CLIのテストに加え、ブラウザから通常／大量設定を読み込み。TOMLのスキーマは変更しない |
| ESLint / @eslint/js / typescript-eslint | 10.13.0 / 10.0.1 / 8.72.1。ESLint 10の設定探索・JSX参照・recommendedルール、TS対応範囲を確認 | `eslint/config` の `defineConfig` に移行。無効な初期代入を整理し、既存ルールを維持 |
| eslint-plugin-react-hooks / react-refresh | 7.1.1 / 0.5.7。Compiler診断、refs、Effectからの状態更新等の検査 | 検出箇所を修正。外部Workerを停止して最後の結果を反映する処理1箇所だけは、理由を付けて `set-state-in-effect` の局所例外とした。React Compiler本体は導入していない |
| globals / React・DOM・Node・Leafletの型定義 | 17.13.0 / 19.3.0 / 19.3.0 / 26.6.6 / 1.9.22 | 実際の依存・コンパイラに合わせて更新。型検査とLeaflet地上局マップを確認 |
| @vercel/node | 最新29.0.0を確認後、削除 | アプリで使っていたのは型だけだった。NodeのIncomingMessage / ServerResponseに置換し、標準のstatusCode / endを使用。JSON解析済みbodyの境界、ヘッダー、認証、503応答を回帰テスト。Vercelビルダー由来の不要な間接依存を除去 |

Vite 8.3.5、@vitejs/plugin-react 6.1.2、Tailwind CSS / @tailwindcss/vite 4.3.3、satellite.js 7.1.0、Leaflet 1.9.4、react-leaflet 5.0.0、mdb-reader 3.2.0、clsx 2.1.1、class-variance-authority 0.7.1、buffer 6.0.3、events 3.3.0、process 0.11.10、stream-browserify 3.0.0 は、調査時点で最新のため維持した。

## TypeScript 7とlintの互換構成

TypeScript 7.0は従来のTypeScript Compiler APIを提供せず、typescript-eslint 8.72.1はTypeScript `<6.1.0` のAPIを必要とする。そのためMicrosoftの公式推奨どおり併用する。

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@~7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

- `node_modules/.bin/tsc` は `@typescript/native/bin/tsc` を指し、`--version` は `7.0.2`。
- 互換APIのパッケージは `tsc6` だけを公開するので、`tsc` の衝突はない。
- `bun run build` の型検査はTypeScript 7。lintだけが6系のAPIを参照する。
- 互換APIは開発用で、Web／CLIの実行コードには含まれない。

## HTMLレポート

アプリはECharts 5.6.0を使っていた一方、HTMLレポートは5.4.3を固定読み込みしていた。単一・2枚・複数グラフの全形式で、インストールされたEChartsの `version` からCDN URLを生成するよう統一した。今後の更新でもアプリと出力先のランタイムがずれない。

回帰テストでは実際に生成されたHTMLのURL・データ・グラフ要素を確認し、埋め込まれた初期化JavaScriptとリサイズ処理を実行する。ブラウザからHTMLファイルを書き出し、6.1.0の参照も確認した。ローカル `file:` ページをブラウザで開く操作は検証環境のURL制限で拒否されたため、独立したHTMLページの実描画は未確認。

## 検証結果

- `bun install --frozen-lockfile`: 成功、lockfile変更なし。
- `bun run test`: 590件成功、1件スキップ。スキップは既存のCelesTrak実APIテスト。計算が重い1件は最初の並行実行時に時間切れになったが、単独実行と全体再実行で成功。タイムアウト値やassertionは弱めていない。
- `bun run lint`: 成功、警告・エラーなし。
- `bun run build`: TypeScript 7、Vite、本番用セッションAPI生成、ライセンス通知生成が成功。衛星データはprebuildにより再生成されるが、入力TOMLと生成コードに差分はない。
- `bun run build:cli`: 成功。CLIのシナリオ処理は既存のCLIテストでも確認。
- `bun outdated`: 更新候補なし（互換APIとネイティブコンパイラの公式alias構成を含む）。
- `bun audit --json`: `{}`（指摘ゼロ）。
- 開発版: 編集のキャンセル／再表示、入力中の空欄維持、緯度範囲の検証、RGT提案、方式切替、セッション作成→ポーリング→終了を確認。
- 本番ビルド: 通常描画→21,003機のGPU描画→衛星選択→KaTeX数式表示→ライト／ダーク→通常描画への復帰を確認。電力解析のKPI・3枚のグラフ・感度切替、地上局アクセス、全球アクセス、軌道寿命・推進剤、通信タブからのISL解析呼び出しと61ステップのスイープも確認。ブラウザコンソールの警告・エラーなし。

実環境のVercelデプロイやRedisへの接続、外部カタログの最新データ全件取得、全GPU・全ブラウザ機種の検証は含まない。更新によるFPS向上やTypeScript高速化率は保証しない。

## 一次資料

- [TypeScript 7と公式の互換API併用方法](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
- [typescript-eslintの対応バージョン](https://typescript-eslint.io/users/dependency-versions/)
- [React 19.2](https://react.dev/blog/2025/10/01/react-19-2)、[React 19.3](https://react.dev/blog/2026/09/09/react-19-3)
- [Three.js移行ガイド](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
- [ECharts 6新機能](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/)、[移行ガイド](https://echarts.apache.org/handbook/en/basics/release-note/v6-upgrade-guide/)、[6.1リリース](https://github.com/apache/echarts/releases/tag/6.1.0)
- [echarts-for-reactリリース](https://github.com/hustcc/echarts-for-react/releases)
- [KaTeXリリース](https://github.com/KaTeX/KaTeX/releases)、[セキュリティ修正](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)
- [Radixリリース](https://www.radix-ui.com/primitives/docs/overview/releases)
- [Lucide 1.64](https://github.com/lucide-icons/lucide/releases/tag/1.64.0)
- [tailwind-mergeリリース](https://github.com/dcastil/tailwind-merge/releases)、[tw-animate-css 1.4](https://github.com/Wombosvideo/tw-animate-css/releases/tag/v1.4.0)
- [idb-keyval API・変更履歴](https://github.com/jakearchibald/idb-keyval)、[smol-toml 1.9.1](https://github.com/squirrelchat/smol-toml/releases/tag/v1.9.1)
- [ESLint 10移行ガイド](https://eslint.org/docs/latest/use/migrate-to-10.0.0)
- [Vercel Node.jsの標準ハンドラ](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)
