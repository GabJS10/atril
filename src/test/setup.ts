import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach } from "vitest";
import { useLocaleStore } from "../i18n";

// jsdom does not implement scrolling; the router calls it on navigation.
Object.defineProperty(window, "scrollTo", { value: () => undefined, writable: true });

// Tests assert the Spanish copy; jsdom reports en-US, so pin the language instead of following it.
afterEach(() => {
  cleanup();
  clearMocks();
  useLocaleStore.getState().setLanguage("es");
});
