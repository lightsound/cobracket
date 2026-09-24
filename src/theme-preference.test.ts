/**
 * The theme preference, which is a browser-only value read when the provider
 * creates it.
 *
 * Solid 2 client mode mounts into an empty body, so there is no hydration
 * mismatch to defend against: `createThemePreference()` reads `localStorage`
 * directly, rather than starting neutral and adopting the stored value after
 * mount (the React reflex, which would overwrite what the user chose). That is
 * the behaviour the first test pins, and the reason every case here arranges
 * storage *before* calling the factory — the same ordering the provider sees
 * on a fresh page load.
 */
import { expect, test, vi } from "vite-plus/test";
import { flush } from "solid-js";
import { createThemePreference } from "./theme-preference";

const STORAGE_KEY = "cobracket:theme";

const scheme = () => document.documentElement.style.colorScheme;

test("adopts a stored preference when the signal is created", () => {
  localStorage.setItem(STORAGE_KEY, "dark");
  const { themePreference } = createThemePreference();
  expect(themePreference()).toBe("dark");
});

test.each([
  ["light", "light"],
  ["dark", "dark"],
  [undefined, "system"],
  ["", "system"],
  ["Dark", "system"],
  ["midnight", "system"],
])("reads %o from storage as %s", (stored, expected) => {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(STORAGE_KEY, stored);
  const { themePreference } = createThemePreference();
  expect(themePreference()).toBe(expected);
});

test("cycles system → light → dark and back, applying and persisting each", () => {
  localStorage.clear();
  const { themePreference, cycleThemePreference } = createThemePreference();
  document.documentElement.style.colorScheme = "";
  expect(themePreference()).toBe("system");
  // Nothing is applied at creation: the document's inline bootstrap owns the
  // first paint (see Document.ssr.test.tsx), this module owns the choice.
  expect(scheme()).toBe("");

  cycleThemePreference();
  flush();
  expect(themePreference()).toBe("light");
  expect(scheme()).toBe("light");
  expect(localStorage.getItem(STORAGE_KEY)).toBe("light");

  cycleThemePreference();
  flush();
  expect(themePreference()).toBe("dark");
  expect(scheme()).toBe("dark");
  expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");

  cycleThemePreference();
  flush();
  expect(themePreference()).toBe("system");
  // `light dark` hands the choice back to the OS, rather than leaving the
  // last explicit scheme in place.
  expect(scheme()).toBe("light dark");
  expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
});

test("falls back to system when storage cannot be read", () => {
  // Private browsing and blocked site data throw on access rather than
  // returning null, which is why the module reads through a try/catch.
  const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  try {
    const { themePreference } = createThemePreference();
    expect(themePreference()).toBe("system");
  } finally {
    getItem.mockRestore();
  }
});

test("still applies the scheme when storage cannot be written", () => {
  localStorage.clear();
  const { cycleThemePreference, themePreference } = createThemePreference();
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  try {
    cycleThemePreference();
    flush();
    expect(themePreference()).toBe("light");
    // The choice holds for this session even though it cannot be remembered.
    expect(scheme()).toBe("light");
  } finally {
    setItem.mockRestore();
  }
});
