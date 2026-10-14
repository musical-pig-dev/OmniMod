import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  accountFields,
  defaultConfigs,
  fieldValue,
  isConfigured,
  modFields,
  platformById,
  readiness,
  type PlatformId,
} from "./catalog.ts";

describe("catalog", () => {
  it("splits account keys from per-mod ids", () => {
    const nexus = platformById("nexus");
    assert.deepEqual(accountFields(nexus).map((field) => field.key), ["apiKey"]);
    assert.deepEqual(modFields(nexus).map((field) => field.key), ["modId"]);
    assert.deepEqual(accountFields(platformById("thunderstore")).map((field) => field.key), ["token", "namespace"]);
    assert.deepEqual(modFields(platformById("steam")).map((field) => field.key), ["appId", "itemId"]);
  });

  it("trims field values and reports readiness", () => {
    const platform = platformById("nexus");
    const empty = defaultConfigs().nexus;
    assert.equal(fieldValue(empty, "apiKey"), "");
    assert.equal(fieldValue({ enabled: true, fields: { apiKey: "  k  " } }, "apiKey"), "k");
    assert.equal(readiness(platform, empty), "needs-setup");
    assert.equal(readiness(platform, { enabled: false, fields: { apiKey: "k", modId: "1" } }), "off");
    assert.equal(isConfigured(platform, { enabled: true, fields: { apiKey: "k", modId: "1" } }), true);
    assert.equal(readiness(platform, { enabled: true, fields: { apiKey: "k", modId: "1" } }), "ready");
  });

  it("rejects an unknown platform id", () => {
    assert.throws(() => platformById("nope" as PlatformId), /Unknown platform nope/);
  });
});
