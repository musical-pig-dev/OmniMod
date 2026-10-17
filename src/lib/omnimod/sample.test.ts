import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { freshSample, sampleBundle } from "./sample.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("sample", () => {
  it("stays empty unless the sample flag is on", () => {
    assert.equal(sampleBundle(), null);
    assert.equal(freshSample(), null);
  });

  it("builds three mods, three submissions, and three bugs", () => {
    vi.stubEnv("VITE_OMNIMOD_SAMPLE", "1");
    const sample = sampleBundle();
    assert.equal(sample?.bugs, 3);
    assert.deepEqual(sample?.mods.map((mod) => mod.name), ["Lanterns", "Glass Moths", "Harbor Bells"]);
    assert.equal(sample?.deployments.length, 3);
    assert.equal(sample?.deployments[1]?.hosts.some((host) => host.status === "error"), true);
    assert.equal(freshSample()?.mods[0]?.name, "Lanterns");
    localStorage.setItem("omnimod-vault-v3", "sealed");
    assert.equal(freshSample(), null);
    localStorage.removeItem("omnimod-vault-v3");
    localStorage.setItem("omnimod-mods-v3", JSON.stringify([{ id: "kept" }]));
    assert.equal(freshSample(), null);
    localStorage.setItem("omnimod-mods-v3", "[]");
    assert.equal(freshSample()?.bugs, 3);
    localStorage.setItem("omnimod-mods-v3", "{");
    assert.equal(freshSample()?.bugs, 3);
    localStorage.setItem("omnimod-mods-v3", "{}");
    assert.equal(freshSample()?.bugs, 3);
    vi.stubEnv("VITE_OMNIMOD_SAMPLE", "0");
    assert.equal(sampleBundle(), null);
  });
});
