# Constellation Visualizer

衛星コンステレーションを設計し、3D の地球上で軌道を眺め、地上や衛星間の接続を評価するアプリケーションです。

[アプリを開く](https://constellation-vis-rho.vercel.app/) · [English](../README.md) · [計算の概要](how-it-works.md)

## できること

- **コンステレーションの設計** — TLE や軌道要素から衛星を定義し、CelesTrak からデータを取り込めます。配置パターンやミッション要件からの設計にも対応しています。
- **3D で確認** — 地球上に軌道、地上局、衛星の視野、衛星間リンクを表示します。
- **ミッションの解析** — 地上局とのアクセス、衛星間の経路、軌道寿命・推進剤、日照・電力を評価します。
- **外部ツールとの連携** — シナリオを TOML で保存し、CLI で地上リンクを解析できます。一時セッションを使って AI と連携することもできます。

衛星の位置は `satellite.js` の SGP4/SDP4 で計算します。アクセスやリンクの結果は幾何的な接触機会であり、電波性能や運用スケジュールの評価ではありません。前提と限界は[計算の概要](how-it-works.md)を参照してください。

## はじめる

[Bun](https://bun.sh/) 1.3.11 以上が必要です。

```sh
bun install
bun run dev
```

[localhost:5173](http://localhost:5173) を開いてください。開発サーバーはフロントエンドのみを実行します。ローカルで AI セッション API を使うには、別途設定が必要です。

```sh
bun run test       # テスト
bun run lint       # コード検査
bun run build      # 本番ビルド
bun run build:cli  # Bun で実行する CLI を dist/ に生成
```

## ドキュメント

- [計算の概要](how-it-works.md) · [解析モデルと実装](analysis-implementation.md)
- [コンステレーション配置方式](constellation-patterns.md) · [ミッションからの設計](constellation-design.md) · [衛星間リンクの経路探索](isl-routing.md)
- [CLI ガイド](constelation-cli-SKILLS.md) · [AI セッション API](../public/ai-api.md) · [デプロイとローカル API 設定](deployment.md)

## ライセンス

Copyright 2026 Interstellar Technologies Inc. 本プロジェクトが作成したものは [Apache-2.0](../LICENSE) で提供します。第三者のライブラリやデータにはそれぞれの条件が適用されます。詳しくは [THIRD-PARTY.md](../THIRD-PARTY.md) を参照してください。
