import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COMMANDS, CommandPalette, filterCommands } from "./command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("filterCommands", () => {
  it("returns every command for an empty query", () => {
    expect(filterCommands("")).toHaveLength(COMMANDS.length);
    expect(filterCommands("   ")).toHaveLength(COMMANDS.length);
  });

  it("narrows by label substring", () => {
    expect(filterCommands("conf").map((c) => c.id)).toEqual(["conflicts"]);
  });

  it("matches on keywords, not just the label", () => {
    expect(filterCommands("replay").map((c) => c.id)).toEqual(["events"]);
    expect(filterCommands("time-travel").map((c) => c.id)).toEqual(["audit"]);
  });

  it("returns nothing for an unmatched query", () => {
    expect(filterCommands("zzz")).toEqual([]);
  });
});

describe("CommandPalette", () => {
  beforeEach(() => push.mockClear());

  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("filters as you type and navigates on Enter", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByRole("textbox", { name: /search/i });

    await user.type(input, "conf");
    expect(screen.getByText("Conflicts")).toBeTruthy();
    expect(screen.queryByText("Invoices")).toBeNull();

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/conflicts");
  });

  it("navigates to the clicked result", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);
    await user.click(screen.getByText("Audit"));
    expect(push).toHaveBeenCalledWith("/audit");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
