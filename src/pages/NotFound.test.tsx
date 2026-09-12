import { expect, test } from "vite-plus/test";
import { setLocale } from "../i18n";
import { mount } from "../test-setup";
import NotFound from "./NotFound";

setLocale("en");

test("offers the way home", () => {
  const host = mount(() => <NotFound />);
  expect(host.querySelector("p")?.textContent).toContain("not found");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/");
});
