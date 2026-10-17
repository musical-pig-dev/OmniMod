import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMod } from "./mods.ts";
import {
  createRecoveryKey,
  importRecoveryKey,
  openVault,
  readPayload,
  seal,
  sealedRecord,
} from "./vault.ts";

describe("vault", () => {
  it("seals the library so the wrong key cannot read it", async () => {
    const secret = createRecoveryKey();
    const key = await importRecoveryKey(secret);
    assert.ok(key);
    const mod = createMod("Lanterns");
    mod.configs.nexus.fields.apiKey = "super-secret-token";
    const sealed = await seal(key, { mods: [mod], activeId: "missing" });
    assert.equal(sealed.includes("super-secret-token"), false);
    const opened = await openVault(secret, sealed);
    assert.equal(opened?.payload.mods[0]?.configs.nexus.fields.apiKey, "super-secret-token");
    assert.equal(opened?.payload.activeId, mod.id);
    assert.equal(await openVault(createRecoveryKey(), sealed), null);
    assert.equal(await openVault("not-a-key", sealed), null);
    assert.equal(await openVault(secret, "{"), null);
    const junk = await seal(key, { mods: "nope" } as never);
    assert.equal(await openVault(secret, junk), null);
    assert.equal(await importRecoveryKey("****"), null);
    assert.equal(await importRecoveryKey("aaaa"), null);
    assert.equal(readPayload(null), null);
    assert.equal(readPayload({ mods: "nope" }), null);
    assert.equal(readPayload({ mods: [] })?.activeId, "");
    assert.equal(readPayload({ mods: [mod], activeId: mod.id })?.activeId, mod.id);
    assert.equal(readPayload({ mods: [mod], activeId: 4 })?.activeId, mod.id);
    assert.equal(readPayload({ mods: [mod], activeId: mod.id, deployments: "no" })?.deployments.length, 0);
    const withDeploy = readPayload({
      mods: [mod],
      activeId: mod.id,
      deployments: [{ id: "d1", mod: "Lanterns", hosts: [{ id: "nexus", status: "error", name: "Nexus Mods" }] }],
    });
    assert.equal(withDeploy?.deployments[0]?.id, "d1");
    assert.equal(await openVault(secret, JSON.stringify({ v: 1, data: "aa" })), null);
    assert.equal(await openVault(secret, JSON.stringify({ v: 1, iv: "aa" })), null);
    assert.equal(sealedRecord(null), false);
    assert.equal(sealedRecord("x"), false);
    assert.equal(sealedRecord({ v: 2, iv: "a", data: "b" }), false);
    assert.equal(sealedRecord({ v: 1, iv: "a", data: "b" }), true);
  });
});
