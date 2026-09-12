/**
 * The theme preference, which is a browser-only value read at module load.
 *
 * Solid 2 client mode mounts into an empty body, so there is no hydration
 * mismatch to defend against: the signal reads `localStorage` directly when it
 * is created, rather than starting neutral and adopting the stored value after
 * mount (the React reflex, which would overwrite what the user chose). That is
 * the behaviour the first test pins, and the reason every case here loads the
 * module *after* arranging storage.
 */
import { expect, test, vi } from "vite-plus/test";
import { flush } from "solid-js";

const STORAGE_KEY = "cobracket:theme";

type ThemeModule = typeof import("./theme-preference");

/** A fresh module instance, so the load-time read is part of the subject. */
async function load(stored?: string): Promise<ThemeModule> {
  vi.resetModules();
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(STORAGE_KEY, stored);
  return import("./theme-preference");
}

const scheme = () => document.documentElement.style.colorScheme;

test("adopts a stored preference when the signal is created", async () => {
  const { themePreference } = await load("dark");
  expect(themePreference()).toBe("dark");
});

test.each([
  ["light", "light"],
  ["dark", "dark"],
  [undefined, "system"],
  ["", "system"],
  ["Dark", "system"],
  ["midnight", "system"],
])("reads %o from storage as %s", async (stored, expected) => {
  const { themePreference } = await load(stored);
  expect(themePreference()).toBe(expected);
});

test("cycles system → light → dark and back, applying and persisting each", async () => {
  const { themePreference, cycleThemePreference } = await load();
  document.documentElement.style.colorScheme = "";
  expect(themePreference()).toBe("system");
  // Nothing is applied at load: the document's inline bootstrap owns the
  // first paint (see Document.test.tsx), this module owns the choice.
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

test("falls back to system when storage cannot be read", async () => {
  // Private browsing and blocked site data throw on access rather than
  // returning null, which is why the module reads through a try/catch.
  const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  try {
    const { themePreference } = await load("dark");
    expect(themePreference()).toBe("system");
  } finally {
    getItem.mockRestore();
  }
});

test("still applies the scheme when storage cannot be written", async () => {
  const { cycleThemePreference, themePreference } = await load();
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
