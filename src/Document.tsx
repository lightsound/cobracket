import type { ParentProps } from "solid-js";
import { HydrationScript } from "@solidjs/web";

// Blocking bootstrap: apply a stored light/dark preference before first paint
// so light-dark() tokens do not flash the OS scheme. Intentionally duplicated
// from src/theme-preference.ts — the prerendered shell cannot import
// application modules.
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

// The document shell — the new index.html: picked up by the src/Document.*
// convention, it wraps the app in the plugin's generated entries and must
// render the full <html>. Head tags go here. It is compiled only into the
// prerendered static shell. In client mode <HydrationScript /> is stripped
// from the shell, and it activates when the app flips to SSR (`ssr: true`
// in vite.config.ts) — no document changes needed. The blocking theme
// bootstrap in <head> is the only client JS that ships with the shell.
// Delete this file to fall back to the plugin's built-in shell.
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
