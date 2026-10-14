import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { decideMainBuild, testConclusion } from "./ci-gate.ts";

describe("decideMainBuild", () => {
  const tree = "abc123";

  it("skips tests and builds the extension when main matches a tested develop tree", () => {
    assert.equal(
      decideMainBuild({ mainTree: tree, developTree: ` ${tree} `, developTests: "success" }),
      "build-extension",
    );
  });

  it("runs tests when the trees differ or develop did not pass", () => {
    assert.equal(decideMainBuild({ mainTree: tree, developTree: "other", developTests: "success" }), "run-tests");
    assert.equal(decideMainBuild({ mainTree: tree, developTree: tree, developTests: "failure" }), "run-tests");
    assert.equal(decideMainBuild({ mainTree: tree, developTree: tree, developTests: "pending" }), "run-tests");
    assert.equal(decideMainBuild({ mainTree: tree, developTree: tree, developTests: "none" }), "run-tests");
    assert.equal(decideMainBuild({ mainTree: "  ", developTree: "", developTests: "success" }), "run-tests");
  });

  it("reads a GitHub check conclusion", () => {
    assert.equal(testConclusion("success"), "success");
    assert.equal(testConclusion(" failure "), "failure");
    assert.equal(testConclusion("cancelled"), "failure");
    assert.equal(testConclusion("timed_out"), "failure");
    assert.equal(testConclusion("startup_failure"), "failure");
    assert.equal(testConclusion("queued"), "pending");
    assert.equal(testConclusion(""), "none");
    assert.equal(testConclusion(null), "none");
    assert.equal(testConclusion("null"), "none");
  });
});
