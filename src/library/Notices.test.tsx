import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ImportResult } from "../api/types";
import { ImportNotice } from "./Notices";
import { importResultKey } from "./useFileDrop";

describe("ImportNotice", () => {
  it("names a refused Windows file by its name, not by its folder", () => {
    const client = new QueryClient();
    const result: ImportResult = {
      imported: [],
      rejected: [
        { path: "C:\\Users\\x\\Libros\\a.pdf", error: { code: "invalid_pdf", message: "not a PDF" } },
      ],
    };
    client.setQueryData(importResultKey, result);

    render(
      <QueryClientProvider client={client}>
        <ImportNotice />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/^a\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/Users/)).not.toBeInTheDocument();
  });
});
