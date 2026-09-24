import { expect, test } from "vite-plus/test";
import { AppProviders } from "../providers";
import { mount } from "../test-setup";
import NotFound from "./NotFound";

localStorage.setItem("cobracket:locale", "en");

test("offers the way home", () => {
  const host = mount(() => (
    <AppProviders>
      <NotFound />
    </AppProviders>
  ));
  expect(host.querySelector("p")?.textContent).toContain("not found");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/");
});
