import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUG_BOARD, resetBugLookup } from "@/lib/omnimod/bugs";
import { RevisionLink } from "./revision";

afterEach(() => {
  resetBugLookup();
  vi.unstubAllGlobals();
});

describe("RevisionLink", () => {
  it("links a pipeline hash to the commit", () => {
    render(<RevisionLink sha="abcdef1234567890" repository="musical-pig/OmniMod" bugs={0} />);
    const link = screen.getByRole("link", { name: "abcdef1" });
    expect(link.getAttribute("href")).toBe("https://github.com/musical-pig/OmniMod/commit/abcdef1234567890");
    const credit = screen.getByRole("link", { name: "© 2026 Musical Pig LLC" });
    expect(credit.getAttribute("href")).toBe("https://www.musical-pig.com");
    expect(credit.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: /open bug/ })).toBeNull();
  });

  it("stays plain text for a local build", () => {
    render(<RevisionLink sha="local" repository="musical-pig/OmniMod" bugs={0} />);
    expect(screen.getByText("local").tagName).toBe("SPAN");
  });

  it("shows one bug without a count and several bugs with a count", () => {
    const one = render(<RevisionLink bugs={1} />);
    const single = screen.getByRole("link", { name: "1 open bug" });
    expect(single.getAttribute("href")).toBe(BUG_BOARD);
    expect(single.getAttribute("target")).toBe("_blank");
    expect(single.textContent).toBe("");
    one.unmount();
    render(<RevisionLink bugs={3} />);
    expect(screen.getByRole("link", { name: "3 open bugs" }).textContent).toContain("3");
  });

  it("looks up the open bug count and ignores a late reply", async () => {
    let release: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<RevisionLink />);
    view.unmount();
    release({ ok: true, json: async () => ({ total_count: 4 }) });
    resetBugLookup();
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ total_count: 4 }) }));
    render(<RevisionLink />);
    expect(await screen.findByRole("link", { name: "4 open bugs" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("link", { name: "4 open bugs" })).toBeTruthy());
  });
});
