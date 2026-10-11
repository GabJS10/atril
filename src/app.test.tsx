import { render, screen } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createQueryClient } from "./api/queries";
import type { Settings } from "./api/types";
import { createAppRouter } from "./router";

function mockSettings(language: Settings["language"]) {
  mockIPC((cmd) => {
    if (cmd === "get_settings") {
      return {
        language,
        theme: "dark",
        defaultZoom: "page_width",
        defaultViewMode: "normal",
      } satisfies Settings;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

describe("app shell", () => {
  it("shows the empty library at / in Spanish when the setting is 'es'", async () => {
    mockSettings("es");
    renderAt("/");

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
  });

  it("switches the copy to English when the setting is 'en'", async () => {
    mockSettings("en");
    renderAt("/");

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("renders the empty reader for /read/$bookId with the book id", async () => {
    mockSettings("es");
    renderAt("/read/abc123");

    expect(await screen.findByText("Aquí irá el lector.")).toBeInTheDocument();
    expect(document.querySelector("[data-book-id]")).toHaveAttribute("data-book-id", "abc123");
  });

  it("renders a localized not-found page for unknown routes", async () => {
    mockSettings("es");
    renderAt("/no-existe");

    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });
});
