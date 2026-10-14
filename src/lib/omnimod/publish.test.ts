import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultConfigs, type ConfigMap, type PlatformId } from "./catalog.ts";
import { planPublish, practiceFields, practiceValue, readyCount, runPublish, type Transport } from "./publish.ts";

const input = {
  fileName: "lanterns.zip",
  version: "1.4.2",
  changelog: "Softer glass.",
};

function withReady(ids: PlatformId[]): ConfigMap {
  const configs = defaultConfigs();
  const fieldsById: Record<PlatformId, Record<string, string>> = {
    nexus: { apiKey: "k", modId: "1" },
    curseforge: { token: "t", projectId: "2" },
    modrinth: { token: "t", project: "slug" },
    github: { token: "t", repo: "a/b" },
    thunderstore: { token: "t", namespace: "Team" },
    steam: { appId: "480", itemId: "9" },
  };
  for (const id of ids) {
    configs[id] = { enabled: true, fields: fieldsById[id] };
  }
  return configs;
}

describe("planPublish", () => {
  it("skips every site when nothing is configured", () => {
    const plan = planPublish(defaultConfigs(), input);
    assert.equal(plan.length, 6);
    assert.ok(plan.every((entry) => entry.action === "skip" && entry.reason === "missing-credentials"));
    assert.equal(readyCount(defaultConfigs(), input), 0);
  });

  it("publishes only configured and enabled sites", () => {
    const configs = withReady(["modrinth", "github"]);
    configs.github.enabled = false;
    const plan = planPublish(configs, input);
    const publish = plan.filter((entry) => entry.action === "publish").map((entry) => entry.id);
    assert.deepEqual(publish, ["modrinth"]);
    const github = plan.find((entry) => entry.id === "github");
    assert.equal(github?.action, "skip");
    if (github?.action === "skip") assert.equal(github.reason, "disabled");
  });

  it("treats whitespace-only credentials as missing", () => {
    const configs = defaultConfigs();
    configs.nexus = { enabled: true, fields: { apiKey: "   ", modId: "1" } };
    const nexus = planPublish(configs, input).find((entry) => entry.id === "nexus");
    assert.equal(nexus?.action, "skip");
    if (nexus?.action === "skip") assert.equal(nexus.reason, "missing-credentials");
  });

  it("needs the project id as well as the key", () => {
    const configs = defaultConfigs();
    configs.nexus = { enabled: true, fields: { apiKey: "k" } };
    configs.steam = { enabled: true, fields: { appId: "480", itemId: "9" } };
    const plan = planPublish(configs, input);
    const nexus = plan.find((entry) => entry.id === "nexus");
    assert.equal(nexus?.action, "skip");
    if (nexus?.action === "skip") assert.equal(nexus.reason, "missing-credentials");
    assert.equal(plan.find((entry) => entry.id === "steam")?.action, "publish");
    assert.equal(readyCount(configs, input), 1);
  });

  it("explains a skipped package and falls back to a practice value", async () => {
    const results = await runPublish({
      input: { fileName: "  ", version: "1.0.0", changelog: "x" },
      configs: withReady(["nexus"]),
      transport: async () => ({ ok: true }),
    });
    assert.match(results.find((result) => result.id === "nexus")!.message, /No package selected/);
    const seen: Array<string | null> = [];
    await runPublish({
      input: { fileName: "  ", version: "1.0.0", changelog: "x" },
      configs: withReady(["nexus"]),
      transport: async () => ({ ok: true }),
      onProgress: (progress) => seen.push(progress.current),
    });
    assert.deepEqual(seen, [null]);
    assert.equal(practiceValue("missing"), "practice");
    assert.equal(practiceFields("nexus").apiKey, "practice-nexus-key");
  });

  it("does not contact ready sites when no package is selected", () => {
    const configs = withReady(["nexus"]);
    const nexus = planPublish(configs, { ...input, fileName: "  " }).find((entry) => entry.id === "nexus");
    assert.equal(nexus?.action, "skip");
    if (nexus?.action === "skip") assert.equal(nexus.reason, "no-package");
  });
});

describe("runPublish", () => {
  it("never calls the transport for skipped sites", async () => {
    const called: PlatformId[] = [];
    const transport: Transport = async (id) => {
      called.push(id);
      return { ok: true };
    };
    const results = await runPublish({
      input,
      configs: withReady(["curseforge"]),
      transport,
    });
    assert.deepEqual(called, ["curseforge"]);
    assert.equal(results.filter((result) => result.status === "success").length, 1);
    assert.equal(results.filter((result) => result.status === "skipped").length, 5);
    assert.match(results.find((result) => result.id === "nexus")!.message, /needs account/i);
    assert.match(results.find((result) => result.id === "curseforge")!.message, /accepted 1\.4\.2/);
  });

  it("keeps going when one host rejects the upload", async () => {
    const configs = withReady(["modrinth", "github", "thunderstore"]);
    const transport: Transport = async (id) => {
      if (id === "github") return { ok: false, message: "Repository is archived." };
      return { ok: true };
    };
    const results = await runPublish({ input, configs, transport });
    assert.equal(results.find((result) => result.id === "modrinth")?.status, "success");
    assert.equal(results.find((result) => result.id === "github")?.status, "error");
    assert.match(results.find((result) => result.id === "github")!.message, /archived/);
    assert.equal(results.find((result) => result.id === "thunderstore")?.status, "success");
    assert.match(results.find((result) => result.id === "thunderstore")!.message, /accepted 1\.4\.2/);
  });

  it("records thrown transport errors without aborting the rest", async () => {
    const configs = withReady(["nexus", "thunderstore"]);
    const transport: Transport = async (id) => {
      if (id === "nexus") throw new Error("HTTP 401");
      return { ok: true };
    };
    const results = await runPublish({ input, configs, transport });
    assert.equal(results.find((result) => result.id === "nexus")?.status, "error");
    assert.match(results.find((result) => result.id === "nexus")!.message, /401/);
    assert.equal(results.find((result) => result.id === "thunderstore")?.status, "success");
  });

  it("notes a missing changelog on success", async () => {
    const results = await runPublish({
      input: { ...input, changelog: "  " },
      configs: withReady(["modrinth"]),
      transport: async () => ({ ok: true }),
    });
    assert.match(results.find((result) => result.id === "modrinth")!.message, /No changelog/);
  });

  it("uses an empty rejection message fallback", async () => {
    const results = await runPublish({
      input,
      configs: withReady(["github"]),
      transport: async () => ({ ok: false, message: "" }),
    });
    assert.match(results.find((result) => result.id === "github")!.message, /rejected/i);
  });

  it("labels a non-Error throw", async () => {
    const results = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => {
        throw "nope";
      },
    });
    assert.match(results.find((result) => result.id === "nexus")!.message, /Request failed/);
  });

  it("describes a disabled host, a steam handoff, and an empty error", async () => {
    const configs = withReady(["steam", "github"]);
    configs.github.enabled = false;
    const progress: { current: string | null }[] = [];
    const results = await runPublish({
      input: { fileName: "pack.zip", version: "  ", changelog: "" },
      configs,
      transport: async () => ({ ok: true, detail: "queued" }),
      onProgress: (next) => progress.push({ current: next.current }),
    });
    assert.match(results.find((result) => result.id === "github")!.message, /turned off/);
    assert.match(results.find((result) => result.id === "steam")!.message, /SteamCMD/);
    assert.match(results.find((result) => result.id === "steam")!.message, /unversioned/);
    assert.match(results.find((result) => result.id === "steam")!.message, /queued/);
    assert.match(results.find((result) => result.id === "steam")!.message, /No changelog/);
    assert.ok(progress.length > 1);
    const thrown = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => {
        throw new Error("");
      },
    });
    assert.match(thrown.find((result) => result.id === "nexus")!.message, /Request failed/);
  });
});
