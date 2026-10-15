import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultConfigs, type ConfigMap, type PlatformId } from "./catalog.ts";
import {
  curseForgeDocumentToken,
  curseForgeFileBody,
  curseForgeTab,
  curseForgeViewUrl,
  curseVersionCatalog,
  planPublish,
  practiceFields,
  practiceValue,
  readyCount,
  resolveCurseVersionIds,
  runPublish,
  type Transport,
} from "./publish.ts";

const input = {
  fileName: "lanterns.zip",
  version: "1.4.2",
  changelog: "Softer glass.",
};

function withReady(ids: PlatformId[]): ConfigMap {
  const configs = defaultConfigs();
  const fieldsById: Record<PlatformId, Record<string, string>> = {
    nexus: { apiKey: "k", gameDomain: "site", modId: "1" },
    curseforge: { projectId: "2", gameVersions: "17045" },
    modrinth: { token: "t", project: "slug", gameVersions: "1.20.1", loaders: "fabric" },
    github: { token: "t", repo: "a/b" },
    thunderstore: { token: "t", namespace: "Team", community: "riskofrain2" },
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
    assert.equal(plan.filter((entry) => entry.action === "skip" && entry.reason === "missing-credentials").length, 4);
    const modrinth = plan.find((entry) => entry.id === "modrinth");
    assert.equal(modrinth?.action, "skip");
    if (modrinth?.action === "skip") assert.equal(modrinth.reason, "type");
    const steam = plan.find((entry) => entry.id === "steam");
    assert.equal(steam?.action, "skip");
    if (steam?.action === "skip") assert.equal(steam.reason, "later");
    assert.equal(readyCount(defaultConfigs(), input), 0);
  });

  it("publishes only configured and enabled sites", () => {
    const configs = withReady(["modrinth", "github"]);
    configs.github.enabled = false;
    const plan = planPublish(configs, { ...input, fileName: "lanterns.jar" });
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
    assert.equal(plan.find((entry) => entry.id === "steam")?.action, "skip");
    const steam = plan.find((entry) => entry.id === "steam");
    if (steam?.action === "skip") assert.equal(steam.reason, "later");
    assert.equal(readyCount(configs, input), 0);
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
      configs: withReady(["nexus"]),
      transport,
    });
    assert.deepEqual(called, ["nexus"]);
    assert.equal(results.filter((result) => result.status === "success").length, 1);
    assert.equal(results.filter((result) => result.status === "skipped").length, 5);
    assert.match(results.find((result) => result.id === "curseforge")!.message, /needs account/i);
    assert.match(results.find((result) => result.id === "nexus")!.message, /accepted 1\.4\.2/);
  });

  it("publishes a configured CurseForge host and skips a mismatched file", async () => {
    const called: PlatformId[] = [];
    const results = await runPublish({
      input,
      configs: withReady(["curseforge", "nexus"]),
      transport: async (id) => {
        called.push(id);
        return { ok: true };
      },
    });
    assert.deepEqual(called, ["nexus", "curseforge"]);
    assert.equal(results.find((result) => result.id === "curseforge")?.status, "success");
    const mismatched = await runPublish({
      input,
      configs: withReady(["modrinth"]),
      transport: async () => ({ ok: true }),
    });
    assert.match(mismatched.find((result) => result.id === "modrinth")!.message, /This file is \.zip/);
    const turnedOff = withReady(["modrinth", "nexus"]);
    turnedOff.nexus.enabled = false;
    const held = planPublish(turnedOff, { ...input, fileName: "lanterns.jar" }).find((entry) => entry.id === "nexus");
    assert.equal(held?.action, "skip");
    if (held?.action === "skip") assert.equal(held.reason, "disabled");
  });

  it("keeps going when one host rejects the upload", async () => {
    const configs = withReady(["nexus", "github", "thunderstore"]);
    const transport: Transport = async (id) => {
      if (id === "github") return { ok: false, message: "Repository is archived." };
      return { ok: true };
    };
    const results = await runPublish({ input, configs, transport });
    assert.equal(results.find((result) => result.id === "nexus")?.status, "success");
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
      input: { ...input, fileName: "lanterns.jar", changelog: "  " },
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

  it("describes a disabled host, a later host, and an empty error", async () => {
    const configs = withReady(["thunderstore", "github"]);
    configs.github.enabled = false;
    const progress: { current: string | null }[] = [];
    const seen: PublishInput[] = [];
    const results = await runPublish({
      input: { fileName: "pack.zip", version: "  ", changelog: "", file: new Blob(["from-input"]) },
      configs,
      file: new Blob(["from-arg"]),
      transport: async (_id, next) => {
        seen.push(next);
        return { ok: true, detail: "queued" };
      },
      onProgress: (next) => progress.push({ current: next.current }),
    });
    assert.match(results.find((result) => result.id === "github")!.message, /turned off/);
    assert.match(results.find((result) => result.id === "steam")!.message, /not available until a later date/);
    assert.match(results.find((result) => result.id === "thunderstore")!.message, /unversioned/);
    assert.match(results.find((result) => result.id === "thunderstore")!.message, /queued/);
    assert.match(results.find((result) => result.id === "thunderstore")!.message, /No changelog/);
    assert.equal(seen[0]?.file instanceof Blob, true);
    assert.ok(progress.length > 1);
    const fromInput = await runPublish({
      input: { fileName: "pack.zip", version: "1", changelog: "c", file: new Blob(["only-input"]) },
      configs: withReady(["thunderstore"]),
      transport: async (_id, next) => {
        assert.equal(next.file instanceof Blob, true);
        return { ok: true };
      },
    });
    assert.equal(fromInput[0]?.status, "skipped");
    assert.equal(fromInput.find((result) => result.id === "thunderstore")?.status, "success");
    assert.equal(fromInput.find((result) => result.id === "steam")?.status, "skipped");
    const thrown = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => {
        throw new Error("");
      },
    });
    assert.match(thrown.find((result) => result.id === "nexus")!.message, /Request failed/);
  });

  it("keeps a view link only when the upload succeeds", async () => {
    const linked = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => ({ ok: true, url: "  https://authors.curseforge.com/#/projects/2/files  " }),
    });
    assert.equal(linked.find((result) => result.id === "nexus")?.url, "https://authors.curseforge.com/#/projects/2/files");
    assert.equal(linked.find((result) => result.id === "steam")?.url, undefined);
    const blank = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => ({ ok: true, url: "   " }),
    });
    assert.equal(blank.find((result) => result.id === "nexus")?.url, undefined);
  });
});

describe("curseForge file", () => {
  it("builds the authors session body and lets a non-empty override win", () => {
    const merged = curseForgeFileBody({
      changelog: " Fixed glass & brass. ",
      fileName: " README.md.zip ",
      fileLength: 198,
      host: {
        gameVersions: "17045, 26.3, 17045",
        releaseType: "beta",
        publishWhen: "manual",
        changelogType: "html",
        displayName: "Simple Mod",
        relations: "jei:requiredDependency, 238222:tool, , bare, :tool, jei:nope, pack:embeddedLibrary",
      },
    });
    assert.deepEqual(merged.pendingNames, ["26.3"]);
    assert.deepEqual(merged.body, {
      addedProjectRelations: [
        { slug: "jei", type: 3 },
        { projectId: 238222, type: 4 },
        { slug: "pack", type: 1 },
      ],
      changelog: "<p>Fixed glass & brass.</p>",
      changelogType: 1,
      displayName: "Simple Mod",
      fileLength: 198,
      fileName: "README.md.zip",
      gameVersionIds: [17045],
      includeDefaultProjectRelations: true,
      releaseType: 2,
      isMarkedForManualRelease: true,
    });
    const over = curseForgeFileBody({
      changelog: "<p>notes</p>",
      fileName: "a.zip",
      fileLength: 4,
      host: {
        displayName: "Host",
        gameVersions: "1.20.1",
        releaseType: "release",
        publishWhen: "auto",
        changelogType: "markdown",
        relations: "jei:requiredDependency",
      },
      override: {
        displayName: "Over",
        gameVersions: "26.3",
        releaseType: "alpha",
        publishWhen: "manual",
        changelogType: "text",
        relations: "pack:optionalDependency",
      },
    });
    assert.equal(over.body.displayName, "Over");
    assert.deepEqual(over.pendingNames, ["26.3"]);
    assert.equal(over.body.releaseType, 3);
    assert.equal(over.body.isMarkedForManualRelease, true);
    assert.equal(over.body.changelogType, 3);
    assert.equal(over.body.changelog, "<p>notes</p>");
    assert.deepEqual(over.body.addedProjectRelations, [{ slug: "pack", type: 2 }]);
    const fallback = curseForgeFileBody({
      changelog: "n",
      fileName: "a.zip",
      fileLength: 1,
      host: {
        displayName: "Host",
        gameVersions: "1.20.1, , 1.21",
        releaseType: "beta",
        publishWhen: "manual",
        changelogType: "text",
        relations: "jei:incompatible",
      },
      override: {
        displayName: " ",
        gameVersions: " ",
        releaseType: " ",
        publishWhen: " ",
        relations: " ",
        changelogType: "html",
      },
    });
    assert.equal(fallback.body.displayName, "Host");
    assert.deepEqual(fallback.pendingNames, ["1.20.1", "1.21"]);
    assert.equal(fallback.body.releaseType, 2);
    assert.equal(fallback.body.isMarkedForManualRelease, true);
    assert.equal(fallback.body.changelogType, 2);
    assert.equal(fallback.body.changelog, "n");
    const bare = curseForgeFileBody({ changelog: "  ", fileName: "  ", fileLength: 0, host: {} });
    assert.equal(bare.body.changelog, "");
    assert.equal(bare.body.changelogType, 1);
    assert.equal(bare.body.releaseType, 1);
    assert.equal(bare.body.displayName, "");
    assert.equal(bare.body.fileName, "");
    assert.deepEqual(bare.body.gameVersionIds, []);
    assert.deepEqual(bare.pendingNames, []);
    assert.equal("isMarkedForManualRelease" in bare.body, false);
    const unknown = curseForgeFileBody({
      changelog: "x < y > z",
      fileName: "a.zip",
      fileLength: 1,
      host: { changelogType: "nope", releaseType: "nope", relations: "jei:incompatible", displayName: "Host" },
      override: { relations: "nope" },
    });
    assert.equal(unknown.body.changelogType, 1);
    assert.equal(unknown.body.releaseType, 1);
    assert.equal(unknown.body.changelog, "<p>x < y > z</p>");
    assert.deepEqual(unknown.body.addedProjectRelations, []);
    assert.equal(unknown.body.displayName, "Host");
    const namedFile = curseForgeFileBody({
      changelog: "<p>kept</p>",
      fileName: "a.zip",
      fileLength: 2,
      host: { changelogType: "html" },
    });
    assert.equal(namedFile.body.changelog, "<p>kept</p>");
    assert.equal(namedFile.body.displayName, "a.zip");
  });

  it("resolves version ids from the authors list and links a file after success", () => {
    assert.deepEqual(resolveCurseVersionIds("  ", null), { ok: false, message: "CurseForge needs a game version id." });
    assert.deepEqual(resolveCurseVersionIds("17045, 17045", null), { ok: true, ids: [17045] });
    assert.match(resolveCurseVersionIds("26.3", null).ok ? "" : (resolveCurseVersionIds("26.3", null) as { message: string }).message, /did not list/);
    const listed = [
      { id: 17045, name: "26.3", slug: "26-3" },
      { id: 4, name: "Other", slug: "fabric" },
    ];
    assert.deepEqual(resolveCurseVersionIds("17045, 26.3, fabric", listed), { ok: true, ids: [17045, 4] });
    assert.match(
      (resolveCurseVersionIds("missing", listed) as { message: string }).message,
      /no game version named missing/,
    );
    const ambiguous = resolveCurseVersionIds("26.3", [
      { id: 1, name: "26.3", slug: "a" },
      { id: 2, name: "Other", slug: "26.3" },
    ]);
    assert.match(ambiguous.ok ? "" : ambiguous.message, /more than one id/);
    assert.equal(curseVersionCatalog(null), null);
    assert.equal(curseVersionCatalog("nope"), null);
    assert.equal(curseVersionCatalog({ data: { nope: 1 } }), null);
    assert.equal(curseVersionCatalog({ data: "x" }), null);
    assert.deepEqual(curseVersionCatalog([]), []);
    assert.deepEqual(curseVersionCatalog({ data: [{ id: 5, name: "26.3" }, { id: 0 }, "x", null] }), [
      { id: 5, name: "26.3", slug: "" },
    ]);
    assert.deepEqual(curseVersionCatalog({ data: { gameVersions: [{ id: 6, slug: "fabric" }] } }), [
      { id: 6, name: "", slug: "fabric" },
    ]);
    assert.deepEqual(curseVersionCatalog({ data: { versions: [{ id: 1.5 }, { id: 7, name: "A" }] } }), [
      { id: 7, name: "A", slug: "" },
    ]);
    assert.deepEqual(curseVersionCatalog({ gameVersions: [{ id: 8 }] }), [{ id: 8, name: "", slug: "" }]);
    assert.deepEqual(curseForgeTab(false), { open: false, active: false, closeOnSuccess: false });
    assert.deepEqual(curseForgeTab(true), { open: true, active: false, closeOnSuccess: true });
    assert.equal(curseForgeViewUrl({}), null);
    assert.equal(curseForgeViewUrl({ fileId: "  " }), null);
    assert.equal(curseForgeViewUrl({ fileId: "9" }), null);
    assert.equal(
      curseForgeViewUrl({ fileId: "9", projectId: "1744552" }),
      "https://authors.curseforge.com/#/projects/1744552/files/9",
    );
    assert.equal(
      curseForgeViewUrl({ fileId: "9", slug: "simple mod", projectId: "1744552" }),
      "https://www.curseforge.com/projects/simple%20mod/files/9",
    );
    assert.equal(curseForgeDocumentToken(200, "<!doctype html>"), true);
    assert.equal(curseForgeDocumentToken(200, "<html></html>"), true);
    assert.equal(curseForgeDocumentToken(200, "ok", "text/html"), true);
    assert.equal(curseForgeDocumentToken(401, '{"error":"token"}'), true);
    assert.equal(curseForgeDocumentToken(403, "please login"), true);
    assert.equal(curseForgeDocumentToken(403, "antiforgery"), true);
    assert.equal(curseForgeDocumentToken(403, "nope"), false);
    assert.equal(curseForgeDocumentToken(400, "versions required"), false);
  });
});
