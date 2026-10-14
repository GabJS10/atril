import { describe, expect, it } from "vitest";
import { classifyOpenError } from "./openError";

describe("classifyOpenError", () => {
  it("tells a missing file from an unreadable one", () => {
    expect(classifyOpenError({ code: "file_missing", message: "gone" })).toBe("missing");
    expect(classifyOpenError({ code: "invalid_pdf", message: "broken" })).toBe("unreadable");
  });

  it("treats anything else as a generic failure", () => {
    expect(classifyOpenError({ code: "db", message: "locked" })).toBe("other");
    expect(classifyOpenError(new Error("boom"))).toBe("other");
    expect(classifyOpenError(undefined)).toBe("other");
  });
});
