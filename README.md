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
bun dev
```

[http://localhost:3000](http://localhost:3000) を開きます。`src/App.tsx` を編集するとホットリロードされます。

| コマンド | 内容 |
| --- | --- |
| `bun dev` / `bun start` | 開発サーバー |
| `bun run build` | 静的サイトを `dist/client` に出力 |
| `bun run serve` | 本番ビルドをローカルで確認 |

## 構成

`index.html` とマウント用エントリはありません。`@solidjs/vite-plugin` の turnkey モード（`vite.config.ts` の `solid({ start: true })`）が、次の 2 ファイルからエントリを生成します。

- `src/App.tsx` — アプリ本体
- `src/Document.tsx` — HTML シェル（title / meta / favicon）

`bun run build` はシェルを `dist/client/index.html` にプリレンダーし、静的ホストへそのままデプロイできる成果物を出します。

Streaming SSR にする場合は、`vite.config.ts` で `ssr: true` を足します。

詳細は [Solid 2 ドキュメント](https://v2.solidjs.com/) を参照してください。
