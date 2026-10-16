import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevisionLink } from "./revision";

describe("RevisionLink", () => {
  it("links a pipeline hash to the commit", () => {
    render(<RevisionLink sha="abcdef1234567890" repository="musical-pig/OmniMod" />);
    const link = screen.getByRole("link", { name: "abcdef1" });
    expect(link.getAttribute("href")).toBe("https://github.com/musical-pig/OmniMod/commit/abcdef1234567890");
    const credit = screen.getByRole("link", { name: "© 2026 Musical Pig LLC" });
    expect(credit.getAttribute("href")).toBe("https://www.musical-pig.com");
    expect(credit.getAttribute("target")).toBe("_blank");
  });

  it("stays plain text for a local build", () => {
    render(<RevisionLink sha="local" repository="musical-pig/OmniMod" />);
    expect(screen.getByText("local").tagName).toBe("SPAN");
  });
});
