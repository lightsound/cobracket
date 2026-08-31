# React 開発者のための Solid 2.0 移行ガイド（日本語まとめ）

出典: Solid 2.0 公式ドキュメント "Migration / From React"

> **追記（Solid 2 colorless async / solid2-agent-kit 0.9）**: §14 の async props は公式どおり **値渡し** が本線です。`user={user()}`、型は `User`、`<Loading>` は読み取りの直上。以前このガイドが推していた `user={user}` / `Accessor<User>` は、子が `refresh(そのソース)` / `affects(そのソース)` を呼ぶときに限る例外です。

---

## 0. 全体像 — まずこれだけ

React で身につけた知識のうち、**components / props / JSX / events / context / refs / composition** はそのまま通用します。変わるのは1点だけです。

> **state の変更が DOM に届くまでの経路（how state changes reach the DOM）**

React は「state が変わったら **component 関数をもう一度実行**して次の結果を作る」。
Solid は「**component 関数は mount 時に1回だけ実行**され、その後は signal / store が、**それを読んだ computation と JSX 式だけ**に通知する」。

この1点の違いから、本ガイドのすべての差分が派生します。理解の順序としては次の3層で捉えると整理しやすいです。

| 層 | 内容 | React との差 |
|---|---|---|
| **実行モデル** | component は再実行されない | 最大の差。ここが全ての根 |
| **リアクティビティの単位** | signal / store / memo / effect | hooks の「順序ルール」が消える |
| **JSX の表現** | `class`、`For`、`Show`、`Loading` など | 見た目は似ているが意味が違う |

### 0.1 頻出英単語ミニ辞典

Solid のドキュメントは同じ語幹の英単語を品詞違いで使い分けるため、そこで詰まりやすいです。先に潰しておきます。

#### derive / derived / derivation ファミリー

すべて動詞 **derive（〜から導き出す・派生させる）** の変化形です。日本語の「派生」に対応します。

| 語 | 品詞 | 意味 | 具体例 |
|---|---|---|---|
| **derive** | 動詞 | 導き出す | "derive a value from state"（state から値を導き出す） |
| **derived** | 形容詞 | 導き出された | **derived value** = 派生値、**derived signal** = 派生 signal |
| **derivation** | 名詞 | ①導き出す**という行為**／②導き出す**仕組みそのもの** | 「その derivation が値を供給する」＝「その派生の仕組みが値を供給する」 |

**ポイントは `derivation` が「導出された結果の値」ではなく、「値を導出する仕組み（＝関数）」を指すことです。**

```tsx
const [firstName] = createSignal("Ada");
const [lastName] = createSignal("Lovelace");

const fullName = () => `${firstName()} ${lastName()}`;
//    ^^^^^^^^ これ全体が「a derivation」（派生の仕組み）
//    fullName() の戻り値 "Ada Lovelace" は「the derived value」（派生値）
```

Solid 文脈では、実質こう読み替えて構いません。

> **derivation ＝「他のリアクティブな値から値を計算する関数」**（ただの関数でも `createMemo` でもよい）

対義語は **state（状態）** です。Solid のドキュメントが繰り返す「これは state ではなく derivation にせよ」は、**「値を signal に保存して同期するな。読むたびに計算する関数にせよ」** という意味です。

| | state | derivation |
|---|---|---|
| 実体 | signal / store に**保存された値** | 値を**計算する関数** |
| 真実の源 | それ自身 | 元になった別の state |
| Solid での例 | `createSignal(0)` | `() => count() * 2`、`createMemo(...)` |

なお §6 に出てくる **writable derivation（書き込み可能な派生）** は、この2つの中間です。普段は derivation として振る舞い（元の値を計算し続ける）、書き込まれた間だけ state のように振る舞います。

#### その他の頻出語

| 語 | ざっくりの意味 | 詳しい解説 |
|---|---|---|
| **accessor** | リアクティブな値を読む**関数**（`count()`） | §1.2 |
| **tracking scope** | 実行中の読み取りを記録する**追跡範囲** | §1.3 |
| **untracked** | 追跡されない状態。読んでも購読が発生しない | §1.3 |
| **reactive graph** | 「誰が誰に依存するか」の**依存グラフ** | §5.0 |
| **computation** | グラフの**ノードになれる再実行可能な計算** | §5.0 |
| **equality boundary** | 値が同じなら伝播を止める**関所** | §5.0 |
| **consumer** | ある値を読んでいる側（購読者） | §5.0 |
| **owner** | 生存期間の持ち主。cleanup の紐づけ先 | §2 |
| **primitive** | Solid が提供する基本部品（`createSignal` など） | §2 |
| **settled** | 非同期処理が**決着した**状態 | §14 |
| **held update** | 決着まで**保留された**更新 | §14 |

---

## 1. 実行モデル（Execution model）

### 1.1 React と Solid の根本的な違い

- **React**: component は「現在の props と state」からレンダリングされる。state が変われば component 関数を再実行して次の結果を得る。
- **Solid**: component 関数は Solid がその component を mount するときに走る。以降、signal と store は **それらを読んだ computation と JSX 式だけ** に通知する。**component 関数を再実行する必要がない。**

### 1.2 同じ UI を両者で書くと

**React**

```tsx
import { useState } from "react";

function Counter() {
	const [count, setCount] = useState(0);
	const doubled = count * 2;

	return (
		<button onClick={() => setCount((value) => value + 1)}>
			{count} × 2 = {doubled}
		</button>
	);
}
```

**Solid**

```tsx
import { createSignal } from "solid-js";

function Counter() {
	const [count, setCount] = createSignal(0);
	const doubled = () => count() * 2;

	return (
		<button onClick={() => setCount((value) => value + 1)}>
			{count()} × 2 = {doubled()}
		</button>
	);
}
```

見た目の差は小さいですが、意味はこう違います。

- Solid の signal は **accessor（読み取り関数）と setter** のペアを返す。
- **accessor** = リアクティブな値を読む関数（`count()`）。
- JSX の中で `count()` を呼ぶと、**その式が signal を購読する**。
- `doubled()` を JSX の中で呼ぶと、**同じ tracking scope が `count()` の読み取りを発見できる**（＝ `doubled` 自身が購読対象になるのではなく、その中の読み取りが伝播する）。

### 1.3 tracking scope（追跡スコープ）— 最重要概念

> **tracking scope とは、実行中に読まれたリアクティブな値を記録しておき、後でその処理を更新できるようにする仕組み。**

ここから導かれる実務ルール:

- **リアクティブな読み取りは、JSX の中か、他の tracking scope の中に置く。**
- **component 本体のトップレベルでの読み取りは「1回きりの読み取り」になる。** component body は untracked（追跡されない状態）で実行されるため。

```tsx
function Bad() {
	const [count] = createSignal(0);
	const now = count(); // ← トップレベル。1回読んだきりで更新されない
	return <p>{now}</p>;
}
```

📌 **React 脳の落とし穴 #1**: React では「component の本体に書いた計算は毎回走る」ので、そこで値を取り出すのが自然でした。Solid では本体は1回しか走らないため、**「値」ではなく「関数（accessor）」を JSX まで運ぶ**のが基本になります。

---

## 2. Hooks を「役割」で読み替える（Translate hooks by purpose）

- **React**: hooks は render 中に **決まった順序で呼ばれる**ことで、保持された state へのアクセスや挙動のスケジューリングを行う。
- **Solid**: primitives は **component の setup 時に生成される**。computation と cleanup は **owner** に紐づき、owner が「mount された component または reactive scope の生存期間」を提供する。
- Solid の primitives は**ただの関数呼び出し**であり、**hook の順序ルールも命名ルールも存在しない**（条件分岐の中で呼んでも構わない）。

### 対応表

| React hook | Solid primitive | 役割 |
|---|---|---|
| `useState`（スカラー値） | `createSignal` | ローカルなスカラー state |
| `useState`（オブジェクト/コレクション） | `createStore` | オブジェクト・配列などの state |
| `useMemo` | `createMemo` | キャッシュされた派生 state |
| `useEffect` | `createEffect` | 命令的（imperative）な同期処理 |
| `createContext` / `useContext` | `createContext` / `useContext` | サブツリーで共有する state |
| custom hook | **custom primitive** | Solid primitives を生成して返すただの関数 |

> ⚠️ この対応表は「**関連する責務**」を示すもので、「**実装が交換可能**」という意味ではありません。必要な data flow から Solid primitive を選んでください。

---

## 3. ローカル state の読み書き

`useState` と `createSignal` はどちらも「値 + setter」を提供します。見た目が違うのは Solid が accessor を使うためです。

両者とも、前の state から導く updater 関数を受け取れます。

```tsx
setCount((value) => value + 1);
```

### スケジューリングの注意（Scheduling note）

- Solid は **synchronous flush scope の外で行われた signal / store の書き込みを stage（保留）する**。
- reactive queue の commit は **microtask 上**、つまり現在の JavaScript タスクが完了した後に行われる。
- **アプリケーションのイベントハンドラでは、明示的な flush は通常不要。**
- **テストや命令的な統合コード**が、commit 済みの state や DOM を**同期的に**観測したい場合は [`flush()`](https://v2.solidjs.com/reference/solid-js/reactivity/flush) を使う。

---

## 4. オブジェクト / コレクションの state（store）

- **React**: オブジェクトを更新するとき、新しいオブジェクトを作る（イミュータブル更新）。
- **Solid の store**: **読み取り専用のリアクティブな view** と、**draft を mutate する setter** を提供する。

**React**

```tsx
const [profile, setProfile] = useState({
	name: "Ada",
	role: "Engineer",
});

function rename(name: string) {
	setProfile((current) => ({ ...current, name }));
}
```

**Solid**

```tsx
import { createStore } from "solid-js";

const [profile, setProfile] = createStore({
	name: "Ada",
	role: "Engineer",
});

function rename(name: string) {
	setProfile((draft) => {
		draft.name = name;
	});
}
```

ポイント:

- tracking scope の中で `profile.name` を読むと、**そのプロパティ単位で購読**される。
- **無関係なプロパティの更新では、その reader は再実行されない**（React の再レンダリングとの決定的な差）。
- **signal でもオブジェクトは扱える。** ただしそれが適切なのは、**値全体が1つの identity を持ち、まとまって変わる**場合。

📌 **React 脳の落とし穴 #2**: `setProfile((draft) => { draft.name = name })` は一見「ミュータブルな悪手」に見えますが、Solid では store setter が正規の書き込み手段です。スプレッドで作り直すと、プロパティ単位の細かい購読の利点を失います。

### 補足: signal と store、どちらでオブジェクトを持つか

原文の「値全体が1つの identity を持ち、まとまって変わる場合」という表現は、**購読の粒度（granularity）** の話をしています。

**signal は「箱ごと」の購読、store は「プロパティごと」の購読** と考えると整理できます。

| | signal にオブジェクトを入れる | store |
|---|---|---|
| 購読の単位 | **signal そのもの1個**（＝箱ごと） | **アクセスした各プロパティ** |
| 更新の伝え方 | setter に**新しいオブジェクトを渡す**（参照が変わる） | setter で **draft を mutate する** |
| `name` だけ変えたとき | その signal を読んでいる**すべて**の reader が再実行される | `name` を読んでいる reader **だけ**が再実行される |
| 中身を直接書き換えたとき | **何も起きない**（setter を通っておらず、監視もされていない） | — |

```tsx
// signal にオブジェクトを入れた場合
const [profile, setProfile] = createSignal({ name: "Ada", role: "Engineer" });

<p>{profile().role}</p>; // ← role しか読んでいないが…

setProfile((current) => ({ ...current, name: "Grace" }));
// name しか変えていないのに、新しい参照になるので上の <p> も更新対象になる
```

```tsx
// store の場合
const [profile, setProfile] = createStore({ name: "Ada", role: "Engineer" });

<p>{profile.role}</p>; // ← role のみを購読

setProfile((draft) => { draft.name = "Grace"; });
// role は変わっていないので、上の <p> は再実行されない
```

#### signal が向くケース（＝「まとまって変わる」もの）

- **丸ごと差し替わる値**: `fetch` のレスポンス、選択中のアイテムへの参照、読み込んだ設定オブジェクト。
- **意味的に不可分な値**: `Date`、座標 `{ x, y }`、`Map` / `Set` を毎回作り直すケースなど、「一部だけ更新する」概念が存在しないもの。
- **中身を細かく読まない値**: consumer が `data()` をそのまま子 component に渡すだけ、といった使い方。
- **null ↔ オブジェクト を行き来する値**: `User | null` のように、存在するかどうかが主要な関心事であるもの。

#### store が向くケース

- **フォームの state** のように、フィールドごとに独立して更新され、フィールドごとに別の場所が表示している。
- **ネストが深い**構造で、末端だけが頻繁に変わる。
- **配列**で、要素の追加・削除・並べ替えが起きる（`For` と組み合わせて行の identity を保持したい）。

#### 判断の目安

> **「このオブジェクトは、更新のたびに丸ごと別物になるか？」**
>
> - **YES** → signal。参照が変われば全体が変わったのだから、箱ごとの通知で過不足がない。
> - **NO（一部だけ変わる）** → store。細粒度の購読が効いて、無関係な更新で reader が動くのを防げる。

なお、signal にオブジェクトを入れた場合に「無関係な更新で下流が動く」のを抑えたいときは、**`createMemo` を equality boundary として挟む**という手もあります（§5 参照）。

```tsx
const role = createMemo(() => profile().role);
<p>{role()}</p>; // profile() が別参照になっても、role の値が同じなら下流は止まる
```

---

## 5. state から値を派生させる（Derive values）

- **React**: render 中に計算できる。`useMemo` は**あくまでパフォーマンス最適化**であり、**React はそのキャッシュを破棄しうる**ため、アプリの挙動がその永続性に依存してはいけない。
- **Solid**:
  - **derived function（ただの関数）** は、**それを呼んだ tracking scope の中で実行される**。
  - **`createMemo`** は reactive computation を作り、その **キャッシュされた結果と equality の挙動が reactive graph の一部になる**（＝挙動として保証される）。

### 5.0 先に用語を整理する

この章は用語が固いので、先に3つだけ押さえます。

#### reactive graph（リアクティブグラフ）

**「誰が誰の値に依存しているか」を表した有向グラフ**です。Solid のランタイムはこのグラフを実際にメモリ上に持っていて、更新はこのグラフの辺（edge）をたどって伝わります。

- **ノード（節点）** になるもの: signal / store のプロパティ、`createMemo`、`createEffect`、**JSX の1つ1つの式**。
- **辺（edge）** = 購読関係。「A を読んだので、A が変わったら私を再実行して」という登録。
- この辺は、**tracking scope が実行されたときに自動で張られる**（§1.3）。React の依存配列を手で書くのに対して、Solid は**実行の副産物としてグラフが構築される**のが違いです。

```
[signal firstName] ──┐
                     ├──> [memo fullName] ──> [JSX式 <h1>]
[signal lastName]  ──┘                    └──> [JSX式 <input>]
```

📌 React には「グラフ」に相当する常設の構造はありません。React は component tree を上から再実行して差分を取ります。**Solid は tree を辿らず、グラフの辺を直接たどって該当箇所だけを更新します。** これが「component 関数が再実行されない」の実体です。

#### reactive computation（リアクティブな計算）

**グラフのノードになれる「再実行可能な計算」** のことです。具体的には `createMemo` と `createEffect`（および内部的には JSX 式）が作るものを指します。

computation は2つの顔を持ちます。

1. **consumer（消費者）**: 実行中に読んだリアクティブな値を購読する（＝自分に向かう辺が張られる）。
2. **source（供給源）**: `createMemo` の場合、自分の結果を他の computation に供給できる（＝自分から出ていく辺を持てる）。

対して **derived function（ただの関数）はノードになりません。** 呼ばれた場所の tracking scope に**その場で展開される**だけです。ここが `createMemo` との決定的な差です。

```tsx
// ただの関数 → ノードにならない
const fullName = () => `${firstName()} ${lastName()}`;
// <h1>{fullName()}</h1> と書くと、<h1> の JSX 式が直接
// firstName と lastName を購読する。fullName という中間ノードは存在しない。

// createMemo → ノードになる
const fullName = createMemo(() => `${firstName()} ${lastName()}`);
// firstName / lastName を購読するのは memo。<h1> は memo だけを購読する。
```

#### equality boundary（等値の境界）

**「値が実質変わっていなければ、そこから下流に更新を伝えない関所」** のことです。

`createMemo` は再計算した結果を**前回の結果と比較し、等しければ下流の consumer に通知しません。** つまり memo は**変更伝播を止めるダム**として機能します。

```tsx
const [user, setUser] = createSignal({ name: "Ada", role: "Engineer" });

const role = createMemo(() => user().role); // ← equality boundary

<p>{role()}</p>;

setUser({ name: "Grace", role: "Engineer" });
// user は別参照になったので memo は再計算される。
// しかし結果は "Engineer" のままなので、<p> には通知が行かず再実行されない。
```

これをただの関数 `const role = () => user().role` にすると、`<p>` は `user` を直接購読しているため、**`role` が同じでも `<p>` は再実行されます。**

> 「**キャッシュされた結果と equality の挙動が reactive graph の一部になる**」という原文は、この「ダムとしての振る舞いが、単なる最適化ではなくグラフの構造そのものとして保証される」という意味です。
>
> **React の `useMemo` との決定的な差はここです。** React は `useMemo` のキャッシュを破棄しうるので、「memo 化したから下流が再レンダリングされない」ことに**挙動として依存してはいけません**（`React.memo` などを別途組み合わせる必要がある）。Solid の `createMemo` は**依存できる契約**です。

### 使い分け

**小さな派生を1箇所で使う → ただの関数**

```tsx
const fullName = () => `${firstName()} ${lastName()}`;

return <p>{fullName()}</p>;
```

**高コストな派生 / 複数の consumer が同じ結果を必要とする / 結果を equality boundary にしたい → `createMemo`**

```tsx
import { createMemo } from "solid-js";

const fullName = createMemo(() => `${firstName()} ${lastName()}`);

return (
	<>
		<h1>{fullName()}</h1>
		<label>
			Display name
			<input value={fullName()} readOnly />
		</label>
	</>
);
```

memo は `firstName()` と `lastName()` を track し、**consumer は個々の入力ではなく memo を track する**。

### 上の例で実際に何が違うか

`fullName` を **2箇所**（`<h1>` と `<input>`）で読んでいる点がポイントです。

**ただの関数の場合**

```
[firstName] ──┬──> [JSX式 <h1>]      ← ここで文字列連結が1回
              └──> [JSX式 <input>]   ← ここでも文字列連結が1回
[lastName]  ──┴──> （同上）
```

- `fullName()` の本体は**読まれた箇所の数だけ実行される**（この例では2回）。
- `firstName` が変わると、`<h1>` と `<input>` の両方が**必ず**再実行される。

**`createMemo` の場合**

```
[firstName] ──┐
              ├──> [memo fullName] ──┬──> [JSX式 <h1>]
[lastName]  ──┘   （計算はここで1回） └──> [JSX式 <input>]
```

- 計算は **memo の中で1回だけ**。両方の consumer は同じキャッシュ結果を受け取る。
- memo の結果が前回と同じなら、下流の2つの JSX 式は**再実行されない**（equality boundary）。

### 判断の目安

| 状況 | 選ぶもの |
|---|---|
| 計算が軽く、読む箇所が1つだけ | **ただの関数**（ノードを増やさない分こちらが軽い） |
| 計算が高コスト（ソート、フィルタ、整形など） | **`createMemo`** |
| 同じ結果を複数の consumer が読む | **`createMemo`**（計算の重複を避ける） |
| 入力は頻繁に変わるが、結果はあまり変わらない | **`createMemo`**（equality boundary で下流を止める） |
| 結果をさらに別の memo / effect の入力にする | **`createMemo`**（グラフのノードとして繋ぐ） |

📌 **React 脳の落とし穴**: React では「とりあえず `useMemo` で包む」がしばしば逆効果でした（依存配列の管理コスト、キャッシュが保証されない）。Solid では逆に、**memo は意味のある構造**なので、「何のために境界を置くのか」を意識して選べます。ただしノードを1つ増やすコストはあるので、**1箇所で使う軽い派生はただの関数のまま**が原則です。

> 他のリアクティブな値から計算できる state は、通常 **derivation のままにする**。**「もう1つ signal を用意して、それを同期する effect を書く」必要はない。**

```tsx
// ❌ React でよく書いてしまう形（Solid では不要）
const [fullName, setFullName] = createSignal("");
createEffect(
	() => [firstName(), lastName()],
	([first, last]) => setFullName(`${first} ${last}`)
);

// ✅ Solid
const fullName = () => `${firstName()} ${lastName()}`;
```

理由は3つです。

1. **state が二重化する**。`firstName` と `fullName` という「真実の源」が2つできて、ズレる余地が生まれる。
2. **1テンポ遅れる**。effect は書き込みの後に走るため、同期される前の中途半端な値が一瞬 commit されうる。
3. **グラフが不必要に長くなる**。derivation なら `firstName → JSX` の1辺で済むところが、`firstName → effect → signal → JSX` になる。

---

## 6. props から派生する「編集可能な値」

「prop に追従するが、ユーザーがローカルで編集したらそちらを優先し、上流の prop が変わったらリセットする」入力欄のパターン。**React も Solid も effect なしで書けます。**

### React

React はこの要求に対して**4段階の優先順位**を置いています。上ほど推奨されます。

| 優先度 | 手段 | 適用条件 |
|---|---|---|
| 1（最善） | **render 中に計算する** | そもそも state を持たずに済む場合 |
| 2 | **`key` で component ごとリセットする** | prop 変化時に**その component の state を全部**捨ててよい場合 |
| 3 | **render 中に state を調整する**（下記のパターン） | **一部の state だけ**を prop に合わせる必要がある場合 |
| 4（最悪） | **Effect で同期する** | React は明確に非推奨 |

#### 優先度1: render 中に計算する

**既存の props や state から計算できるものは、そもそも state に入れない。** React で最も重要な原則です。

```tsx
// 🔴 避ける: 冗長な state と不要な Effect
function Form() {
	const [firstName, setFirstName] = useState("Taylor");
	const [lastName, setLastName] = useState("Swift");
	const [fullName, setFullName] = useState("");

	useEffect(() => {
		setFullName(firstName + " " + lastName);
	}, [firstName, lastName]);
}

// ✅ render 中に計算する
function Form() {
	const [firstName, setFirstName] = useState("Taylor");
	const [lastName, setLastName] = useState("Swift");
	const fullName = firstName + " " + lastName;
}
```

さらに一歩進めると、**「調整が必要な state」を「調整が不要な state」に設計し直せる**ことがあります。React 公式が挙げる例では、選択中の**アイテムそのもの**を state に持つのをやめ、**ID だけ**を持ちます。

```tsx
// 🔴 items が変わるたびに selection をリセットする必要がある
const [selection, setSelection] = useState(null);

// ✅ 最善: ID だけ持ち、実体は render 中に計算する
function List({ items }: { items: Item[] }) {
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const selection = items.find((item) => item.id === selectedId) ?? null;
	// items が変わっても「調整」は一切不要。
	// 選択中の ID がリストに残っていれば選択は維持され、
	// 消えていれば自動的に null になる。
}
```

`selection` という state を消したことで、**「prop が変わったら state を直さなければ」という問題自体が消滅**しています。優先度2以降に進む前に、まずこの設計変更が可能かを疑うのが React の作法です。

> ⚠️ ただし、この節の `NameField`（ユーザーが編集する入力欄）には**優先度1は使えません**。draft の値はユーザーの入力によって決まるもので、props から計算できないためです。だからこそ優先度2以降の話になります。

つまり、まず「render 中に計算できないか」「`key` で component をリセットできないか」を検討する。どうしても**1つのローカル state だけ**を prop の変化に合わせる必要がある場合に限り、**前回の render の情報と現在の prop を比較する**方法が文書化されています。

```tsx
function NameField({ name }: { name: string }) {
	const [previousName, setPreviousName] = useState(name);
	const [draft, setDraft] = useState(name);

	if (name !== previousName) {
		setPreviousName(name);
		setDraft(name);
	}

	return (
		<input
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
		/>
	);
}
```

ガードされた setter が、新しい prop から導いた state で **現在の render をリトライ**するよう React に依頼します（[adjusting state during render](https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)）。React は返された JSX を破棄して即座に再 render するため、子はまだ render されておらず DOM も更新されていません。結果として、**effect が修正する前に古い値を commit してしまうのを避けられます。**

#### ⚠️ ただし、これは「推奨パターン」ではなく「最終手段」

Solid 公式ドキュメントはこのパターンを「React でもこう書ける」という比較対象として引いていますが、**React 公式自身は同じ箇所で強い留保を付けています。**

- **前回の render の情報を保持するこの書き方は理解しづらい**が、同じ state を Effect で更新するよりはマシ、という位置づけ。
- **「このパターンは Effect より効率的だが、ほとんどの component にはこれも必要ないはず」** と明言されている。
- props や他の state から state を調整すること自体が、**data flow を追いにくくデバッグしにくくする**。まず `key` でのリセットか render 中の計算ができないか常に確認せよ、とされている。

制約もあります。

- **自分自身の component の state しか更新できない**（他 component の setter を render 中に呼ぶとエラー）。
- **`name !== previousName` のようなガードは無限ループを避けるために必須**。
- DOM 操作や `setTimeout` などの**副作用は書けない**（component の純粋性を保つため、イベントハンドラか Effect に置く）。

したがって、`NameField` のような「prop が変わったら入力欄をリセットする」ケースなら、**React では `key` を使う方が素直**です。

```tsx
// ✅ React でより一般的な書き方: prop が変わったら component ごと作り直す
<NameField key={name} name={name} />;

function NameField({ name }: { name: string }) {
	const [draft, setDraft] = useState(name); // key が変わると初期化される
	// ...
}
```

📌 **ここが Solid との対比のポイント**です。React では「render 中の state 調整」も「`key` によるリセット」も、**component の再実行や再マウントという単位でしか表現できません**。次の Solid 版は、component の実行単位を一切動かさずに同じ意味論を表現します。「最終手段だから避けよう」ではなく、**そもそも最終手段が必要にならない**のが Solid 側の主張です。

### Solid

`createSignal` に**関数を渡す**と、**writable derived signal（書き込み可能な派生 signal）** になります。

```tsx
function NameField(props: { name: string }) {
	const [draft, setDraft] = createSignal(() => props.name);

	return (
		<input
			value={draft()}
			onInput={(event) => setDraft(event.currentTarget.value)}
		/>
	);
}
```

- **derivation**（＝ここでは `() => props.name` という**派生の仕組み**そのもの。§0.1 参照）が `props.name` を供給し続ける。
- `setDraft` が呼ばれると、その上に**ローカルな override（上書き）** が載る。
- derivation の依存が変わると、**source が次の値を生成し、その override を置き換える**。
- **同期用の effect も、前回 prop の記録も不要。**

イメージとしては「**下に derivation が流れ続けていて、その上に override という蓋をかぶせられる**」構造です。

```
通常時:  props.name ──[derivation]──> draft()      … 蓋なし。propsが素通り
編集後:  props.name ──[derivation]──╳ override ──> draft()   … 蓋がかぶさる
prop変化: props.name ──[derivation]──> draft()      … 蓋が外れ、新しい値になる
```

> ⚠️ 関数形式は「**writable derivation**」という意味であり、**その関数自体が signal の値として保存されるわけではない**。
> ネストしたフォーム state で同じパターンを使いたい場合は **`createStore` の関数形式** を使う。

---

## 7. Effect を「責務」で読み替える

- **React**: 命令的な effect コールバック + **依存配列（dependency array）** のペア。
- **Solid**: **tracked な compute 関数**がリアクティブな読み取りを通じて依存を発見し、その結果を **untracked な apply 関数**に渡す。

**React**

```tsx
useEffect(() => {
	const connection = connect(roomId);
	return () => connection.close();
}, [roomId]);
```

**Solid**

```tsx
import { createEffect } from "solid-js";

createEffect(
	() => props.roomId,
	(roomId) => {
		const connection = connect(roomId);
		return () => connection.close();
	}
);
```

- **compute 関数**: effect をトリガーすべきリアクティブな依存を**すべて読む**。
- その**返り値が apply 関数の入力**になる。
- **apply 関数**: 命令的な処理を行い、cleanup を返せる。
- **apply 関数の中の読み取りは依存にならない。**

### すべての React effect が Solid effect になるわけではない

| React で effect にしていたもの | Solid での置き換え |
|---|---|
| レンダリングされる値の計算 | **関数または memo** |
| 特定のインタラクションに紐づく処理 | **それを観測したイベントハンドラの中で開始する** |
| 非同期の派生データ | **async memo または store projection** |
| 確定したリアクティブな結果を Solid 外部の命令的システムに反映 | **effect（これが本来の用途）** |

> この「責務による切り分け」の方が、依存配列を機械的に翻訳するより有用です。

📌 **React 脳の落とし穴 #3**: 依存配列を `createEffect` の第1引数に「翻訳する」感覚は近いのですが、compute / apply の分離により **「何が再実行のトリガーか」が構文レベルで明示される**点が本質です。

---

## 8. props のリアクティビティを壊さない

- **React**: props は「その render 時点の値」なので、分割代入（destructuring）が一般的。
- **Solid**: 変化しうる props は **getter に backing されている**可能性がある。子は、**tracking scope がその prop にアクセスした時点で現在の値を読む**。

### 8.1 なぜ Solid の props は getter なのか

ここは §1 の実行モデルから必然的に導かれます。

**React の props は「スナップショット」です。** component は render のたびに再実行されるので、`props` オブジェクトも毎回新しく作られます。「今回の render 時点での値」が入った、ただのプレーンなオブジェクトです。だから分割代入しても何も失われません。次の値が必要になれば、また component ごと再実行されるからです。

**Solid の component は1回しか実行されません。** ということは、`props` オブジェクトも1回しか作られません。もし `props` が「その時点の値」を持つプレーンなオブジェクトだったら、**親で値が変わっても子は永遠に古い値を見続ける**ことになります。

そこで Solid のコンパイラは、**props を「値の入れ物」ではなく「値を取りに行く窓口」として作ります。**

```tsx
// あなたが書くコード
<Greeting name={user().name} />
```

```js
// コンパイラが生成するもの（イメージ）
Greeting({
	get name() {
		return user().name;   // ← アクセスされるたびに実行される
	},
});
```

つまり `props.name` は、見た目こそプロパティアクセスですが、**実質は関数呼び出し**です。`count()` を呼ぶのと同じことが `.name` という書き方で起きています。

ここから2つの重要な帰結が出ます。

1. **`props.name` を読んだ場所が、その値を購読する。** JSX の中で読めば、その JSX 式がグラフのノードとして繋がります（§5.0）。
2. **どこで読むかが決定的に重要。** tracking scope の外で読めば、購読は発生せず、その瞬間の値を1回取っただけで終わります。

> 💡 補足: **すべての props が getter になるわけではありません。** `<Greeting name="Ada" />` のようにリテラルを渡した場合は、コンパイラは getter を作る必要がないのでただの値になります。原文が「**potentially changing** props may be backed by getters（変化しうる props は getter に backing されている**可能性がある**）」と歯切れの悪い書き方をしているのはこのためです。
>
> **子 component 側からは、それが getter かただの値か区別できません。** したがって「常に getter かもしれない」と想定して書くのが唯一安全な方針になります。

### 8.2 原則: 値が変わりうるなら props オブジェクトを壊さない

```tsx
function Greeting(props: { name: string; punctuation?: string }) {
	return (
		<p>
			Hello, {props.name}
			{props.punctuation ?? "."}
		</p>
	);
}
```

`props.name` と `props.punctuation` の読み取りが **JSX の中にある**ため、それぞれが tracking scope 内で実行され、正しく購読されます。

📌 デフォルト値が必要なときも、React のように引数側で `{ punctuation = "." }` とはせず、**読む場所で `?? "."` と書く**のがこの形の帰結です。読み取りを JSX の中に留めたまま既定値を与えられます。

### 8.3 引数での分割代入 = setup 時に読み切る

```tsx
function Greeting({ name }: { name: string }) {
	return <p>Hello, {name}</p>;
}
```

これが壊れる理由は、上の getter の話でそのまま説明できます。

- 引数の分割代入は、**component 関数が呼ばれた瞬間**（＝ setup 時、たった1回）に `props.name` の getter を実行する。
- しかも component 本体は **untracked** で走るため（§1.3）、**購読も張られない**。
- 結果、`name` は「mount 時点の文字列」という**ただの死んだローカル変数**になる。以後 `user().name` が何度変わっても `<p>` は更新されない。

原文の表現を並べるとこうなります。

| 原文 | 意味 |
|---|---|
| **destructuring reads getter-backed props eagerly** | 分割代入は getter を**その場で（先走って）** 実行してしまう |
| **reads those values at component setup time** | 読み取りが **setup 時（1回きり）** に固定される |
| **development warning when a component reads reactive values at the top level** | component のトップレベルでリアクティブな値を読むと **開発時に警告**が出る |

> **1回きりの値であることが意図的な場合のみ**この形を使ってください。たとえば「初期値としてだけ使う」「mount 時の設定を1度読むだけ」といったケースです。

### 8.4 OK / NG 早見表

| 書き方 | 判定 | 理由 |
|---|---|---|
| `<p>{props.name}</p>` | ✅ | JSX 内＝ tracking scope で読んでいる |
| `<Child name={props.name} />` | ✅ | JSX 内。コンパイラが再び getter で包んで子に渡す |
| `props.items.map(...)` を JSX 内で | ✅ | 読み取り自体は tracking scope 内（リストは `For` 推奨、§11） |
| `onClick={() => save(props.id)}` | ✅ | ハンドラ実行時に現在値を読む。購読しないのが正しい挙動（§9） |
| `const name = () => props.name` | ✅ | 読み取りが関数の中。呼ばれた場所の tracking scope で実行される |
| `createMemo(() => props.name)` | ✅ | memo という tracking scope の中で読んでいる |
| `function C({ name })` | ❌ | setup 時に1回読んで固定される |
| `const { name } = props;`（本体先頭） | ❌ | 同上 |
| `const name = props.name;`（本体先頭） | ❌ | 同上。分割代入でなくても同じこと |
| `if (props.isOpen) { ... }`（本体先頭） | ❌ | 条件判定が1回きりになる。JSX 側か `Show` で分岐する |

**覚え方は1つだけです。**

> **`props.` という文字列を、component 本体のトップレベルに書かない。**
> **JSX の中・関数の中・memo の中・effect の compute 関数の中でだけ書く。**

📌 **React 脳の落とし穴**: React では引数の分割代入が推奨スタイルですらありました。Solid ではこれが**最も頻度の高いバグ**になります。「props は分割代入しない」を最初に手癖として上書きしてください。

### 8.5 ローカルな名前をつけつつリアクティブさを保つなら memo

```tsx
function Greeting(props: { first: string; last: string }) {
	const name = createMemo(() => `${props.first} ${props.last}`);
	return <p>Hello, {name()}</p>;
}
```

「毎回 `props.first` `props.last` と書くのは冗長だから `name` という名前を付けたい」という要求に対する答えです。**値ではなく accessor に名前を付ける**ことで、リアクティブさを保ったままローカル名を導入できます。

なお、これは §5 の使い分けがそのまま適用されます。

```tsx
// 軽い派生を1箇所で使うだけなら、ただの関数でも十分
const name = () => `${props.first} ${props.last}`;
```

`createMemo` を選ぶのは、計算が高コストな場合、複数箇所で読む場合、または equality boundary を置きたい場合です。

> 💡 複数の props をまとめて扱いたい（既定値のマージ、props の分割など）ケース向けに、Solid には専用のヘルパーが用意されています。本ガイドの原文では扱われていないため、必要になったら公式 reference を参照してください。手で `const { a, b } = props` と分割するのだけは避けてください。

---

## 9. イベントとフォームコントロール

- イベント prop は **camelCase のまま**（`onClick`, `onInput`）。
- Solid のハンドラは **native な DOM イベント**を受け取る。
- **`event.currentTarget` は、そのハンドラを持つ要素として型付けされる。**

**React**

```tsx
const [query, setQuery] = useState("");

return (
	<input
		value={query}
		onChange={(event) => setQuery(event.currentTarget.value)}
	/>
);
```

**Solid**

```tsx
const [query, setQuery] = createSignal("");

return (
	<input
		value={query()}
		onInput={(event) => setQuery(event.currentTarget.value)}
	/>
);
```

- **`onInput`** は、ブラウザの input イベントを**都度**観測する（React の `onChange` に相当する使い心地）。
- **`onChange`** は、**native な change イベントのタイミングが意図した挙動である場合**に使う。
- **イベントハンドラは reactive tracking の外で実行される。** → signal / store の現在値を、購読せずに読める。

### 9.1 「reactive tracking の外で実行される」とは

**「ハンドラが走っている間、tracking scope が有効になっていない」** という意味です（§1.3）。

したがってハンドラの中で `count()` を読むと、次の2つが同時に成り立ちます。

1. **現在の値がちゃんと読める。**（古い値ではない）
2. **購読（グラフの辺）は張られない。**（§5.0）

```tsx
const [count, setCount] = createSignal(0);

<button
	onClick={() => {
		console.log(count()); // ← 常に「今の」値。しかし購読は発生しない
		setCount(count() + 1);
	}}
>
	増やす
</button>;
```

#### なぜ購読されないのが「正しい」のか

もしハンドラが `count` を購読してしまったら、**`count` が変わるたびにハンドラが勝手に再実行される**ことになります。それは明らかに間違いです。

ハンドラが走るべき理由は **「ユーザーが操作したから」** であって、**「データが変わったから」** ではありません。この区別は §7 の「effect にすべきか、イベントハンドラにすべきか」と同じ原則です。Solid はこれをランタイムのレベルで保証しています。

#### 📌 React 経験者にとっての一番のご利益: stale closure が消える

React では、イベントハンドラは**それが作られた render 時点の値をクロージャに閉じ込めます**。

```tsx
// React: 有名な落とし穴
const [count, setCount] = useState(0);

function handleClick() {
	setTimeout(() => {
		console.log(count); // ← 3秒前の値。クリック当時の count が焼き付いている
	}, 3000);
}
```

React ではこれを回避するために、更新関数形式 `setCount(c => c + 1)`、`useRef`、依存配列の管理、`useEffectEvent` といった道具が必要でした。

**Solid にはこの問題が存在しません。** `count` は変数ではなく **accessor（関数）** なので、クロージャが閉じ込めるのは「値」ではなく「読みに行く手段」です。呼んだ瞬間の最新値が返ります。

```tsx
// Solid: そのまま書けばよい
function handleClick() {
	setTimeout(() => {
		console.log(count()); // ← 3秒後の「今」の値
	}, 3000);
}
```

#### 副産物: `useCallback` に相当するものが要らない

React では、ハンドラは render のたびに再生成されるため、メモ化された子への参照安定性のために `useCallback` で包む必要がありました。

**Solid では component 本体が1回しか走らないので、ハンドラ関数はそもそも1回しか作られません。** 参照は最初から安定していて、`useCallback` に相当する API は不要です。

### 9.2 React と Solid、どちらのパターンが良いか

「どちらが優れているか」は目的によりますが、**客観的な差**は整理できます。

| 観点 | React | Solid 2.0 |
|---|---|---|
| イベント名 | 独自の合成イベント。`onChange` が実際には native の `input` に対応する | **native な DOM イベントそのまま**。`onInput` は input、`onChange` は change |
| 学習コスト | React 固有の対応表を覚える必要がある | **MDN の知識がそのまま使える** |
| 入力のたびに起きること | component 全体が再実行され、差分計算を経て DOM に反映 | **該当の DOM プロパティだけを直接更新** |
| 大きなフォームでの負荷 | フィールド数に比例して再実行コストが増える | **フィールド単位で独立**しているため影響を受けにくい |
| stale closure | 起こりうる（対策の道具が必要） | **原理的に起こらない** |
| 非 React/Solid コードとの相互運用 | 合成イベント層の癖を意識する必要がある | native なので素直 |

**Solid を書くなら Solid のやり方に従うのが答えです。** React の `onChange` の手癖をそのまま持ち込むと、Solid の `onChange` は native の change（フォーカスが外れた時など）なので、**「入力しても反応しない」というバグ**になります。移行時に最も踏みやすい地雷の1つです。

- React の `onChange` → Solid では **`onInput`**
- native の change のタイミングが本当に欲しいときだけ **`onChange`**

#### ⚠️ 挙動の違いに注意: 「controlled component」の意味が違う

React の controlled input は、**再レンダリングのたびに DOM の値を state の値へ強制的に戻します**。そのため、ハンドラで state を更新しなければ入力が弾かれます（入力制限の実装によく使われる挙動）。

Solid の `value={query()}` は、**`query` が変化したときにその DOM プロパティを書くだけ**です。signal を更新しなければ書き込みも起きないので、**ユーザーが打った文字はそのまま残ります**。

```tsx
// React: 数字以外は入力できない（state が変わらず、DOM が巻き戻される）
<input value={v} onChange={(e) => {
	if (/^\d*$/.test(e.target.value)) setV(e.target.value);
}} />

// Solid: 同じコードだと数字以外も画面に残ってしまう
// → 弾きたいなら DOM 側を明示的に戻す必要がある
<input value={v()} onInput={(e) => {
	if (/^\d*$/.test(e.currentTarget.value)) setV(e.currentTarget.value);
	else e.currentTarget.value = v(); // 明示的に巻き戻す
}} />
```

これは Solid の欠陥ではなく、**「再レンダリングという工程が存在しないこと」の当然の帰結**です。React の入力制限パターンを移植するときは意識してください。

---

## 10. DOM プロパティと style の書き換え

大半の JSX 属性はそのまま使えますが、DOM 寄りの部分に差があります。

| React | Solid |
|---|---|
| `className` | **`class`** |
| — | `class` prop は **文字列 / 条件オブジェクト / ネストした配列** を受け取れる |
| `style={{ backgroundColor }}`（JS 名） | **CSS 名**: `style={{ "background-color": ... }}` |
| 数値に自動で `px` が付く | **数値の style 値に単位は自動付与されない** |
| — | エスケープ済みのテキストのみなら **`textContent`**、`innerHTML` は**信頼できる / sanitize 済みのマークアップにのみ**使う |

```tsx
<button
	class={["button", { active: selected(), pending: saving() }]}
	style={{
		"background-color": props.background,
		"inline-size": `${props.width}px`,
	}}
>
	Save
</button>
```

---

## 11. 条件分岐とリスト

### 前提

- JavaScript の三項演算子・論理演算子は **Solid JSX でそのまま動く**。JSX コンパイラがこの native な control-flow 構文を認識し、**リアクティブな conditional を生成する**。
- `map` などの配列メソッドも有効な JSX を返す。ただし**ただの関数呼び出し**なので、**コンパイラは行の identity や lifecycle を推論できない**。そこで Solid のリスト component が更新のセマンティクスを明示する。

### 条件付きコンテンツ

三項演算子はそのままの形を保てる（accessor 呼び出しに変わるだけ）:

```tsx
return <>{user() ? <Profile user={user()!} /> : <SignIn />}</>;
```

コンパイラが `user()` を track し、真偽が変わったら active な branch を更新します。

**明示的な fallback / narrow された値 / identity の制御** が欲しいときは [`Show`](https://v2.solidjs.com/reference/solid-js/components-jsx/show):

```tsx
import { Show } from "solid-js";

return (
	<Show when={user()} fallback={<SignIn />}>
		{(currentUser) => <Profile user={currentUser()} />}
	</Show>
);
```

- **デフォルト**: truthy の変化をまたいで **子を保持**し、**narrow された accessor** を関数の子に渡す。
- **`keyed` を付けると**: **生の値**を渡し、**値の identity が変わったら子を remount する**。

#### 先に用語: identity と remount

**identity（同一性）** = **オブジェクトとしての参照**のことです。JavaScript の `===` で比べたときに同じかどうか、と考えて構いません。

```js
const a = { id: 1, name: "Ada" };
const b = { id: 1, name: "Ada" };
a === b; // false ← 中身は同じでも identity は別
```

**remount（再マウント）** = **既存の DOM とその中の状態を丸ごと捨てて、作り直すこと**です。React の `key` を変えたときに起きることと同じで、次のことが起こります。

- 子 component の関数が**もう一度 setup から実行される**
- 子が持っていた**ローカル state が初期値に戻る**
- DOM 要素が**作り直される**（スクロール位置やフォーカス、入力途中の文字なども失われる）

#### デフォルトの `Show`: 子を「保持」する

`when` が truthy である限り、**中身は作り直されません。**

```tsx
function Profile(props: { user: User }) {
	const [tab, setTab] = createSignal("posts"); // ← ローカル state
	return (
		<>
			<h1>{props.user.name}</h1>
			<TabBar value={tab()} onChange={setTab} />
		</>
	);
}

<Show when={user()} fallback={<SignIn />}>
	{(currentUser) => <Profile user={currentUser()} />}
</Show>;
```

ここで `user()` が Ada から Grace に切り替わったとき、**デフォルトでは:**

- `Profile` は **remount されない**。`Profile` 関数は再実行されない。
- `tab` の値（`"posts"` など、ユーザーが選んでいたタブ）は **そのまま残る**。
- `props.user.name` を読んでいる `<h1>` の中身**だけ**が更新される。

つまり **`Show` が見ているのは「truthy かどうか」だけ**で、中身の値が別物に変わっても、真偽が変わらない限り子はそのまま生き続けます。

#### `narrow された accessor` とは

上の例で子に渡ってくる `currentUser` は **accessor（関数）** です。「narrow された」というのは **TypeScript の型の絞り込み（narrowing）** を指しています。

```tsx
const [user] = createSignal<User | null>(null);

// ❌ 三項演算子だと、TS は「JSX の中で再評価される」ことを理解できない
<>{user() ? <Profile user={user()!} /> : <SignIn />}</>
//                                ^ 非 null アサーションが必要になる

// ✅ Show なら currentUser() の型は User（null が除かれている）
<Show when={user()} fallback={<SignIn />}>
	{(currentUser) => <Profile user={currentUser()} />}
</Show>
```

`Show` は「`when` が truthy だったときだけ子を呼ぶ」ことを型の上でも表現できるため、**`!` を書かずに済みます**。三項演算子でも動作自体は正しいのですが、型の面倒を見てくれるのが `Show` の利点です。

#### `keyed` を付けた `Show`: identity が変わったら作り直す

```tsx
<Show when={user()} keyed fallback={<SignIn />}>
	{(currentUser) => <Profile user={currentUser} />}
	{/*                          ↑ accessor ではなく「生の値」 */}
</Show>
```

`keyed` を付けると挙動が2つ変わります。

1. 子に渡るのが **accessor ではなく生の値**になる（`currentUser()` ではなく `currentUser`）。
2. **値の identity（参照）が変わるたびに子が remount される。**

先ほどの例で `user()` が Ada から Grace に変わると、**`keyed` ありでは:**

- `Profile` が **remount される**。`Profile` 関数が最初から実行し直される。
- `tab` は **`"posts"` に初期化される**。

#### どちらを使うか

| やりたいこと | 選ぶもの |
|---|---|
| 表示する値が変わっても、中の state や DOM を維持したい | **デフォルト**（`keyed` なし） |
| 別の対象に切り替わったら、中を完全にリセットしたい | **`keyed`** |
| ただ「あるか / ないか」で出し分けたいだけ | **デフォルト** |

例えば「ユーザー A の編集フォームを開いていて、ユーザー B に切り替えた」場合、**A の入力途中の内容が B のフォームに残っていたら困ります。** こういうときが `keyed` の出番です。

📌 **React での対応関係**: `keyed` は **React で `<Profile key={user.id} />` と書くのとほぼ同じ意図**です。React の `key` も「identity が変わったら作り直せ」という指示でした（§6 の優先度2で出てきたリセット手法と同じ考え方）。

> ⚠️ 迷ったら **デフォルト（`keyed` なし）** を選んでください。remount は DOM の作り直しを伴うぶんコストが高く、Solid の「必要な箇所だけを更新する」という利点を打ち消します。**「リセットしたい」という明確な理由があるときだけ `keyed` を付ける**、が原則です。

### リストコンテンツ

**React** は `map` + `key` が一般的:

```tsx
return todos.map((todo) => <TodoRow key={todo.id} todo={todo} />);
```

**Solid** でも直接の `map` はレンダリングされる:

```tsx
return (
	<>
		{todos().map((todo) => (
			<TodoRow todo={todo} />
		))}
	</>
);
```

しかし `map` はただの関数呼び出しなので、**この式が再評価されるたびに、map された行の出力が作り直される**。

リアクティブなリストには [`For`](https://v2.solidjs.com/reference/solid-js/components-jsx/for) を使い、**明示的な identity mode** に従って行を保持させます:

```tsx
import { For } from "solid-js";

return (
	<For each={todos()} keyed={(todo) => todo.id}>
		{(todo) => <TodoRow todo={todo()} />}
	</For>
);
```

- React の `key` と Solid の `keyed` は、どちらも **行の identity** を表現する。
- **`For` のデフォルトは item identity**（要素の参照そのもの）。
- **`keyed={false}`** にすると **positional identity**（位置ベース）。
- 上例のように **key 関数**も指定できる。
- 子に渡ってくる `todo` は **accessor**（`todo()` と呼ぶ）である点に注意。

### `Repeat`

[`Repeat`](https://v2.solidjs.com/reference/solid-js/components-jsx/repeat) は、**store に対する positional なレンダリング**を、**配列要素や identity の diff なし**で行うためのもの。

- `from` と `count` prop で **sliding window（スライドする窓）** を表現でき、**絶対 index が重なる範囲に残る行は保持される**。

#### これは何をするものか

一言でいうと、**「配列の中身を見ずに、番号だけで行を並べる」** ための component です。

`For` は「どんな要素が入っているか」を起点に描画しますが、`Repeat` は **「何番目から何個」** という数値だけを起点に描画します。Solid 2.0 では、指定した回数だけ JSX ブロックを宣言的に描画する component として `Repeat` が新設されました。

```tsx
// ※ 子に渡る引数の正確な型は公式 reference で確認してください
<Repeat from={0} count={10}>
	{(index) => <div>{index()} 番目</div>}
</Repeat>
```

配列の中身は **`Repeat` 自身は一切見ません。** 実データが必要なら、渡ってきた index を使って**自分で store から読みます**。

```tsx
<Repeat from={0} count={items.length}>
	{(index) => <Row item={items[index()]} />}
	{/*                 ↑ store から自分で引く */}
</Repeat>
```

これが「**store に対する** positional なレンダリング」の意味です。store はプロパティ単位で購読されるので（§4）、**各行は自分の要素だけを購読**します。配列全体を比較しなくても、行ごとの更新が正しく効きます。

#### 3つのリスト描画を比べる

| | 何を基準に行を対応づけるか | 行が保持される条件 | diff の有無 |
|---|---|---|---|
| `For`（デフォルト） | **item identity**（要素の参照） | 同じ値が存在し続ける限り。位置が変われば**移動**で済ませる | **あり**（新旧の配列を突き合わせる） |
| `For keyed={false}` | **位置**（0番目、1番目…） | その位置が存在し続ける限り | あり |
| `Repeat` | **絶対 index**（`from`〜`from+count`） | その **index が新旧の範囲で重なる**限り | **なし** |

📌 Solid 1.x を知っている場合の注意: 専用の `Index` component は廃止され、その非 keyed なリスト機能は `<For keyed={false}>` に統合されました。`Repeat` は `Index` の後継ではなく、**別の役割**を持つ新しい部品です。

#### 「diff なし」が効く場面 = 仮想スクロール

`from` / `count` と「絶対 index の重なり」の話は、**仮想スクロール（virtual scrolling）** を思い浮かべると一気に腑に落ちます。

10万件のリストのうち、画面には20行しか映っていないとします。

```tsx
<Repeat from={startIndex()} count={20}>
	{(index) => <Row item={items[index()]} />}
</Repeat>
```

ユーザーが少しスクロールして、表示範囲が **100〜119 番から 105〜124 番** に移ったとします。

```
スクロール前:  [100][101][102][103][104][105][106]...[119]
スクロール後:                      [105][106]...[119][120]...[124]
                                    └──── 重なる範囲 ────┘
```

このとき `Repeat` は次のように振る舞います。

- **105〜119**: 絶対 index が新旧どちらの範囲にも入っている → **その行はそのまま保持**（DOM も、行が持つローカル state も作り直さない）
- **100〜104**: 範囲から外れた → 破棄
- **120〜124**: 新しく範囲に入った → 生成

**ここで配列の突き合わせは一度も行われません。** 数値の範囲を比べるだけで済むからです。

もし `For` でこれをやると、新旧の配列を比較して「どの要素が移動したか / 増えたか / 減ったか」を判定する必要があり、スクロールのたびにそのコストがかかります。**`Repeat` はその diff 工程ごと消し去ります。**

#### 使い分けの目安

| 状況 | 選ぶもの |
|---|---|
| 通常のリスト（追加・削除・並べ替えが起きる） | **`For`**（デフォルト） |
| 順序が固定で、中身だけが差し替わる | **`For keyed={false}`** |
| 固定数のスロットを並べたい（星5つの評価、ページャなど） | **`Repeat`** |
| 仮想スクロール / ウィンドウ表示 | **`Repeat`**（`from` をスクロール位置に連動させる） |

> ⚠️ `Repeat` は**位置ベース**なので、行の identity を追いません。配列の途中に要素を挿入すると、**それ以降の行は「別のデータを表示する同じ行」になります**（行を作り直すのではなく、中身が入れ替わる）。並べ替えや挿入が起きるリストには向きません。そういう場合は `For` を使ってください。

📌 **React での対応物はありません。** React で仮想スクロールを実装する場合、`react-window` などのライブラリか、`key` を工夫した `slice().map()` を書くことになります。`Repeat` は**その用途をフレームワーク側の部品として持っている**、と捉えると位置づけが分かりやすいはずです。

---

## 12. Context で state を共有する

どちらも「値を子孫にスコープする」点は同じ。**Solid では context オブジェクト自体が provider component でもある**のが違いです。

```tsx
import {
	type Accessor,
	type Element,
	type Setter,
	createContext,
	createSignal,
	useContext,
} from "solid-js";

type Theme = "light" | "dark";
type ThemeContextValue = {
	theme: Accessor<Theme>;
	setTheme: Setter<Theme>;
};

const ThemeContext = createContext<ThemeContextValue>();

function ThemeProvider(props: { children: Element }) {
	const [theme, setTheme] = createSignal<Theme>("light");

	return (
		<ThemeContext value={{ theme, setTheme }}>{props.children}</ThemeContext>
	);
}

function ThemeButton() {
	const { theme, setTheme } = useContext(ThemeContext);

	return (
		<button
			onClick={() =>
				setTheme((value) => (value === "light" ? "dark" : "light"))
			}
		>
			Current theme: {theme()}
		</button>
	);
}
```

ポイント:

- `<ThemeContext.Provider>` ではなく **`<ThemeContext value={...}>`**。
- **default 値を持たない context は、provider に囲まれていない場所で読まれると throw する。**
- 子孫がリアクティブな state を必要とするなら、**signal / store / service オブジェクト**を context 経由で渡す。
- サブツリーへのスコープが不要な**アプリケーション全体の state**なら、**module レベルの signal / store** で足りる。
- `useContext` の戻り値を分割代入するのは OK（signal 自体は関数として渡っているため、リアクティビティは失われない）。

### 12.1 API の形の違い

| | React | Solid |
|---|---|---|
| 作成 | `createContext(defaultValue)` | `createContext<T>()`（既定値は任意） |
| provider | `<Ctx.Provider value={...}>` | **`<Ctx value={...}>`**（context 自体が provider） |
| 読み取り | `useContext(Ctx)` | `useContext(Ctx)`（同じ） |

📌 **実は React 19 でも `<Ctx value={...}>` と書けるようになりました**（`Context` をそのまま provider として render できる）。この点は両者が寄ってきています。移行時に驚くポイントではありません。

### 12.2 最大の違い: 「context が変われば consumer が再レンダリング」が存在しない

React の context を使ったことがあるなら、**このパフォーマンス問題**に必ず遭遇しているはずです。

```tsx
// React: よくある落とし穴
function ThemeProvider({ children }) {
	const [theme, setTheme] = useState("light");

	// 🔴 render のたびに新しいオブジェクトが作られる
	//    → context の値の identity が変わる
	//    → すべての consumer が再レンダリングされる
	return (
		<ThemeContext.Provider value={{ theme, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}
```

React でこれを回避するために編み出された定番テクニックを思い出してください。

- `useMemo` で value オブジェクトを固定する
- **context を分割する**（値用と setter 用を別 context にする）
- `use-context-selector` のようなライブラリを入れる
- そもそも context をやめて Zustand / Jotai などの外部ストアを使う

**Solid ではこれらが1つも必要ありません。**

```tsx
function ThemeProvider(props: { children: Element }) {
	const [theme, setTheme] = createSignal<Theme>("light");

	// この {{ theme, setTheme }} は component が1回しか走らないので
	// 「1回だけ」作られ、以後 identity は永久に変わらない
	return <ThemeContext value={{ theme, setTheme }}>{props.children}</ThemeContext>;
}
```

理由は §1 の実行モデルから直に出てきます。

- **component は1回しか実行されない** → value オブジェクトも1回しか作られず、**identity が変わることがない**。
- **リアクティビティはオブジェクトの中の signal を通じて流れる** → context の「値そのもの」は変化する必要がない。
- 結果、更新されるのは **`theme()` を読んでいる JSX 式だけ**。context を読んだ component 全体ではない。

| | React | Solid |
|---|---|---|
| 値が変わったとき動くもの | **すべての consumer component**（再レンダリング） | **`theme()` を読んだ式だけ** |
| `useMemo` での value 固定 | ほぼ必須 | **不要** |
| 値用と setter 用の context 分割 | 定番の最適化 | **不要** |
| context selector ライブラリ | 必要になることがある | **不要** |

📌 **これは Solid の context が優れているというより、context の「粒度」問題が実行モデルごと消えている**と捉えるのが正確です。React の再レンダリングという工程が存在しないので、そこに紐づく最適化も存在しません。

### 12.3 provider の外で読んだときの挙動

ここも実務上ありがたい差です。

**React**: `createContext(defaultValue)` の既定値が**黙って返ります**。provider を付け忘れていても**エラーにならず、なぜか初期値のまま動く**という発見しづらいバグになります。そのため、多くのコードベースで次のような自前ガードを書くのが定番でした。

```tsx
// React: 自分で throw させる定番パターン
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
	return ctx;
}
```

**Solid**: `createContext<T>()` と**既定値なしで作れば、provider の外で読まれた時点で throw します。** 上のようなラッパーを書かなくても、**型の上でも `undefined` を含まない**ので `if (!ctx)` のガードが不要です。

> 既定値を渡した場合は React と同様、provider がなければその既定値が返ります。**「provider 必須」を表明したいなら既定値を渡さない**、という設計判断になります。

### 12.4 context に「何を」渡すか

ここは React から移ってきて一番間違えやすい部分です。

```tsx
// ❌ 値そのものを渡す
<ThemeContext value={theme()} >

// ✅ accessor / setter / store を渡す
<ThemeContext value={{ theme, setTheme }}>
```

理由は §8 の props の話と同じ構造です。`useContext(ThemeContext)` は **component 本体（untracked かつ1回きり）で呼ばれます**。したがって、そこで受け取ったものが「その瞬間の値」だと、**以後永久に更新されません**。

受け取ったものが **accessor（関数）や store（proxy）といった「読みに行く手段」** であれば、子は JSX の中で好きなタイミングで読めます。原文が **「signals, stores, or service objects を渡せ」** と書いているのはこの意味です。

📌 **React の感覚との違い**: React では `value={{ theme, setTheme }}` の `theme` は**値**でした。Solid では `theme` は**関数**です。渡すものの中身が「値」から「値への参照手段」に変わる、というのがこの章の本質です。

### 12.5 module レベルの state という選択肢

原文の「サブツリーへのスコープが不要なら module レベルの signal / store で足りる」は、React 経験者には少し過激に聞こえるかもしれません。

**React では module レベルの変数を state として使うのは基本的に不可能**でした。component がその変化を知る術がないためで、`useSyncExternalStore` を使うか、Zustand などのライブラリを入れる必要があります。

**Solid では単に動きます。**

```tsx
// store.ts —— どの component にも属さない
export const [theme, setTheme] = createSignal<Theme>("light");

// 任意の component から
import { theme, setTheme } from "./store";

function ThemeButton() {
	return <button onClick={() => setTheme("dark")}>{theme()}</button>;
}
```

JSX が直接 signal を購読するので、**provider も hook も外部ライブラリも要りません。** Solid の「状態管理ライブラリがあまり流行らない」理由の一端がこれです。

> ⚠️ ただし **SSR では注意が必要**です。module レベルの state はサーバー上で**全リクエストに共有される**ため、ユーザー固有のデータを置くと情報漏洩になります。SSR 環境では、リクエストごとにスコープされる context を使ってください。

#### では component レベルの `createSignal` に意味はあるのか

**大いにあります。むしろこちらが基本です。** module レベルが使えるからといって、何でもそこに置くのは React で言えば「全部 Redux に入れる」のと同じ失敗です。

決定的な差は **「インスタンスごとに独立しているか」** と **「いつ消えるか」** の2点です。

**① インスタンスごとの独立**

module レベルの signal は、アプリ全体で**たった1個**です。同じ component を2箇所で使うと、**state が共有されてしまいます**。

```tsx
// 🔴 module レベルに置いた場合
export const [isOpen, setIsOpen] = createSignal(false);

function Accordion(props: { title: string }) {
	return <Show when={isOpen()}>{/* ... */}</Show>;
}

// 2つ並べると…
<Accordion title="送料について" />
<Accordion title="返品について" />
// → 片方を開くと両方開く
```

```tsx
// ✅ component レベルに置く
function Accordion(props: { title: string }) {
	const [isOpen, setIsOpen] = createSignal(false); // 各インスタンスが自分の signal を持つ
	return <Show when={isOpen()}>{/* ... */}</Show>;
}
```

リストの各行、モーダル、タブ、フォームのフィールドなど、**「同じものが複数存在しうる UI」はすべてこちらです。**

**② lifetime（いつ消えるか）**

component 内で作った signal は、その component と運命を共にします。unmount されれば参照が失われて破棄され、次にマウントされたときは初期値から始まります。**owner に紐づく computation や cleanup も一緒に破棄されます**（§2）。

module レベルの signal は **アプリが生きている限り残り続けます**。これは意図した場合には利点ですが、意図しない場合は次のようなバグになります。

- モーダルを閉じて開き直したら、**前回の入力途中の文字が残っている**
- 別のページに移動して戻ったら、**前のページのエラーメッセージが表示されたまま**
- テスト間で state が持ち越され、**実行順序によってテストが落ちる**

**③ カプセル化**

module レベルの signal は `export` されている以上、**どこからでも import して書き換えられます**。「この state を触れるのは誰か」が追跡できなくなります。component 内の signal は、その component の中に閉じています。

#### 3段階で選ぶ

| スコープ | 手段 | 使う場面 | 例 |
|---|---|---|---|
| **1つの component** | `createSignal` を component 内で | インスタンスごとに独立し、unmount で消えてよい UI 状態 | 開閉状態、選択中タブ、入力途中の値、hover |
| **あるサブツリー** | **context + その中で作った signal** | 複数 component で共有したいが、インスタンスごとに独立させたい | フォーム全体の state、ウィザードの進行状況、テーブルの選択行 |
| **アプリ全体** | **module レベルの signal / store** | 本当にアプリに1つしか存在しないもの | テーマ、ログインセッション、i18n のロケール、フィーチャーフラグ |

**判断基準はシンプルです。**

> **「これは、アプリ内に同時に2つ存在しうるか？」**
>
> - **存在しうる** → component レベル（または context）。
> - **絶対に1つだけ** → module レベルでもよい。

📌 **中段（context + 内部で作った signal）を忘れないでください。** §12 冒頭の `ThemeProvider` がまさにこの形です。signal を provider component の**中で**作ることで、「サブツリーで共有」と「provider ごとに独立」「unmount で破棄」を同時に満たせます。module レベルにすると、この3つ目と2つ目を失います。

📌 **React との対応**: `useState` が担っていた役割はそのまま component レベルの `createSignal` です。**「Solid では module レベルに置ける」は、React で言えば Zustand / Jotai を使っていた層の置き換えであって、`useState` の置き換えではありません。** ここを混同すると、本来ローカルであるべき state をグローバルに撒くことになります。

### 12.6 早見表

| React でやっていたこと | Solid では |
|---|---|
| `value` を `useMemo` で固定 | **不要**（1回しか作られない） |
| state 用と dispatch 用に context を分割 | **不要**（粒度問題が存在しない） |
| `useContext` の結果を分割代入するのを避ける | **して OK**（関数を取り出すだけ） |
| provider 忘れ対策の自前 throw ラッパー | **不要**（既定値なしなら自動で throw） |
| グローバル state に Zustand / Jotai | **module レベルの signal / store** で足りることが多い |
| context の値として state の**値**を渡す | **accessor / store を渡す** |

---

## 13. Ref と owned setup

### React

```tsx
function SearchField() {
	const input = useRef<HTMLInputElement>(null);

	return (
		<>
			<input ref={input} type="search" />
			<button onClick={() => input.current?.select()}>Select query</button>
		</>
	);
}
```

### Solid

`ref` コールバックでローカル変数に代入します。

```tsx
function SearchField() {
	let input!: HTMLInputElement;

	return (
		<>
			<input ref={(element) => (input = element)} type="search" />
			<button onClick={() => input.select()}>Select query</button>
		</>
	);
}
```

- React は commit された要素を ref オブジェクトの **`current`** に保存する。
- Solid の callback は、**Solid が要素を作成した後にその要素を受け取り**、ローカル変数に代入する。
- Solid の `ref` prop は、**代入可能な変数**または **callback の配列**も受け取れる。

### component をまたいで ref を渡す・合成する

- **React 19** は `ref` を通常の component prop として受け取れるため、新規 component に [`forwardRef`](https://react.dev/reference/react/forwardRef) は不要。`forwardRef` は今も使えるが、React は将来の deprecation を明言している。それ以前の React をターゲットにするコードでは依然 `forwardRef` を使うことがある。
- **Solid も `props.ref` で component の ref を受け取る。** component 自身も同じ要素をローカルで必要とする場合は、**ref 配列の1エントリとして渡す**:

```tsx
import type { Ref } from "solid-js";

type SearchFieldProps = {
	ref?: Ref<HTMLInputElement>;
};

function SearchField(props: SearchFieldProps) {
	let input!: HTMLInputElement;

	return (
		<>
			<input ref={[props.ref, (element) => (input = element)]} type="search" />
			<button onClick={() => input.select()}>Select query</button>
		</>
	);
}
```

- Solid は**配列を再帰的に flatten し、各 ref callback を順番に呼び出す**。
- 親は `props.ref` 経由で要素を受け取り、component 側はラッパー callback なしに **ローカルな要素アクセスと追加の directive を合成できる**。

### ref directive を使うべき場面

要素の挙動に、**再利用可能な setup / native なイベントオプション / owner に紐づくリアクティブな処理 / cleanup** が必要なとき。

---

## 14. 非同期 UI を「state」でマッピングする

- **React**: framework の API、Suspense boundary、transitions、データライブラリで非同期 UI を調整する。
- **Solid**: **非同期の読み取りを reactive graph の一部として表現する。**

### 責務ごとの対応

| React | Solid |
|---|---|
| Suspense の fallback | **`Loading`** の fallback |
| Error boundary | **`Errored`** boundary |
| `SuspenseList` 的な reveal ポリシー | **`Reveal`** |
| transition の pending UI | **自動的な held update + `isPending`** |
| mutation の調整 | **`action`** |

> ⚠️ これらは関連する UI 責務を担いますが、**runtime の契約は互換ではありません。**

### async memo は値のまま渡す（colorless）

JSX の component props は **遅延評価**です（§8）。**渡すこと自体は読み取りではない**ので、async memo も同期の値と同じ形で渡します。型は `User` のまま。`Promise<User>` や `Accessor<User>` に変えない。公式の呼び方は **colorless** です。データをリモートにした瞬間に、経路上の型を色づかせない。

```tsx
import { Errored, Loading, createMemo } from "solid-js";

function UserProfile(props: { user: User }) {
	return (
		<Loading fallback={<p>Loading user...</p>}>
			<article>
				<h2>{props.user.name}</h2>
				<p>{props.user.bio}</p>
			</article>
		</Loading>
	);
}

function Page(props: { id: string }) {
	const user = createMemo(async () => {
		const response = await fetch(`/api/users/${props.id}`);
		if (!response.ok) throw new Error("Could not load user");
		return response.json() as Promise<User>;
	});

	return (
		<Errored
			fallback={(error, reset) => (
				<>
					<p>{String(error())}</p>
					<button type="button" onClick={reset}>
						Retry
					</button>
				</>
			)}
		>
			<UserProfile user={user()} />
		</Errored>
	);
}
```

- **`Loading`**: まだ確定した答えを持たない読み取りを扱う。
- **`Errored`**: reactive graph を通って伝わってくるエラーを扱う。

**boundary の配置ルール（重要）**:

- 上例で async memo は `Page` で作られているが、`Loading` は `UserProfile` の中、**`props.user.name` を読む場所の直上**にある。
- **loading boundary は「"not ready" を報告しうる読み取り」の owner ancestor でありさえすればよい。**
- **computation を作った component や、読み取りを行う component の親の呼び出し元を包む必要はない。**
- 1つの fallback でより広い領域をカバーしたいなら、boundary を owner tree のさらに上に置いてもよい。

#### 用語: owner tree と owner ancestor

**owner** は §2 に出てきた「生存期間の持ち主」です。component が mount されると owner が1つでき、その中で作られた computation や cleanup がそこに紐づきます。

その owner が入れ子になってできる木が **owner tree** です。実用上は **JSX の入れ子構造とほぼ一致する**と考えて構いません。**owner ancestor** は、その木における先祖、つまり「JSX 上で自分を囲んでいる誰か」です。

#### 例の構造を図にする

先ほどのコードを owner tree として描くと、こうなっています。

```
Page
 ├─ createMemo(user)                         ← 「作られた場所」。boundary とは無関係
 └─ <Errored fallback={...}>                 ← エラー用の境界
     └─ <UserProfile user={user()}>          ← 値を渡している。props は遅延なので、ここでは読んでいない
         └─ <Loading fallback={...}>         ← ★ ここが loading の境界
             └─ <article>
                 ├─ {props.user.name}        ← ☆ not-ready を報告しうる読み取り
                 └─ {props.user.bio}         ← ☆ 同上
```

★ が ☆ の **owner ancestor になっている**ので、この配置で成立します。

#### なぜ「作った場所」は関係ないのか

ここが一番の勘所です。**`createMemo` は「まだ結果が出ていない」とは言いません。言うのは「読み取り」の方です。**

```tsx
const user = createMemo(async () => { /* ... */ });
// ↑ この時点では何も起きない。user はただの accessor

<UserProfile user={user()} />
// ↑ JSX prop は getter（§8）。親の本体で user() を変数に取り出しているのではない。
//    子が props.user に触るまで読み取りは起きない

{props.user.name}
// ↑ ここで初めて読む。まだ settled していなければ、この式が "not ready" を報告する
```

親で本当に読んでしまう書き方は、こうです。子の `<Loading>` には届きません。

```tsx
const current = user();
return <UserProfile user={current} />;
```

つまり **not-ready は「値を実際に取りに行った場所」で発生します。** そこから owner tree を上にたどり、**最初に見つかった `Loading` がそれを受け止めます。**

だから boundary は「memo を作った `Page`」を包む必要がなく、「`UserProfile` を呼び出している側」を包む必要もありません。**読み取り式さえ内側にあればよい**のです。

📌 **設計上の意味**: これにより、**「データを用意する場所」と「ローディング表示を決める場所」を分離できます。** `Page` はデータの取得元を知っていればよく、「どんなスケルトンを出すか」は表示を担当する `UserProfile` が自分で決められます。

#### なぜ `user={user}` ではなく `user={user()}` なのか

公式も kit 0.9 も、**値渡しが本線**です。props の型は `User`。データをリモートにしても、途中の component の型を `Promise` や `Accessor` に塗り替えない。

```tsx
function UserProfile(props: { user: User }) {
	return (
		<Loading fallback={<p>Loading user...</p>}>
			<h2>{props.user.name}</h2>
		</Loading>
	);
}

<UserProfile user={user()} />
```

| 書き方 | いつ使うか |
|---|---|
| `user={user()}` + 子で `{props.user.name}` | **本線。** 表示用。`<Loading>` は読み取りの直上 |
| `user={user}` + 子で `props.user()` | **例外。** 子が `refresh(そのソース)` や `affects(そのソース)` を呼ぶときだけ（どちらもソース本体を要求する API） |

`isPending` は式への問いなので、値として受け取ったあとも `isPending(() => props.user)` と聞ける。memo を渡さなくても pending は取れる。

以前このガイドは `Accessor<User>` を推していました。読み取り地点の `()` が見える、分割代入しても壊れない、型に「非同期」が現れる、という理由です。いずれも **表示用 props を accessor にする理由にはなりません。**

- 読み取り地点は `{props.user.name}` で足りる。遅延は props の getter（§8）が担当する。
- 分割代入で壊れるのは accessor 渡しでも同じ問題の別面です。**`props` を壊さない**（§8）のが正解であって、型を `Accessor` にして逃げない。
- 「非同期であること」は型ではなく **`<Loading>` の位置**で表す。経路上の型を色づかせると、リモートにした瞬間に途中のファイルまで触ることになる。

#### boundary をどこに置くか（設計判断）

`Loading` の位置は**表示の粒度**を決めます。原文の「1つの fallback でより広い領域をカバーしたいなら上に置いてもよい」はこの話です。

| 置く位置 | 結果 | 向いている場面 |
|---|---|---|
| **読み取りの近く（下）** | 細かい単位で個別に fallback が出る | 各パーツが独立していて、揃った順に出してよい |
| **広い領域の上** | 1つの fallback がまとめて出て、**全部揃ってから一斉に表示** | レイアウトがガタつくのを避けたい、意味的にひとまとまりの領域 |

```tsx
// 細かく: 各カードが個別にスケルトン → 出揃う順序がバラバラ
<div>
	<Loading fallback={<CardSkeleton />}><ProfileCard /></Loading>
	<Loading fallback={<CardSkeleton />}><StatsCard /></Loading>
</div>

// まとめて: 1枚のスケルトン → 両方揃ってから一気に表示
<Loading fallback={<DashboardSkeleton />}>
	<div>
		<ProfileCard />
		<StatsCard />
	</div>
</Loading>
```

> 💡 中間が欲しい（個別の fallback を出しつつ、表示の順序は制御したい）場合が、後述の **`Reveal`** の出番です。

#### ⚠️ React の Suspense との決定的な違い

構造だけ見ると「読み取る場所より上にある最も近い境界が受け止める」で React と同じに見えますが、**中身は大きく違います。**

| | React Suspense | Solid `Loading` |
|---|---|---|
| 何が中断されるか | **component の render 全体**。その component の出力は破棄される | **その reactive 式だけ**。component の setup は完走する |
| 内側の component | 中断された component より下は **render されない** → 自分の fetch を開始できない（waterfall） | **setup が続行される** → それぞれが自分の fetch を開始できる |
| 境界の位置を変えると | **いつ fetch が始まるかが変わりうる**（waterfall の形が変わる） | **表示のタイミングだけが変わる。fetch の開始時期は変わらない** |
| 解決後 | component が **再度 render される** | **component 関数は再実行されない**。保持していた branch が表示される |

最後の行が実務上いちばん効きます。**Solid では `Loading` の位置は「見せ方」の判断であって、「性能」の判断ではありません。** 境界を上げ下げしても通信の並列度は変わらないので、**純粋に UX（どの粒度でスケルトンを見せたいか）だけで決められます。**

React では境界の位置が waterfall を生むかどうかに直結するため、`use` の呼び出し位置や preload の設計と絡めて考える必要がありました。その負担がなくなる、というのがこの節の実質的な価値です。次の「非同期の協調はデータに従う」で、その仕組みが具体例とともに説明されます。

### 非同期の協調は「データ」に従う（Async coordination follows data）

Solid は **component を suspension の単位とせず、リアクティブなデータを待つ**。not-ready な読み取りは**その reactive output をブロックするだけで、残りのネストした component tree の setup を中断しない**。

#### まず用語をほどく

**suspension（サスペンション / 中断）**
「まだ答えが出ていないので、出るまでこの処理を止めておく」ことです。React の `Suspense` の語源そのままで、**「待たされて止まっている状態」** と読んで構いません。

**suspension の単位（unit of suspension）**
「**何が丸ごと止まるのか**」という粒度の話です。ここが React と Solid の分かれ目になります。

- **React**: 止まる単位は **component**。ある component が待ちに入ると、**その component の render 全体**が中断され、出力は捨てられます。
- **Solid**: 止まる単位は **1つの読み取り（データ）**。「`a()` を読んだ式」だけが止まります。

**reactive output（リアクティブな出力）**
グラフの各ノードが**担当している出力**のことです（§5.0）。JSX 式なら「**DOM のその一箇所**」、memo なら「その値」です。

```tsx
<div class="box">
	A completed in {a()} seconds.
	<B />
</div>
```

ここで `{a()}` という式が担当している reactive output は、**「A completed in」と「seconds.」の間にあるテキストノード1つだけ**です。`<div class="box">` も `<B />` も、この式とは無関係な別の出力です。

したがって **「その reactive output をブロックする」** とは、**「そのテキストノード1つが確定できないだけ」** という意味になります。周りの `<div>` は普通に作られますし、**`<B />` も普通に呼び出されます。**

#### 一言でいうと

> **React は「1人が待たされたらチーム全員が手を止める」。**
> **Solid は「待たされた1人だけが手を止め、他は作業を進める」。**

#### 実際の所要時間で見る

`fetchTimeIn3Seconds` は名前のとおり3秒かかる関数です。A の中に B、B の中に C がネストしています。

**React（preload なしの素朴な実装）の場合:**

```
0s ─ A を render → a を読む → 中断。B は render されない
3s ─ a が解決 → A を再 render → B を render → b を読む → 中断。C は render されない
6s ─ b が解決 → B を再 render → C を render → c を読む → 中断
9s ─ c が解決 → ようやく全部表示
```

ネストの深さぶん**直列に積み上がります**（waterfall）。これを避けるために、React では preload や loader、データ取得ライブラリのキャッシュを別途設計する必要がありました。

**Solid の場合:**

```
0s ─ A の setup → a のリクエスト開始 → {a()} は not-ready だが setup は続行
     → <B /> の setup → b のリクエスト開始 → 同様に続行
     → <C /> の setup → c のリクエスト開始
     （この時点で3本のリクエストが並走している）
3s ─ 3つとも解決 → まとめて表示
```

**約3秒で終わります。** `{a()}` が not-ready を報告しても、それは「そのテキストノードが決まらない」だけであって、**兄弟である `<B />` の呼び出しを止める理由にはならない**からです。

📌 **なぜこう振る舞えるのか**は §1 に戻ります。Solid の component 関数は「画面を作る」のではなく「**リアクティブなグラフを組み立てる**」ためのものです。グラフの組み立て自体は同期的に最後まで走り切り、**値が埋まるのは後から**でよいのです。React の component は「今回の画面を返す」ものなので、値が無ければ返しようがなく、そこで止まるしかありません。

```tsx
import { render } from "@solidjs/web";
import { Loading, createMemo } from "solid-js";
import { fetchTimeIn3Seconds } from "./api.js";

function A() {
	const a = createMemo(fetchTimeIn3Seconds);

	return (
		<div class="box">
			A completed in {a()} seconds.
			<B />
		</div>
	);
}

function B() {
	const b = createMemo(fetchTimeIn3Seconds);

	return (
		<div class="box">
			B completed in {b()} seconds.
			<C />
		</div>
	);
}

function C() {
	const c = createMemo(fetchTimeIn3Seconds);

	return <div class="box">C completed in {c()} seconds.</div>;
}

render(
	() => (
		<Loading fallback="Loading...">
			<A />
		</Loading>
	),
	document.getElementById("root")!
);
```

何が起きるか:

1. `A` は `a()` が "not ready" を報告する**前に**リクエストを開始する。
2. Solid はネストした JSX の setup を続行するので、**`B`、続いて `C` も同じパスで自分のリクエストを開始する**。
3. component がネストしていても、**3つのリクエストは並行して重なる**。
4. `A` の上にある**1つの `Loading` boundary が、その下のすべての not-ready 読み取りを扱う**。
5. boundary は進行中の branch を**表示出力から切り離す**が、**reactive ownership はオフスクリーンで保持する**。そして fallback を表示する。
6. component の setup と ownership はそのまま残り、非同期の式は解決へ向かって進み続ける。
7. 値が確定すると、Solid は**リアクティブなテキスト式を更新し、保持していた branch を表示する**。**component 関数は再実行されない。**

補足:

- 別の非同期結果を読む computation は、**その依存を待つ**（当然の直列化）。
- **並列性は「component tree の深さ」ではなく「独立したデータ依存」から生まれる。**
- React でも framework の loading / caching / preloading で並列リクエストは実現できる。この例が示すのは **Solid のデフォルト挙動** ―― **pending という状態はデータの読み取りに属するので、pending な式があってもネストした component が自分の独立した処理を開始することを止めない。**

### 複数の loading 領域を協調させる（`Reveal`）

- React は実験的 API `SuspenseList` でこの協調を探求したが、**React 19 の stable API には含まれない**（実験的リリースや framework の抽象で概念に触れることはある）。
- Solid の [`Reveal`](https://v2.solidjs.com/reference/solid-js/components-jsx/reveal) は、**兄弟の `Loading` boundary の表示タイミング**を協調させる。

```tsx
import { Loading, Reveal } from "solid-js";

<Reveal order="sequential">
	<Loading fallback={<ProfileSkeleton />}>
		<Profile />
	</Loading>
	<Loading fallback={<ActivitySkeleton />}>
		<Activity />
	</Loading>
</Reveal>;
```

- **`Reveal` は非同期処理を開始しないし、loading state も作らない。** 直下の loading 領域が**いつ可視になるか**だけを制御する。

| `order` | 挙動 |
|---|---|
| `"sequential"` | 登録順に表示していく |
| `"together"` | すべての直下領域が最初の可視コンテンツを持つまで待つ |
| `"natural"` | 各領域が自分の処理が確定した時点で表示 |

- ネストした `Reveal` グループは、**親グループの1つの slot として合成される**。

### 更新は暗黙的に協調される（transition 相当）

- React は `startTransition` で「この更新は非ブロッキング」とマークする。
- **Solid には更新をマークするラッパーが不要。** **1つの途切れない同期コールスタック中に行われた signal / store の書き込みは、すべて同じ協調された update に参加する。**

```tsx
function selectUser(id: string) {
	setSelectedId(id);
	setPanel("profile");
}
```

上の2つの書き込みは1つの update に属します。

> ⚠️ この暗黙のグルーピングは、React の transition API のような **priority / interruptibility の API ではありません。**

- 下流の処理が同期のままなら、Solid は **通常の microtask flush** で update を commit する。
- 参加する computation が非同期処理を待つ場合、その単位は **held update（保留された更新）** になる。Solid は**現在 commit 済みの view を表示したまま**、処理が確定したら**参加している書き込みをまとめて表示する**。
- この **「UI を保持する挙動」が React の transition に最も近い類似物**。
- 保持中の view に更新中インジケータが必要なら [`isPending`](https://v2.solidjs.com/reference/solid-js/reactivity/is-pending) を使う。**明示的な `startTransition` 呼び出しではなく自動。**

### `action`

Solid の [`action`](https://v2.solidjs.com/reference/solid-js/lifecycle-actions/action) は、**generator ベースの mutation、optimistic state、refresh 挙動**を協調させます。

> ⚠️ "action" という語が共通でも、異なるエコシステムの action API が同一の契約を持つわけではありません。

---

## 15. 段階的な移行の進め方

- React と Solid の JSX は似て見えるが、**コンパイル後の component の値と runtime の ownership は互換ではない。**
- したがって、**route / page / island / 別のアプリケーション root** を、2つの renderer の**境界**として扱う。

### 推奨シーケンス

1. **Solid のアプリケーションシェルを作成**し、routing と rendering のセットアップを決める。
2. **framework 非依存のもの**（型、バリデーション、データクライアント、ユーティリティ関数）を移す。
3. **leaf の UI component** とそのローカル state を移行する。
4. **共有 state と context** は、消費側 component の Solid 境界が明確になった後に移す。
5. **派生 state と effect** を「責務」で翻訳する。
6. **非同期の読み取り・loading UI・エラー・mutation** を Solid の非同期モデルへ移す。
7. 子孫の移行が済んだら、**React root / route 境界を廃止する。**

---

## 16. 移行レビュー・チェックリスト

移行した component を「完了」とする前に確認:

- [ ] signal の値は **accessor を呼び出して**読んでいるか。
- [ ] リアクティブな更新を駆動させたい読み取りが、**JSX / memo / async computation / effect の compute 関数**の中にあるか。
- [ ] イベントハンドラや、意図的な1回きりのスナップショットは、**track せずに**値を読めているか。
- [ ] 変化しうる props が、**props オブジェクト上に残っている**か、**リアクティブな derivation で包まれている**か。
- [ ] 計算可能な値が、**state のコピーを同期する形ではなく derivation のまま**になっているか。
- [ ] effect は、**確定したリアクティブな結果を命令的システムへ送る**用途になっているか。
- [ ] インタラクション固有の処理が、**それを観測したイベントハンドラ / action の中で開始**されているか。
- [ ] リアクティブなリストが、**コレクションの変わり方に合った `For` の keying mode または `Repeat` の range** を使っているか。
- [ ] 非同期の読み取りに、**適切な loading / error boundary** があるか。値は **`user={user()}` で渡し**、props 型は `User` のままか。accessor 渡しは子が `refresh` するときに限るか。
- [ ] **renderer 固有の React component が、Solid の component tree に直接持ち込まれていない**か。

> 移行の成功とは、**アプリケーションの挙動を保ちながら、その data flow を Solid の実行モデルで表現し直せている状態**を指します。

---

## 付録: React 脳の落とし穴 早見表

| やりがちなこと | なぜ問題か | 正しくは |
|---|---|---|
| `const value = count()` を component 本体で書く | 本体は untracked で1回しか走らない | accessor のまま JSX へ運ぶ |
| `function C({ name })` と分割代入する | getter を eager に読み、リアクティブさが切れる | `props.name` のまま使う / `createMemo` で包む |
| store を `{...current, name}` で作り直す | プロパティ単位の購読の恩恵を失う | `setStore(draft => { draft.name = ... })` |
| 「state + それを同期する effect」を書く | 派生値は derivation で足りる | ただの関数 or `createMemo` |
| `useEffect` をそのまま `createEffect` に写す | Solid では compute / apply に責務分離 | 依存は compute 関数、副作用は apply 関数 |
| `map` でリストを描く | 行の identity を保持できない | `For`（または `Repeat`） |
| `className` / `backgroundColor` | Solid は DOM/CSS 側の名前 | `class` / `"background-color"` |
| `onChange` で逐次入力を取る | Solid の `onChange` は native な change | `onInput` |
| `startTransition` を探す | Solid は自動で held update になる | 同期コールスタックにまとめる + `isPending` |
| Suspense を component 単位で考える | Solid は**データ**単位で待つ | 読み取りの owner ancestor に `Loading` を置く |
