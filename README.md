# cobracket

[Solid 2.0](https://v2.solidjs.com/) の最小構成です。公式 `bare` テンプレートをベースにしています。

パッケージマネージャーは **Bun v1.4** です。

## 必要環境

- [Bun](https://bun.sh) 1.4.x

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"
```

## 使い方

```bash
bun install
bun run convex:dev
bun dev
```

`convex:dev` はローカルの Convex バックエンドを起動し、`.env.local` に `VITE_CONVEX_URL` を書き込みます。別ターミナルで `bun dev` を実行し、[http://localhost:3000](http://localhost:3000) を開いてください。`src/App.tsx` を編集するとホットリロードされます。

| コマンド | 内容 |
| --- | --- |
| `bun run convex:dev` | Convex のローカルバックエンド（関数の watch / 型生成） |
| `bun dev` / `bun start` | Vite 開発サーバー |
| `bun run build` | 静的サイトを `dist/client` に出力 |
| `bun run serve` | 本番ビルドをローカルで確認 |
| `bun run fallow` | 未使用コード・重複・複雑度の静的解析（[Fallow](https://github.com/fallow-rs/fallow)） |
| `bun run fallow:audit` | 変更差分だけをゲートする |

## 構成

`index.html` とマウント用エントリはありません。`@solidjs/vite-plugin` の turnkey モード（`vite.config.ts` の `solid({ start: true })`）が、次の 2 ファイルからエントリを生成します。

- `src/App.tsx` — アプリ本体（Solid のデモ）
- `src/Tasks.tsx` — Convex のタスク一覧
- `src/Document.tsx` — HTML シェル（title / meta / favicon）
- `src/lib/convex.ts` — `convex/browser` の `ConvexClient` と Solid 2 向けの query 購読
- `convex/` — スキーマと query / mutation。`convex/_generated/` は `bun run convex:dev` が生成し、リポジトリに含めます

`bun run build` はシェルを `dist/client/index.html` にプリレンダーし、静的ホストへそのままデプロイできる成果物を出します。

Streaming SSR にする場合は、`vite.config.ts` で `ssr: true` を足します。

バックエンドは [Convex 1.44](https://docs.convex.dev/) です。クラウドへ繋ぐ場合は `bunx convex login` のあと `bun run convex:dev` でデプロイを選びます。

## コード品質

[Fallow](https://github.com/fallow-rs/fallow) 3.17 で未使用ファイル / export、循環依存、重複、複雑度を見ます。設定は `.fallowrc.jsonc` です。ルールは原則すべて `error` です。いま off なのは `coverage-gaps` だけで、テストが無いと実行パスを検証できないためです。Solid 2 の start モードは `src/main.tsx` を持たないので、`src/App.tsx` と `src/Document.tsx` を entry にしています。`convex/_generated/` は解析対象外です。

```bash
bun run fallow
```

GitHub Actions（`.github/workflows/fallow.yml`）でも同じ解析をリポジトリ全体に対して走らせ、issue があれば失敗します。

詳細は [Solid 2 ドキュメント](https://v2.solidjs.com/) と [Convex ドキュメント](https://docs.convex.dev/) を参照してください。
