import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultConfigs } from "./catalog.ts";
import { createMod } from "./mods.ts";
import {
  formatBytes,
  loadConfigs,
  loadLibrary,
  studioDelay,
  studioResponse,
  studioTransport,
  wait,
} from "./storage.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
    setItem(key: string, value: string) {
      values[key] = value;
    },
  };
}

describe("storage", () => {
  it("formats byte sizes", () => {
    assert.equal(formatBytes(12), "12 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(2 * 1024 * 1024), "2 MB");
  });

  it("loads account configs and ignores bad storage", () => {
    assert.equal(loadConfigs(null).nexus.enabled, true);
    const missingFields = loadConfigs(
      memoryStorage({ "omnimod-configs-v1": JSON.stringify({ nexus: { enabled: true } }) }),
    );
    assert.equal(missingFields.nexus.fields.apiKey ?? "", "");
    assert.equal(loadLibrary(defaultConfigs(), null).mods[0]?.name, "Untitled mod");
    assert.equal(loadConfigs(memoryStorage()).github.enabled, true);
    const saved = loadConfigs(
      memoryStorage({
        "omnimod-configs-v1": JSON.stringify({
          nexus: { enabled: false, fields: { apiKey: "k" } },
          nope: { fields: {} },
          github: "bad",
        }),
      }),
    );
    assert.equal(saved.nexus.fields.apiKey, "k");
    assert.equal(saved.nexus.enabled, true);
    assert.equal(loadConfigs(memoryStorage({ "omnimod-configs-v1": "not-json" })).nexus.enabled, true);
    assert.equal(loadConfigs(memoryStorage({ "omnimod-configs-v1": "null" })).nexus.enabled, true);
  });

  it("loads a library, an empty library, and a broken library", () => {
    const mod = createMod("Lanterns");
    const stored = memoryStorage({
      "omnimod-mods-v1": JSON.stringify([mod]),
      "omnimod-active-mod": mod.id,
    });
    assert.equal(loadLibrary(defaultConfigs(), stored).activeId, mod.id);
    stored.setItem("omnimod-active-mod", "missing");
    assert.equal(loadLibrary(defaultConfigs(), stored).activeId, mod.id);
    assert.deepEqual(loadLibrary(defaultConfigs(), memoryStorage({ "omnimod-mods-v1": "[]" })), {
      mods: [],
      activeId: "",
    });
    const fresh = loadLibrary(defaultConfigs(), memoryStorage({ "omnimod-mods-v1": "{" }));
    assert.equal(fresh.mods[0]?.name, "Untitled mod");
    const notArray = loadLibrary(defaultConfigs(), memoryStorage({ "omnimod-mods-v1": "{}" }));
    assert.equal(notArray.mods.length, 1);
    assert.equal(loadLibrary(defaultConfigs(), undefined).mods[0]?.name, "Untitled mod");
  });

  it("answers the rehearsal transport", async () => {
    assert.equal(studioDelay("modrinth"), 420 + (8 % 5) * 160);
    const refused = studioResponse("nexus", { fileName: "a.zip", version: "0.0.0", changelog: "x" });
    assert.equal(refused.ok, false);
    const github = studioResponse("github", { fileName: "notes.txt", version: "1.0.0", changelog: "x" });
    assert.equal(github.ok, false);
    const ok = studioResponse("steam", { fileName: "A.ZIP", version: "1.0.0", changelog: "x" });
    assert.equal(ok.ok, true);
    let waited = 0;
    const transport = studioTransport(
      () => 5,
      (ms) =>
        wait(ms, (resolve) => {
          waited = ms;
          resolve();
        }),
    );
    const sent = await transport("curseforge", { fileName: "a.zip", version: "1.2.3", changelog: "x" });
    assert.equal(sent.ok, true);
    assert.equal(waited, 5);
    await wait(0);
    const live = await studioTransport()("nexus", { fileName: "a.zip", version: "1.0.0", changelog: "c" });
    assert.equal(live.ok, true);
  });
});
