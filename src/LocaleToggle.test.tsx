/**
 * The language button, which offers the locale you are *not* in — so its own
 * label is the thing that has to flip when it is pressed.
 */
import { expect, test } from "vite-plus/test";
import { flush } from "solid-js";
import { mount } from "./test-setup";
import { locale, setLocale } from "./i18n";
import LocaleToggle from "./LocaleToggle";

setLocale("en");

test("offers the other locale, and switches to it on click", () => {
  const host = mount(() => <LocaleToggle />);
  const button = host.querySelector("button");
  if (!button) throw new Error("no locale button");

  expect(button.textContent?.trim()).toBe("日本語");
  expect(button.getAttribute("aria-label")).toBe("Language");

  try {
    button.click();
    flush();

    expect(locale()).toBe("ja");
    // The label is now the way back, and the aria-label is translated too.
    expect(button.textContent?.trim()).toBe("English");
    expect(button.getAttribute("aria-label")).toBe("言語");

    button.click();
    flush();
    expect(locale()).toBe("en");
    expect(button.textContent?.trim()).toBe("日本語");
  } finally {
    // The locale is a module-level signal, shared by every test in the
    // process — leave it as this file found it.
    setLocale("en");
    flush();
  }
});

test("remembers the choice for the next visit", () => {
  const host = mount(() => <LocaleToggle />);
  const button = host.querySelector("button");
  if (!button) throw new Error("no locale button");
  try {
    button.click();
    flush();
    expect(localStorage.getItem("cobracket:locale")).toBe("ja");
  } finally {
    setLocale("en");
    flush();
  }
});
