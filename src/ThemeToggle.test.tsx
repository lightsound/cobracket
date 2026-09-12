/**
 * The theme button: one control whose label is the state. Under the gate, so
 * the label has to stay reactive — a snapshot read of `themePreference()` at
 * the component body's top level would freeze it and report
 * `[STRICT_READ_UNTRACKED]`.
 */
import { expect, test } from "vite-plus/test";
import { flush } from "solid-js";
import { mount } from "./test-setup";
import { setLocale } from "./i18n";
import ThemeToggle from "./ThemeToggle";

setLocale("en");

function mountToggle(): HTMLButtonElement {
  const host = mount(() => <ThemeToggle />);
  const button = host.querySelector("button");
  if (!button) throw new Error("no theme button");
  return button;
}

test("names the preference in force, and cycles it on click", () => {
  const button = mountToggle();
  expect(button.textContent?.trim()).toBe("Theme: Auto");

  for (const label of ["Theme: Light", "Theme: Dark", "Theme: Auto"]) {
    button.click();
    flush();
    expect(button.textContent?.trim()).toBe(label);
  }
});

test("sets the document's color scheme from the choice", () => {
  const button = mountToggle();
  button.click();
  flush();
  expect(document.documentElement.style.colorScheme).toBe("light");
  button.click();
  flush();
  expect(document.documentElement.style.colorScheme).toBe("dark");
  // Back to Auto, so the next test in this file starts where this one did.
  button.click();
  flush();
  expect(document.documentElement.style.colorScheme).toBe("light dark");
});
