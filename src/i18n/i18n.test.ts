import { describe, expect, it } from "vitest";
import { getT, resolveLocale, useLocaleStore } from "./index";
import { en } from "./en";
import { es } from "./es";

describe("resolveLocale", () => {
  it("follows the system language when the setting is 'system'", () => {
    expect(resolveLocale("system", "es-ES")).toBe("es");
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
  });

  it("uses an explicit language regardless of the system", () => {
    expect(resolveLocale("en", "es-ES")).toBe("en");
    expect(resolveLocale("es", "en-US")).toBe("es");
  });
});

describe("dictionaries", () => {
  it("en has exactly the same keys as es", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it("getT interpolates {vars} and keeps unknown placeholders", () => {
    const { setLanguage } = useLocaleStore.getState();
    setLanguage("es");
    const t = getT();
    expect(t("app.name")).toBe("Atril");
    expect(t("notFound.title")).toBe("Página no encontrada");
    expect(t("notFound.title", { unused: "x" })).toBe("Página no encontrada");
  });

  it("getT follows the store locale at call time", () => {
    const { setLanguage } = useLocaleStore.getState();
    setLanguage("en");
    expect(getT()("library.empty.title")).toBe("Your library is empty");
    setLanguage("es");
    expect(getT()("library.empty.title")).toBe("Tu biblioteca está vacía");
  });
});
