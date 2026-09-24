/**
 * The document shell, and the one piece of logic in this repo that exists
 * twice: the inline theme bootstrap.
 *
 * It has to be inline and it has to run before the first paint, so it cannot
 * import `src/theme-preference.tsx` — it re-reads the same storage key by hand
 * under a "keep in sync" comment. That comment is the whole risk, so these
 * tests execute the script the component actually ships and assert it agrees
 * with the module: same key, same values honoured, same ones ignored.
 */
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import { renderToString } from "@solidjs/web";
import Document from "./Document";

const STORAGE_KEY = "cobracket:theme";

/** The document shell as the server sends it. */
function shell(): string {
  return renderToString(() => (
    <Document>
      <p id="page">page</p>
    </Document>
  ));
}

/**
 * The bootstrap as shipped, run the way the browser runs it: as a script,
 * against nothing but the two globals it is allowed to touch.
 *
 * There is no DOM here (the server build needs none), and that is an
 * advantage. A VM context holds exactly `localStorage` and `document`, so the
 * script's whole contract with the browser is visible in one object — and a
 * script that grew a third dependency would fail here on an undefined
 * binding rather than quietly working against the real page.
 */
function runBootstrap(html: string, stored: string | null): string {
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (source === undefined || !source.includes(STORAGE_KEY)) {
    throw new Error("the document ships no theme bootstrap");
  }
  const root = { style: { colorScheme: "" } };
  runInNewContext(source, {
    localStorage: { getItem: (key: string) => (key === STORAGE_KEY ? stored : null) },
    document: { documentElement: root },
  });
  return root.style.colorScheme;
}

test("renders the head the app needs, and the children in the body", () => {
  const html = shell();

  expect(html).toContain('<html lang="en">');
  expect(html).toContain("<title>🐍 cobracket</title>");
  expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  // The hydration script has to be in the head, before the app's markup, or
  // the browser has nothing to hydrate into.
  expect(html.indexOf("_$HY")).toBeLessThan(html.indexOf("<body>"));
  expect(html).toContain('<p id="page">page</p>');
});

test.each([
  ["dark", "dark"],
  ["light", "light"],
])("applies a stored %s scheme before the app boots", (stored, expected) => {
  expect(runBootstrap(shell(), stored)).toBe(expected);
});

test.each([["system"], ["midnight"], [""], [null]])(
  "leaves the scheme to the stylesheet when the stored value is %o",
  (stored) => {
    // The same set of honoured values as `storedPreference()` in
    // src/theme-preference.tsx: anything else means "system", and system is
    // `light-dark()` doing its job with no inline scheme at all.
    expect(runBootstrap(shell(), stored)).toBe("");
  },
);
