import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import { PageField } from "./PageField";

describe("PageField", () => {
  beforeEach(() => useLocaleStore.getState().setLanguage("es"));

  it("shows the current page and the total", () => {
    render(<PageField page={12} pageCount={176} onGoTo={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Ir a la página" })).toHaveValue("12");
    expect(screen.getByText("/ 176")).toBeInTheDocument();
  });

  it("goes to the typed page on Enter", async () => {
    const onGoTo = vi.fn();
    render(<PageField page={12} pageCount={176} onGoTo={onGoTo} />);
    const field = screen.getByRole("textbox");
    await userEvent.click(field);
    await userEvent.keyboard("40{Enter}");
    expect(onGoTo).toHaveBeenCalledWith(40);
    expect(field).not.toHaveFocus();
  });

  it("keeps the page inside the book and ignores what is not a number", async () => {
    const onGoTo = vi.fn();
    render(<PageField page={12} pageCount={176} onGoTo={onGoTo} />);
    const field = screen.getByRole("textbox");
    await userEvent.click(field);
    await userEvent.keyboard("9999{Enter}");
    expect(onGoTo).toHaveBeenLastCalledWith(176);
    await userEvent.click(field);
    await userEvent.keyboard("ab{Enter}");
    expect(onGoTo).toHaveBeenCalledTimes(1);
  });

  it("puts the current page back on Escape or when it loses focus", async () => {
    const onGoTo = vi.fn();
    render(<PageField page={12} pageCount={176} onGoTo={onGoTo} />);
    const field = screen.getByRole("textbox");
    await userEvent.click(field);
    await userEvent.keyboard("55{Escape}");
    expect(field).toHaveValue("12");
    await userEvent.click(field);
    await userEvent.keyboard("66");
    await userEvent.tab();
    expect(field).toHaveValue("12");
    expect(onGoTo).not.toHaveBeenCalled();
  });
});
