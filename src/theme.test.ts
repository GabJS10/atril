import { describe, expect, it } from "vitest";
import { applyTheme } from "./theme";

describe("applyTheme", () => {
  it("writes the theme to data-theme on the given element", () => {
    const root = document.createElement("html");

    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");

    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
  });
});
