import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { BUG_BOARD, openBugs, resetBugLookup } from "./bugs.ts";

afterEach(() => {
  resetBugLookup();
  vi.unstubAllGlobals();
});

describe("bugs", () => {
  it("points at the open bug board", () => {
    assert.match(BUG_BOARD, /label%3Abug/);
  });

  it("counts open bugs and hides a bad lookup", async () => {
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => ({ total_count: 3.8 }) })), 3);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => ({ total_count: 0 }) })), 0);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => ({ total_count: -2 }) })), 0);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => ({ total_count: Number.NaN }) })), 0);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => ({ total_count: "3" }) })), 0);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => null })), 0);
    assert.equal(await openBugs(async () => ({ ok: true, json: async () => "no" })), 0);
    assert.equal(await openBugs(async () => ({ ok: false, json: async () => ({ total_count: 4 }) })), 0);
    assert.equal(
      await openBugs(async () => ({
        ok: true,
        json: async () => {
          throw new Error("bad");
        },
      })),
      0,
    );
    assert.equal(
      await openBugs(async () => {
        throw new Error("offline");
      }),
      0,
    );
  });

  it("caches the default lookup until it is reset", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      async () => {
        calls += 1;
        return { ok: true, json: async () => ({ total_count: 2 }) };
      },
    );
    assert.equal(await openBugs(), 2);
    assert.equal(await openBugs(), 2);
    assert.equal(calls, 1);
    resetBugLookup();
    assert.equal(await openBugs(), 2);
    assert.equal(calls, 2);
  });
});
