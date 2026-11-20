/** Gate design, scenario-size contract and all measurements: docs/diagnostics-gates.md. */
import { afterAll, beforeAll, expect, inject, test } from "vite-plus/test";
import { captureBrowserArtifact } from "@solidjs/diagnostics/playwright";
import { type Browser, chromium } from "playwright-core";
import { assertGate } from "../src/diagnostics-verdict";
import { SCOPE_WIDTHS_GLOBAL, type ScopeWidthsBridge } from "../src/scope-widths";

const PLAYERS = 16;
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

  await page.waitForFunction((key) => key in globalThis, SCOPE_WIDTHS_GLOBAL);
  await page.evaluate((key) => {
    (globalThis as unknown as Record<string, ScopeWidthsBridge>)[key].begin();
  }, SCOPE_WIDTHS_GLOBAL);

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
      const bracket = page.locator("svg[aria-hidden='true'] ~ button");
      await bracket.nth(MATCHES - 1).waitFor();
      return bracket.count();
    },
    {
      scenario: "16-player double elimination to Share Link",
      attribution: { fallbackFlashes: false },
    },
  );
  const scopes = await page.evaluate(
    (key) => (globalThis as unknown as Record<string, ScopeWidthsBridge>)[key].end(),
    SCOPE_WIDTHS_GLOBAL,
  );
  await context.close();

  // The capture spanned what it was meant to: the Share Link's bracket at a
  // size above the threshold, with nothing thrown in the page and the
  // attribution engine actually recording (an artifact from a page whose
  // bridge never armed would be empty, and pass for the wrong reason).
  expect(pageErrors).toEqual([]);
  expect(cards).toBe(MATCHES);
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expect(scopes.length).toBeGreaterThan(0);

  assertGate(artifact, scopes);
});
