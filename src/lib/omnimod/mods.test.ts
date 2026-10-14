import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultConfigs } from "./catalog.ts";
import {
  createMod,
  emptyTargets,
  hydrateMod,
  lastPublished,
  nextPatch,
  mergeAccount,
  modId,
  nameTaken,
  recordPublish,
  targetsFromConfigs,
  versionUsed,
} from "./mods.ts";

describe("mods", () => {
  it("keeps project ids on the mod and keys on the account", () => {
    const account = defaultConfigs();
    account.nexus.fields = { apiKey: "key", modId: "old" };
    account.steam.fields = { appId: "480", itemId: "9" };
    const targets = targetsFromConfigs(account);
    assert.equal(targets.nexus.modId, "old");
    assert.equal(targets.steam.itemId, "9");
    const merged = mergeAccount(account, {
      ...targets,
      nexus: { modId: "next" },
    });
    assert.equal(merged.nexus.fields.apiKey, "key");
    assert.equal(merged.nexus.fields.modId, "next");
    assert.equal(merged.steam.fields.appId, "480");
  });

  it("starts a mod with empty host settings", () => {
    const mod = createMod("Lanterns");
    assert.equal(mod.name, "Lanterns");
    assert.equal(mod.fileName, "");
    assert.equal(mod.configs.github.fields.token ?? "", "");
    assert.equal(Object.keys(mod.configs).length, 6);
  });

  it("copies account keys onto each mod separately", () => {
    const account = defaultConfigs();
    account.github.fields = { token: "shared", repo: "old/repo" };
    const targets = emptyTargets();
    const a = hydrateMod({ name: "A", targets: { ...targets, github: { repo: "a/a" } } }, account);
    const b = hydrateMod({ name: "B", targets: { ...targets, github: { repo: "b/b" } } }, account);
    a.configs.github.fields.token = "only-a";
    assert.equal(b.configs.github.fields.token, "shared");
    assert.equal(a.configs.github.fields.repo, "a/a");
    assert.equal(b.configs.github.fields.repo, "b/b");
  });

  it("treats names as the same regardless of case or surrounding spaces", () => {
    const mods = [{ id: "a", name: "Lanterns" }];
    assert.equal(nameTaken(mods, " lanterns "), true);
    assert.equal(nameTaken(mods, " lanterns ", "a"), false);
    assert.equal(nameTaken(mods, "   "), false);
    assert.equal(versionUsed(["1.0.0", " 1.4.2 "], "1.4.2"), true);
    assert.equal(versionUsed(["1.0.0"], "1.0.1"), false);
    assert.equal(versionUsed(["1.0.0"], "  "), false);
  });

  it("remembers a successful publish and clears the package draft", () => {
    const mod = { ...createMod("Lanterns"), fileName: "lanterns.zip", version: "1.4.2", changelog: "Glass." };
    const sent = recordPublish(mod, "1.4.2", true);
    assert.equal(sent.fileName, "");
    assert.equal(sent.version, "1.4.3");
    assert.equal(sent.changelog, "");
    assert.deepEqual(sent.publishedVersions, ["1.4.2"]);
    assert.equal(lastPublished(sent.publishedVersions), "1.4.2");
    const again = recordPublish({ ...sent, fileName: "lanterns.zip", version: "1.4.2", changelog: "Again." }, "1.4.2", true);
    assert.deepEqual(again.publishedVersions, ["1.4.2"]);
  });

  it("keeps the draft when every host rejects the upload", () => {
    const mod = { ...createMod("Lanterns"), fileName: "lanterns.zip", version: "1.4.2", changelog: "Glass." };
    const kept = recordPublish(mod, "1.4.2", false);
    assert.equal(kept, mod);
    assert.equal(lastPublished(kept.publishedVersions), "");
  });

  it("builds an id from crypto or the clock", () => {
    assert.match(modId({ randomUUID: () => "fixed" }), /^fixed$/);
    assert.match(modId(), /^[0-9a-f-]{36}$/);
    assert.match(modId({}), /^mod-\d+$/);
    assert.equal(createMod().name, "Untitled mod");
    assert.equal(createMod().version, "0.0.1");
  });

  it("clears a successful publish that has no version text", () => {
    const mod = { ...createMod("Lanterns"), fileName: "a.zip", version: " ", changelog: "x" };
    const sent = recordPublish(mod, "  ", true);
    assert.equal(sent.fileName, "");
    assert.deepEqual(sent.publishedVersions, []);
    assert.equal(lastPublished(["", "  ", "2.0.0"]), "2.0.0");
  });

  it("fills defaults when a saved mod is only partly there", () => {
    const named = hydrateMod(
      { configs: { nexus: { enabled: false, fields: { apiKey: "k" } } } as never },
      defaultConfigs(),
    );
    assert.equal(named.name, "Untitled mod");
    assert.equal(named.configs.nexus.enabled, false);
    assert.equal(named.configs.github.fields.token ?? "", "");
    const blank = hydrateMod({ name: "", publishedVersions: "nope" as never }, defaultConfigs());
    assert.equal(blank.name, "Untitled mod");
    assert.deepEqual(blank.publishedVersions, []);
    assert.equal(versionUsed(undefined, "1.0.0"), false);
    assert.equal(lastPublished(undefined), "");
    assert.equal(lastPublished(["", " "]), "");
    assert.equal(nextPatch("1.4.2"), "1.4.3");
    assert.equal(nextPatch("v1.0.9"), "v1.0.10");
    assert.equal(nextPatch("1.02"), "1.03");
    assert.equal(nextPatch("beta"), "");
    assert.equal(nextPatch("  "), "");
  });

  it("keeps published versions when a saved mod is loaded", () => {
    const mod = hydrateMod({ name: "Lanterns", publishedVersions: ["1.0.0", "1.4.2"] }, defaultConfigs());
    assert.deepEqual(mod.publishedVersions, ["1.0.0", "1.4.2"]);
    assert.equal(lastPublished(mod.publishedVersions), "1.4.2");
  });
});
