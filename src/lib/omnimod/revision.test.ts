import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { revisionHref, revisionLabel } from "./revision.ts";

describe("revision", () => {
  it("labels a pipeline commit and a local build", () => {
    assert.equal(revisionLabel(undefined), "local");
    assert.equal(revisionLabel("  "), "local");
    assert.equal(revisionLabel("local"), "local");
    assert.equal(revisionLabel("abcdef1234567890"), "abcdef1");
  });

  it("links only a real commit in an owner/repo", () => {
    assert.equal(revisionHref("local", "musical-pig/OmniMod"), null);
    assert.equal(revisionHref("abc", ""), null);
    assert.equal(revisionHref("abc", "not a repo"), null);
    assert.equal(revisionHref("abc", "onlyowner"), null);
    assert.equal(
      revisionHref("abc", "/musical-pig/OmniMod/"),
      "https://github.com/musical-pig/OmniMod/commit/abc",
    );
  });
});
