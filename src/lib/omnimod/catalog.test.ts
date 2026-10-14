import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  acceptFiles,
  accountFields,
  defaultConfigs,
  fieldValue,
  hostLimitDetail,
  isConfigured,
  modFields,
  platformById,
  readiness,
  uploadHint,
  uploadRule,
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

  it("limits the upload to the strictest host that has keys", () => {
    const configs = defaultConfigs();
    assert.equal(hostLimitDetail("modrinth"), "More than one file, up to 500 MiB each.");
    assert.equal(hostLimitDetail("github"), "More than one file, up to 2 GiB each.");
    assert.equal(hostLimitDetail("curseforge"), "One archive, up to 2 GB.");
    assert.equal(hostLimitDetail("thunderstore"), "One archive, up to 5 GB.");
    assert.equal(hostLimitDetail("nexus"), "One archive. No published size cap.");
    assert.equal(hostLimitDetail("steam"), "One archive. No published size cap.");
    const fill = (id: PlatformId) => {
      configs[id] = {
        enabled: true,
        fields: Object.fromEntries(platformById(id).fields.map((field) => [field.key, "set"])),
      };
    };
    fill("thunderstore");
    const thunder = uploadRule(configs);
    assert.equal(thunder.maxBytes, 5_242_880_000);
    assert.equal(thunder.multiple, false);
    assert.equal(uploadHint(thunder), "One archive. Largest file 5 GB.");
    fill("curseforge");
    const both = uploadRule(configs);
    assert.equal(both.maxBytes, 2 * 1024 * 1024 * 1024 - 1);
    assert.equal(both.multiple, false);
    configs.thunderstore.enabled = false;
    configs.curseforge.enabled = false;
    fill("modrinth");
    fill("github");
    const loose = uploadRule(configs);
    assert.equal(loose.multiple, true);
    assert.equal(loose.label, "500 MiB");
    assert.match(uploadHint(loose), /More than one file/);
    configs.modrinth = { enabled: true, fields: { token: "only-the-key" } };
    const partial = uploadRule({ ...defaultConfigs(), github: configs.github, modrinth: configs.modrinth });
    assert.equal(partial.hosts, 1);
    assert.equal(partial.label, "2 GiB");
    const nexusOnly = defaultConfigs();
    nexusOnly.nexus = {
      enabled: true,
      fields: Object.fromEntries(platformById("nexus").fields.map((field) => [field.key, "set"])),
    };
    const nexus = uploadRule(nexusOnly);
    assert.equal(nexus.maxBytes, null);
    assert.equal(uploadHint(nexus), "One archive. No size cap from these hosts.");
    const taken = acceptFiles(
      [
        { name: "a-1.2.3.zip", size: 10 },
        { name: "b.zip", size: 500 * 1024 * 1024 + 1 },
      ],
      loose,
      "",
    );
    assert.equal(taken.ok, false);
    assert.equal(acceptFiles([], loose, "").ok, false);
    const one = acceptFiles(
      [
        { name: "pack-2.0.1.zip", size: 4 },
        { name: "extra.zip", size: 4 },
      ],
      thunder,
      "",
    );
    assert.equal(one.ok && one.fileName, "pack-2.0.1.zip");
    assert.equal(one.ok && one.version, "2.0.1");
    const kept = acceptFiles([{ name: "pack-9.9.9.zip", size: 4 }], thunder, "1.0.0");
    assert.equal(kept.ok && kept.version, "1.0.0");
    const named = acceptFiles([{ name: "plain.zip", size: 4 }], thunder, "");
    assert.equal(named.ok && named.version, "");
  });
});
