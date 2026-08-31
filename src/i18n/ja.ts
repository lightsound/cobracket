import type { MessageKey } from "./en";

// Japanese dictionary (story 24). Keys are defined by the English source
// dictionary; Record<MessageKey, string> keeps the two in lockstep.
export const ja: Record<MessageKey, string> = {
  "app.title": "cobracket",
  "app.loading": "読み込み中…",
  "app.retry": "再試行",
  "app.notFound": "ページが見つかりません。",
  "app.backHome": "ホームに戻る",
  "app.setupConvex":
    ".env.local に VITE_CONVEX_URL を設定し、`bun run convex:dev` を実行してください。",

  "theme.label": "テーマ",
  "theme.system": "自動",
  "theme.light": "ライト",
  "theme.dark": "ダーク",

  "locale.label": "言語",

  "format.single_elimination": "シングルエリミネーション",
  "format.double_elimination": "ダブルエリミネーション",

  "status.draft": "下書き",
  "status.published": "公開済み",
  "status.live": "進行中",
  "status.completed": "終了",

  "home.heading": "あなたの Tournament",
  "home.empty": "Tournament はまだありません。下のフォームから作成できます。",
  "home.signedOut": "下のフォームから最初の Tournament を作成できます。サインアップは不要です。",
  "home.checkingSession": "セッションを確認しています…",
  "home.create.heading": "新しい Tournament",
  "home.create.name": "Tournament 名",
  "home.create.namePlaceholder": "金曜ナイトブラケット",
  "home.create.discipline": "Discipline",
  "home.create.disciplinePlaceholder": "例: Street Fighter 6",
  "home.create.format": "Format",
  "home.create.submit": "Tournament を作成",

  "tournament.share.copy": "Share Link をコピー",
  "tournament.share.copied": "コピーしました",
  "tournament.share.hint":
    "このリンクを知っている人は誰でも、アカウントなしでブラケットをライブ観戦できます。",

  "roster.heading": "Participant",
  "roster.count": "{count} 名",
  "roster.empty": "Participant はまだいません。下から追加してください。",
  "roster.addPlaceholder": "Participant 名",
  "roster.add": "追加",
  "roster.bulkPlaceholder": "名前のリストを貼り付け(1 行に 1 名)",
  "roster.bulkAdd": "まとめて追加",
  "roster.rename": "改名",
  "roster.remove": "削除",
  "roster.save": "保存",
  "roster.cancel": "キャンセル",
  "roster.moveUp": "上へ",
  "roster.moveDown": "下へ",
  "roster.locked": "ロスターはロックされています(状態: {status})。",

  "seeding.random": "Seeding: ランダム — 生成のたびにシャッフルされます。",
  "seeding.manual": "Seeding: 手動順。",

  "bracket.heading": "Bracket",
  "bracket.generate": "Bracket を生成",
  "bracket.regenerate": "Bracket を再生成",
  "bracket.none": "Bracket を生成するとここでプレビューできます。",
  "bracket.needTwo": "Bracket の生成には 2 名以上の Participant が必要です。",
  "bracket.stale": "ロスターが変更されたため Bracket は破棄されました。再生成してください。",
  "bracket.publish": "公開",
  "bracket.publishHint": "公開すると Share Link で Bracket が見えるようになります。",
  "bracket.section.winners": "Winners",
  "bracket.section.losers": "Losers",
  "bracket.section.grand_final": "Grand Final",
  "bracket.bye": "Bye",
  "bracket.tbd": "未定",
  "bracket.ready": "進行中 / 次",
  "bracket.voided": "再入力が必要",
  "bracket.zoomIn": "拡大",
  "bracket.zoomOut": "縮小",
  "bracket.zoomReset": "表示をリセット",

  "outcome.walkover": "不戦勝",
  "outcome.disqualification": "失格",

  "report.record": "結果を記録",
  "report.correct": "結果を訂正",
  "report.winner": "勝者",
  "report.how": "決着方法",
  "report.how.played": "対戦",
  "report.how.walkover": "Walkover(不参加)",
  "report.how.disqualification": "失格",
  "report.score": "スコア(任意)",
  "report.submit": "結果を保存",
  "report.cancel": "キャンセル",
  "report.pickWinner": "先に勝者を選んでください。",
  "report.voided":
    "この訂正により {count} 件の下流の結果が無効になりました。ハイライトされた Match に再入力してください。",

  "champion.heading": "優勝",
  "standings.heading": "Standings",
  "standings.placement": "順位",
  "standings.participant": "Participant",

  "share.notFound":
    "この Tournament は表示できません。リンクが間違っているか、Bracket がまだ公開されていません。",
  "share.bracketPending": "Bracket は再調整中です。しばらくしてからご覧ください。",
};
