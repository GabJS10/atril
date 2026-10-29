import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach } from "vitest";
import { useLocaleStore } from "../i18n";
import { useUpdateNoticeStore } from "../library/updates";

// jsdom does not implement scrolling; the router calls it on navigation.
Object.defineProperty(window, "scrollTo", { value: () => undefined, writable: true });

// Lazy route chunks and the mock IPC can exceed the 1 s default in a loaded parallel run.
configure({ asyncUtilTimeout: 4000 });

// Tests assert the Spanish copy; jsdom reports en-US, so pin the language instead of following it.
afterEach(() => {
  cleanup();
  clearMocks();
  useLocaleStore.getState().setLanguage("es");
  useUpdateNoticeStore.setState({ dismissed: false });
  document.documentElement.dataset.theme = "dark";
});
