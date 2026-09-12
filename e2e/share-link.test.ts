/**
 * The real-browser diagnostics gate.
 *
 * The happy-dom gate (`src/test-setup.ts`) judges every test under `src/`,
 * and it let a finding through that only a browser reported: an 8-player
 * double elimination (15 matches) put `BracketView`'s list insert effect over
 * the [WIDE_SCOPE_DEPS] threshold, and a human found it in `bun dev`. Fixture size explained part
 * of that, and the `src` tests now render above the thresholds — but their
 * data seam is a fake, their DOM is emulated, and their time budget is
 * loosened for it. This gate closes the rest of the gap: a scripted Chromium
 * session against the dev server, the anonymous Convex deployment behind it,
 * captured through the same `@solidjs/diagnostics` bridge the plugin injects
 * for the curl loop in AGENTS.md, judged by the same `assertGate` the
 * happy-dom tests use. Engine thresholds stay at their defaults here — a real
 * browser is where the wall-clock ones mean something.
 *
 * One scenario, the Organizer's whole path: create a tournament, add the
 * roster, generate, publish, open the Share Link. Sixteen players in double
 * elimination, not the eight the story needs, because the bracket is what
 * the gate is for and the thresholds are counted in sources: 8 players is 15
 * matches, and the defect that motivated this gate (a per-row `<Show>` in
 * `BracketView`) costs the insert effect one source per row, so 15 rows sit
 * under the 30-source threshold and the pre-fix code passes. Measured, with
 * that defect re-injected: 8 players report nothing, 16 players (31 matches)
 * report [WIDE_SCOPE_DEPS] with 31 sources on both the management page and
 * the Share Link — and the shipped code reports nothing at either size.
 * (The human's 8-player finding was real only because solid-refresh doubled
 * the count, 15 rows to 30 sources — the wrapper made the defect visible by
 * luck, which is not a gate.)
 *
 * The other half of that measurement is why the dev server runs in `--mode
 * e2e`: with solid-refresh on, the *fixed* code reports the same 31 sources
 * at 16 players, every one named `[solid-refresh]MatchCard` (vite.config.ts).
 */
import { afterAll, beforeAll, expect, inject, test } from "vite-plus/test";
import { captureBrowserArtifact } from "@solidjs/diagnostics/playwright";
import { type Browser, chromium } from "playwright-core";
import { assertGate } from "../src/diagnostics-verdict";

const PLAYERS = 16;
/** 16 players, double elimination: 15 winners + 14 losers + grand final + reset. */
const MATCHES = 31;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

test("creating, publishing and sharing a 16-player double elimination raises no Solid diagnostic in Chromium", async () => {
  // A fresh context is a fresh browser: no session, so the create form's
  // `ensureOrganizer` signs in anonymously under the capture too.
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${inject("e2eBaseUrl")}/`);
  await page.waitForFunction(() => "__SOLID_DIAGNOSTICS__" in globalThis);

  const names = Array.from({ length: PLAYERS }, (_, i) => `Player ${i + 1}`).join("\n");
  const { artifact, result: cards } = await captureBrowserArtifact(
    page,
    async () => {
      await page.getByLabel("Tournament name").fill("Browser gate");
      await page.getByLabel("Discipline").fill("Chess");
      await page.getByLabel("Double elimination").check();
      await page.getByRole("button", { name: "Create tournament" }).click();
      await page.waitForURL(/\/t\//);

      await page.getByPlaceholder("Paste a list of names").fill(names);
      await page.getByRole("button", { name: "Add all" }).click();
      await page.getByText(`${PLAYERS} participants`).waitFor();

      await page.getByRole("button", { name: "Generate Bracket" }).click();
      await page.getByRole("button", { name: "Publish" }).click();
      await page.getByText("Published").first().waitFor();

      await page.locator('a[href^="/s/"]').first().click();
      await page.waitForURL(/\/s\//);
      // The cards are the buttons laid out beside the bracket's edge SVG.
      const bracket = page.locator("svg[aria-hidden='true'] ~ button");
      await bracket.nth(MATCHES - 1).waitFor();
      return bracket.count();
    },
    { scenario: "16-player double elimination to Share Link" },
  );
  await context.close();

  // The capture spanned what it was meant to: the Share Link's bracket at a
  // size above the threshold, with nothing thrown in the page and the
  // attribution engine actually recording (an artifact from a page whose
  // bridge never armed would be empty, and pass for the wrong reason).
  expect(pageErrors).toEqual([]);
  expect(cards).toBe(MATCHES);
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);

  assertGate(artifact);
});
