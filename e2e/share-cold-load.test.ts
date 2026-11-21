import { afterAll, beforeAll, expect, inject, test } from "vite-plus/test";
import { type Browser, chromium } from "playwright-core";

const PLAYERS = 4;
const MATCHES = 3;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

test("opening a Share Link directly in a fresh context renders the shared view", async () => {
  const organizerContext = await browser.newContext({ locale: "en-US" });
  const organizerPage = await organizerContext.newPage();

  await organizerPage.goto(`${inject("e2eBaseUrl")}/`);
  await organizerPage.getByLabel("Tournament name").fill("Cold load share");
  await organizerPage.getByLabel("Discipline").fill("Chess");
  await organizerPage.getByLabel("Single elimination").check();
  await organizerPage.getByRole("button", { name: "Create tournament" }).click();
  await organizerPage.waitForURL(/\/t\//);

  const names = Array.from({ length: PLAYERS }, (_, i) => `Player ${i + 1}`).join("\n");
  await organizerPage.getByPlaceholder("Paste a list of names").fill(names);
  await organizerPage.getByRole("button", { name: "Add all" }).click();
  await organizerPage.getByText(`${PLAYERS} participants`).waitFor();

  await organizerPage.getByRole("button", { name: "Generate Bracket" }).click();
  await organizerPage.getByRole("button", { name: "Publish" }).click();
  await organizerPage.getByText("Published").first().waitFor();

  const href = await organizerPage.locator('a[href^="/s/"]').first().getAttribute("href");
  expect(href).not.toBeNull();
  await organizerContext.close();

  const shareContext = await browser.newContext({ locale: "en-US" });
  const sharePage = await shareContext.newPage();
  const pageErrors: string[] = [];
  sharePage.on("pageerror", (error) => pageErrors.push(error.message));

  await sharePage.goto(`${inject("e2eBaseUrl")}${href}`);
  await sharePage.getByText("Cold load share", { exact: true }).waitFor({ timeout: 30_000 });
  const bracket = sharePage.locator("svg[aria-hidden='true'] ~ button");
  await bracket.nth(MATCHES - 1).waitFor({ timeout: 30_000 });
  const cards = await bracket.count();
  await shareContext.close();

  expect(pageErrors).toEqual([]);
  expect(cards).toBe(MATCHES);
});
