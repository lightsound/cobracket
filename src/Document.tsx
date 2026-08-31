import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";

const THEME_BOOTSTRAP = `(() => {
  // keep in sync with src/theme-preference.ts
  try {
    const pref = localStorage.getItem("cobracket:theme");
    if (pref === "light" || pref === "dark") {
      document.documentElement.style.colorScheme = pref;
    }
  } catch {
    /* private mode / disabled storage */
  }
})();
`;

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script>{THEME_BOOTSTRAP}</script>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>🐍 cobracket</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
