import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "./Segmented";

describe("Segmented", () => {
  const options = [
    { value: "normal" as const, label: "Normal" },
    { value: "sepia" as const, label: "Sepia" },
  ];

  it("marks the chosen option as pressed", () => {
    render(<Segmented label="Papel" options={options} value="sepia" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sepia" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the option that was clicked", () => {
    const onChange = vi.fn();
    render(<Segmented label="Papel" options={options} value="normal" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sepia" }));

    expect(onChange).toHaveBeenCalledWith("sepia");
  });

  it("is a labelled group", () => {
    render(<Segmented label="Papel" options={options} value="normal" onChange={vi.fn()} />);

    expect(screen.getByRole("group", { name: "Papel" })).toBeTruthy();
  });
});
