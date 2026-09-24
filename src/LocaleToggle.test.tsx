/**
 * The language button, which offers the locale you are *not* in — so its own
 * label is the thing that has to flip when it is pressed.
 */
import { expect, test } from "vite-plus/test";
import { flush } from "solid-js";
import { mount } from "./test-setup";
import { AppProviders } from "./providers";
import LocaleToggle from "./LocaleToggle";

localStorage.setItem("cobracket:locale", "en");

test("offers the other locale, and switches to it on click", () => {
  const host = mount(() => (
    <AppProviders>
      <LocaleToggle />
    </AppProviders>
  ));
  const button = host.querySelector("button");
  if (!button) throw new Error("no locale button");

  expect(button.textContent?.trim()).toBe("日本語");
  expect(button.getAttribute("aria-label")).toBe("Language");

  button.click();
  flush();

  // The label is now the way back, and the aria-label is translated too.
  expect(localStorage.getItem("cobracket:locale")).toBe("ja");
  expect(button.textContent?.trim()).toBe("English");
  expect(button.getAttribute("aria-label")).toBe("言語");

  button.click();
  flush();
  expect(localStorage.getItem("cobracket:locale")).toBe("en");
  expect(button.textContent?.trim()).toBe("日本語");
});

test("remembers the choice for the next visit", () => {
  const host = mount(() => (
    <AppProviders>
      <LocaleToggle />
    </AppProviders>
  ));
  const button = host.querySelector("button");
  if (!button) throw new Error("no locale button");
  button.click();
  flush();
  expect(localStorage.getItem("cobracket:locale")).toBe("ja");
});
