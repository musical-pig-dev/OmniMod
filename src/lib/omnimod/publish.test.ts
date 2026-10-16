import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PLATFORMS, defaultConfigs, type ConfigMap, type PlatformId } from "./catalog.ts";
import {
  curseForgeDocumentToken,
  curseForgeFileBody,
  curseForgeFormValues,
  curseForgeTab,
  curseForgeViewUrl,
  curseVersionCatalog,
  deliveryFile,
  failureFacts,
  failureSignature,
  fillCurseForgePage,
  findOpenTicket,
  planPublish,
  practiceFields,
  practiceValue,
  publicHostConfig,
  readyCount,
  resolveCurseVersionIds,
  runPublish,
  ticketBody,
  ticketHref,
  ticketTitle,
  withCurseForgePage,
  type PublishInput,
  type SiteResult,
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
    basedmods: {},
    ayakamods: {},
    afkmods: {},
    moddinghaven: {},
    laxmods: {},
    moddb: {},
  };
  for (const id of ids) {
    configs[id] = { enabled: true, fields: fieldsById[id] };
  }
  return configs;
}

describe("planPublish", () => {
  it("skips every site when nothing is configured", () => {
    const plan = planPublish(defaultConfigs(), input);
    assert.equal(plan.length, PLATFORMS.length);
    assert.equal(plan.filter((entry) => entry.action === "skip" && entry.reason === "missing-credentials").length, 4);
    const modrinth = plan.find((entry) => entry.id === "modrinth");
    assert.equal(modrinth?.action, "skip");
    if (modrinth?.action === "skip") assert.equal(modrinth.reason, "type");
    const later = plan.filter((entry) => entry.action === "skip" && entry.reason === "later").map((entry) => entry.id);
    assert.deepEqual(later, ["steam", "basedmods", "ayakamods", "afkmods", "moddinghaven", "laxmods", "moddb"]);
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
    assert.equal(results.filter((result) => result.status === "skipped").length, PLATFORMS.length - 1);
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
    assert.equal(results.find((result) => result.id === "nexus")?.file, "lanterns.zip");
    assert.equal(results.find((result) => result.id === "nexus")?.config?.apiKey, undefined);
    assert.equal(results.find((result) => result.id === "thunderstore")?.status, "success");
  });

  it("keeps the failing step when the host names it", async () => {
    const results = await runPublish({
      input,
      configs: withReady(["curseforge"]),
      transport: async () => ({
        ok: false,
        message: "CurseForge changelog editor did not open. The tab was left open.",
        step: "changelog",
        reason: "both editors stayed empty",
        filled: ["file", "display name"],
        logs: ["file placed"],
      }),
    });
    const curse = results.find((result) => result.id === "curseforge");
    assert.equal(curse?.step, "changelog");
    assert.equal(curse?.reason, "both editors stayed empty");
    assert.deepEqual(curse?.filled, ["file", "display name"]);
    assert.deepEqual(curse?.logs, ["file placed"]);
    assert.equal(curse?.config?.projectId, "2");
    assert.equal(JSON.stringify(curse).includes("token"), false);
    const blankFilled = await runPublish({
      input,
      configs: withReady(["nexus"]),
      transport: async () => ({ ok: false, message: "no", filled: [], logs: [] }),
    });
    assert.equal(blankFilled.find((result) => result.id === "nexus")?.filled, undefined);
    assert.equal(blankFilled.find((result) => result.id === "nexus")?.logs, undefined);
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
    assert.equal(results.find((result) => result.id === "github")?.file, "lanterns.zip");
    assert.deepEqual(results.find((result) => result.id === "github")?.config, { repo: "a/b" });
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
    assert.equal(results.find((result) => result.id === "nexus")?.step, "exception");
    assert.deepEqual(results.find((result) => result.id === "nexus")?.logs, ["exception: Request failed."]);
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
    assert.equal(thrown.find((result) => result.id === "nexus")?.reason, "Request failed.");
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

  it("sends a zip only to hosts that need one", async () => {
    const jar = new Blob(["jar"]);
    const other = new Blob(["other"]);
    const packed = new Blob(["packed"]);
    const original = new Blob(["original"]);
    const base: PublishInput = { fileName: "mod.jar", version: "1.0.0", changelog: "notes", autoZip: true };
    assert.equal(deliveryFile("nexus", { ...base, autoZip: false }, original, packed, [{ name: "mod.jar", blob: jar }]), original);
    assert.equal(deliveryFile("nexus", base, original, packed, []), original);
    assert.equal(deliveryFile("github", base, original, packed, [{ name: "mod.jar", blob: jar }]), jar);
    assert.equal(deliveryFile("modrinth", base, original, packed, [{ name: "mod.jar", blob: jar }]), jar);
    assert.equal(deliveryFile("nexus", base, original, packed, [{ name: "mod.jar", blob: jar }]), packed);
    assert.equal(deliveryFile("nexus", base, original, null, [{ name: "mod.jar", blob: jar }]), original);
    assert.equal(deliveryFile("modrinth", base, original, packed, [{ name: "notes.txt", blob: jar }]), original);
    assert.equal(
      deliveryFile("thunderstore", base, original, packed, [
        { name: "a.jar", blob: jar },
        { name: "b.txt", blob: other },
      ]),
      packed,
    );
    assert.equal(
      deliveryFile("thunderstore", base, original, null, [
        { name: "a.jar", blob: jar },
        { name: "b.txt", blob: other },
      ]),
      original,
    );
    assert.equal(
      deliveryFile("modrinth", base, original, packed, [
        { name: "a.jar", blob: jar },
        { name: "b.jar", blob: other },
      ]),
      jar,
    );
    assert.equal(deliveryFile("curseforge", base, original, packed, [{ name: "mod.jar", blob: jar }]), packed);
    assert.equal(deliveryFile("curseforge", base, original, null, [{ name: "mod.jar", blob: jar }]), original);
    assert.equal(deliveryFile("curseforge", base, original, packed, [{ name: "mod.zip", blob: jar }]), jar);
    const seen: Partial<Record<PlatformId, Blob | null>> = {};
    const zipped = planPublish(withReady(["nexus"]), { ...base, fileName: "mod.jar" });
    assert.equal(zipped.find((entry) => entry.id === "nexus")?.action, "publish");
    await runPublish({
      input: base,
      configs: withReady(["nexus", "modrinth", "github"]),
      file: original,
      zip: packed,
      sources: [{ name: "mod.jar", blob: jar }],
      transport: async (id, next) => {
        seen[id] = next.file ?? null;
        return { ok: true };
      },
    });
    assert.equal(seen.nexus, packed);
    assert.equal(seen.modrinth, jar);
    assert.equal(seen.github, jar);
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
    const download = { id: "curseforge" as const, status: "success" as const, message: "ok", url: "https://edge.forgecdn.net/files/1/a.zip" };
    assert.equal(withCurseForgePage(download, "1744552").url, "https://authors.curseforge.com/#/projects/1744552/files");
    assert.equal(withCurseForgePage(download, " ").url, download.url);
    assert.equal(withCurseForgePage({ ...download, status: "error" }, "1744552").url, download.url);
    assert.equal(withCurseForgePage({ ...download, id: "nexus" }, "1744552").url, download.url);
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

describe("curseForge authors form", () => {
  const fill = {
    fileName: "README.md.zip",
    bytes: [1, 2, 3],
    mime: "application/zip",
    displayName: "Sample",
    manual: false,
    versions: ["26.3"],
    releaseType: "Release",
    changelog: "Glass.",
    code: false,
    relations: [] as string[],
    waitMs: 0,
    stepMs: 0,
  };

  function mount(html: string) {
    document.body.innerHTML = html;
  }

  const form = `
    <input type="file" />
    <label>Display name <input id="name" /></label>
    <label><input type="radio" name="when" /> Publish this file automatically once approved</label>
    <label><input type="radio" name="when" /> I would like to publish this file manually once approved</label>
    <div>
      <span>Minecraft *</span>
      <button type="button">Versions</button>
      <button type="button" role="option">26.3</button>
    </div>
    <label>Release Type
      <select>
        <option>Release</option>
        <option>Beta</option>
        <option>Alpha</option>
      </select>
    </label>
    <div contenteditable="true"></div>
    <button type="button"></></button>
    <textarea></textarea>
    <button type="button">Add related project</button>
    <div role="dialog"><input /><button type="button">Add to relations</button></div>
    <button type="button">Add File</button>
  `;

  it("reads a Minecraft title on a div and reports a missing field", async () => {
    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div class="details-field-title">Minecraft Versions</div>
      <button type="button" role="option">26.3</button>
      <div class="details-field-title">Release Type</div>
      <button type="button" role="option">Release</button>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/50">file</a>
    `);
    const titled = await fillCurseForgePage({ ...fill, changelog: "", relations: [] });
    assert.equal(titled.ok && titled.url, "https://authors.curseforge.com/#/projects/1/files/50");

    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <button type="button">Add File</button>
    `);
    const missing = await fillCurseForgePage({ ...fill, changelog: "", relations: [] });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.step, "minecraft");
      assert.equal(missing.reason, "no Minecraft field");
      assert.deepEqual(missing.filled, ["file", "display name", "release"]);
    }
  });

  it("keeps the release labels inside the injected function", () => {
    const source = fillCurseForgePage.toString();
    assert.match(source, /Publish this file automatically once approved/);
    assert.match(source, /I would like to publish this file manually once approved/);
  });

  it("maps host fields and lets a written override win", () => {
    const values = curseForgeFormValues({
      changelog: " Glass. ",
      host: {
        displayName: "Host",
        gameVersions: "26.3, 1.21.1",
        releaseType: "beta",
        publishWhen: "auto",
        changelogType: "html",
        relations: "jei:requiredDependency",
      },
      override: { displayName: "Over", releaseType: "alpha", publishWhen: "manual", changelogType: "markdown", relations: "pack:optionalDependency" },
    });
    assert.equal(values.displayName, "Over");
    assert.deepEqual(values.versions, ["26.3", "1.21.1"]);
    assert.equal(values.releaseType, "Alpha");
    assert.equal(values.manual, true);
    assert.equal(values.code, true);
    assert.deepEqual(values.relations, ["pack"]);
    assert.equal(values.changelog, "Glass.");
    const fallback = curseForgeFormValues({
      changelog: "  ",
      host: { changelogType: "text", releaseType: "nope" },
    });
    assert.equal(fallback.releaseType, "Release");
    assert.equal(fallback.code, false);
    assert.equal(fallback.manual, false);
    assert.equal(fallback.changelog, "");
    assert.deepEqual(fallback.versions, []);
    const html = curseForgeFormValues({ changelog: "n", host: { changelogType: "html", publishWhen: "auto" } });
    assert.equal(html.code, false);
    const numbered = curseForgeFormValues({ changelog: "", host: { relations: "88211:tool", releaseType: "beta" } });
    assert.deepEqual(numbered.relations, ["88211"]);
    assert.equal(numbered.releaseType, "Beta");
  });

  it("fills the upload form and returns the file link", async () => {
    mount(`${form}<a href="https://authors.curseforge.com/#/projects/1744552/files/9">file</a>`);
    const linked = await fillCurseForgePage({ ...fill, relations: ["jei"], changelog: "<p>Glass.</p>" });
    assert.equal(linked.ok && linked.url, "https://authors.curseforge.com/#/projects/1744552/files/9");
    assert.equal((document.querySelector("#name") as HTMLInputElement).value, "Sample");

    mount(form.replace('role="option">26.3', 'role="option">1.21.1').replace("Release Type\n      <select>", "Release Type\n      <div>"));
    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <span>Minecraft *</span>
        <span data-chip>26.3</span>
        <button type="button">Versions</button>
        <input role="combobox" />
        <button type="button" role="option">1.21.1</button>
      </div>
      <div><span>Release Type</span><button type="button" role="option">Beta</button></div>
      <div contenteditable="true"></div>
      <button type="button">Add File</button>
      <a href="/projects/1744552/files/4">file</a>
    `);
    const relative = await fillCurseForgePage({
      ...fill,
      displayName: "",
      versions: ["26.3", "1.21.1"],
      releaseType: "Beta",
      changelog: "plain",
      waitMs: 30,
      stepMs: 5,
    });
    assert.equal(relative.ok && relative.url, "http://localhost:3000/projects/1744552/files/4");
    assert.equal((document.querySelector("[role='combobox']") as HTMLInputElement).value, "1.21.1");

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <label>Minecraft * <input id="typed" /></label>
      <button type="button" role="option">26.3</button>
      <label>Release Type <select><option>Release</option></select></label>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/12">file</a>
    `);
    const typed = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [] });
    assert.equal(typed.ok && typed.url, "https://authors.curseforge.com/#/projects/1/files/12");
    assert.equal((document.querySelector("#typed") as HTMLInputElement).value, "26.3");

    mount(`
      <input type="file" />
      <div>
        <div>Display name</div>
        <input type="radio" />
        <input id="shown" />
      </div>
      <input type="radio" id="auto" />
      <label for="auto">Publish this file automatically once approved</label>
      <div>
        <span>Minecraft *</span>
        <div>26.3 ×</div>
        <button type="button">Versions</button>
        <li>1.21.1</li>
      </div>
      <div>
        <span>Release Type</span>
        <button type="button">Release</button>
        <div role="option">Alpha</div>
      </div>
      <div contenteditable="true"></div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/21">file</a>
    `);
    const shown = await fillCurseForgePage({
      ...fill,
      displayName: "MyMod",
      versions: ["26.3", "1.21.1"],
      releaseType: "Alpha",
      changelog: "notes",
      relations: [],
    });
    assert.equal(shown.ok && shown.url, "https://authors.curseforge.com/#/projects/1/files/21");
    assert.equal((document.querySelector("#shown") as HTMLInputElement).value, "MyMod");

    mount(`
      <input type="file" />
      <div><label>Display name</label><input type="radio" /></div>
      <input type="radio" />
      <label>Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <label>Release Type</label>
      <select><option>Release</option></select>
      <button type="button">Add File</button>
    `);
    assert.match((await fillCurseForgePage({ ...fill, changelog: "" })).ok ? "" : "display name", /display name/);

    mount(`
      <input type="file" />
      <label>Display name <input id="beside" /></label>
      <input type="radio" />
      <label>Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/22">file</a>
    `);
    const beside = await fillCurseForgePage({ ...fill, displayName: "MyMod", changelog: "", relations: [] });
    assert.equal(beside.ok && beside.url, "https://authors.curseforge.com/#/projects/1/files/22");

    mount(`${form}<p role="alert">These values were copied from the file "README.md.zip"</p>`);
    document.querySelector("button")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `<a href="https://authors.curseforge.com/#/projects/1/files/8">up</a>`);
    });
    const copied = await fillCurseForgePage({ ...fill, manual: true, code: true, changelog: "md", waitMs: 40, stepMs: 5 });
    assert.equal(copied.ok, true);

    mount(`<p>Sign in to continue</p>`);
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "sign-in", /sign-in/);
    mount(`<p>Please wait</p>`);
    assert.match((await fillCurseForgePage({ ...fill, waitMs: 15, stepMs: 5 })).ok ? "" : "did not load", /did not load/);

    mount(form.replace("Display name <input id=\"name\" />", "Display name <input type=\"file\" />"));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "display name", /display name/);

    mount(form.replace("<label>Display name <input id=\"name\" /></label>", "<label>Display name</label>"));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "display name", /display name/);

    mount(form.replace(/<label><input type="radio".*?<\/label>/g, "<label>Publish this file automatically once approved</label>"));
    assert.match((await fillCurseForgePage({ ...fill, displayName: "Sample" })).ok ? "" : "release option", /release option/);

    mount(form.replace('role="option">26.3', 'role="option">other'));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "26.3", /26\.3/);

    mount(form.replace("<option>Release</option>", "<option>Beta</option>"));
    const missingType = await fillCurseForgePage(fill);
    assert.equal(missingType.ok, false);
    if (!missingType.ok) assert.match(missingType.message, /release type Release/);

    mount(form.replace(/<label>Release Type[\s\S]*?<\/label>/, "<span>Release Type</span>"));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "no release type", /no release type/);

    mount(form.replace('<div contenteditable="true"></div>', ""));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "changelog", /changelog/);
    mount(form.replace("<textarea></textarea>", "").replace("<button type=\"button\"></></button>", ""));
    assert.match((await fillCurseForgePage({ ...fill, code: true })).ok ? "" : "changelog", /changelog/);

    mount(form.replace('<button type="button">Add related project</button>', ""));
    assert.match((await fillCurseForgePage({ ...fill, relations: ["jei"] })).ok ? "" : "related projects", /related projects/);
    mount(form.replace('<div role="dialog"><input /><button type="button">Add to relations</button></div>', ""));
    assert.match((await fillCurseForgePage({ ...fill, relations: ["jei"] })).ok ? "" : "relation search", /relation search/);
    mount(form.replace('<button type="button">Add to relations</button>', ""));
    assert.match((await fillCurseForgePage({ ...fill, relations: ["jei"] })).ok ? "" : "Add to relations", /Add to relations/);

    mount(form.replace('<button type="button">Add File</button>', ""));
    assert.match((await fillCurseForgePage(fill)).ok ? "" : "Add File", /Add File/);

    mount(`${form}<p role="alert">Version is required</p>`);
    assert.match((await fillCurseForgePage(fill)).message ?? "", /Version is required/);

    mount(form);
    assert.match((await fillCurseForgePage({ ...fill, waitMs: 30, stepMs: 5 })).message ?? "", /did not finish/);

    mount(`${form}<a href="https://authors.curseforge.com/#/projects/1/files/2">file</a>`);
    assert.equal((await fillCurseForgePage({ ...fill, code: true, relations: [] })).ok, true);

    const view = document.defaultView as { DataTransfer?: unknown } | null;
    const Original = view?.DataTransfer;
    class EmptyTransfer {
      items = { add() {} };
      files = { length: 0 };
    }
    class BoomTransfer {
      items = { add() { throw new Error("no"); } };
      files = { length: 0 };
    }
    if (view) {
      view.DataTransfer = EmptyTransfer as unknown as typeof DataTransfer;
      mount(`${form}<a href="https://authors.curseforge.com/#/projects/1/files/5">file</a>`);
      assert.equal((await fillCurseForgePage({ ...fill, fileName: "" })).ok, true);
      view.DataTransfer = BoomTransfer as unknown as typeof DataTransfer;
      mount(`${form}<a href="https://authors.curseforge.com/#/projects/1/files/6">file</a>`);
      assert.equal((await fillCurseForgePage(fill)).ok, true);
      delete view.DataTransfer;
      mount(`${form}<a href="https://authors.curseforge.com/#/projects/1/files/7">file</a>`);
      assert.equal((await fillCurseForgePage(fill)).ok, true);
      if (Original) view.DataTransfer = Original as typeof DataTransfer;
    }

    mount(`<p>welcome</p>`);
    const previous = document.location.href;
    try {
      window.location.href = "https://authors.curseforge.com/login";
    } catch {
      /* happy-dom may refuse navigation */
    }
    const login = await fillCurseForgePage({ ...fill, waitMs: 0 });
    if (document.location.href.includes("login")) assert.match(login.ok ? "" : login.message, /sign-in/);
    try {
      window.location.href = previous;
    } catch {
      /* restore is best-effort */
    }

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <p>Minecraft*</p>
      <button type="button" role="option">26.3</button>
      <h3>Release Type</h3>
      <button type="button">Release</button>
      <button type="button" aria-label="code view"></button>
      <textarea></textarea>
      <button type="button">Add File</button>
    `);
    const headings = await fillCurseForgePage({ ...fill, code: true, changelog: "note", waitMs: 30, stepMs: 5 });
    assert.equal(headings.ok, false);

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <h3>Release Type</h3>
      <select><option>Release</option></select>
      <button type="button">Add File</button>
    `);
    const orphanSelect = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", waitMs: 0 });
    assert.equal(orphanSelect.ok, false);
    if (!orphanSelect.ok) assert.equal(orphanSelect.step, "submit");

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <span>Minecraft *</span>
        <span>26.3</span>
      </div>
      <div>
        <div>Release Type</div>
        <p>Set your project's visibility on CurseForge based on its release stage</p>
        <div role="combobox">Release</div>
      </div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/30">file</a>
    `);
    const menu = document.querySelector("[role='combobox']") as HTMLElement;
    menu.addEventListener("mousedown", () => {
      document.body.insertAdjacentHTML("beforeend", `<ul><li role="option">Release</li><li role="option">Beta</li><li role="option">Alpha</li></ul>`);
    });
    const picked = await fillCurseForgePage({ ...fill, displayName: "", releaseType: "Alpha", changelog: "", relations: [], waitMs: 30, stepMs: 5 });
    assert.equal(picked.ok, true);

    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <div>Release Type</div>
        <div role="combobox">Release</div>
      </div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/31">file</a>
    `);
    setTimeout(() => {
      document.body.insertAdjacentHTML("afterbegin", `<div><span>Minecraft *</span><span>26.3</span></div>`);
    }, 10);
    const late = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [], waitMs: 40, stepMs: 5 });
    assert.equal(late.ok, true);

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <span>Minecraft *</span>
        <div id="extra"><span>26.3</span><button type="button" aria-label="Remove">×</button></div>
        <div role="combobox">Versions</div>
      </div>
      <div>
        <div>Release Type</div>
        <div role="combobox">Release</div>
      </div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/32">file</a>
    `);
    let removed = false;
    document.querySelector("#extra button")?.addEventListener("click", () => {
      removed = true;
      document.getElementById("extra")?.remove();
    });
    const versions = document.querySelector("[role='combobox']") as HTMLElement;
    versions.addEventListener("mousedown", () => {
      if (!document.querySelector("[role='option']")) {
        document.body.insertAdjacentHTML("beforeend", `<button type="button" role="option">26.2</button>`);
      }
    });
    const only = await fillCurseForgePage({ ...fill, displayName: "", versions: ["26.2"], changelog: "", relations: [], waitMs: 30, stepMs: 5 });
    assert.equal(removed, true);
    assert.equal(only.ok, true);

    const location = document.location as unknown as { href: string };
    const href = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(location), "href");
    let blanked = false;
    try {
      Object.defineProperty(location, "href", { configurable: true, get: () => "" });
      blanked = document.location.href === "";
    } catch {
      blanked = false;
    }
    if (blanked) {
      mount(`${form}<a href="/projects/1/files/3">file</a>`);
      const blankBase = await fillCurseForgePage({ ...fill, changelog: "", relations: [] });
      assert.equal(blankBase.ok && blankBase.url, "https://authors.curseforge.com/projects/1/files/3");
      if (href) Object.defineProperty(location, "href", href);
    }

    mount(form);
    const originalClick = HTMLButtonElement.prototype.click;
    HTMLButtonElement.prototype.click = function click() {
      originalClick.call(this);
      if ((this.textContent ?? "").includes("Add File")) {
        try {
          window.location.href = "https://authors.curseforge.com/#/projects/1/files/11";
        } catch {
          /* navigation can throw */
        }
      }
    };
    const arrived = await fillCurseForgePage({ ...fill, changelog: "", waitMs: 40, stepMs: 5 });
    HTMLButtonElement.prototype.click = originalClick;
    if (document.location.href.includes("/files/11")) assert.equal(arrived.ok && arrived.url, document.location.href);
    mount(form);
    const emptyVersions = await fillCurseForgePage({ ...fill, versions: [], changelog: "", mime: "", waitMs: 0 });
    assert.match(emptyVersions.ok ? "" : emptyVersions.message, /game version/);

    mount(`<input type="file" /><p>Sign in please</p>`);
    const signed = await fillCurseForgePage({ ...fill, waitMs: 0 });
    assert.equal(signed.ok, false);

    const authors = `
      <input class="dzu-input" type="file" accept=".zip" />
      <div class="MuiFormControl-root">
        <div><div><span>Display name</span></div></div>
        <div><input id="mui-name" class="MuiInputBase-input" value="test-mod.jar" /></div>
      </div>
      <label><input type="radio" value="false" checked /> Publish this file automatically once approved</label>
      <label><input type="radio" value="true" /> I would like to publish this file manually once approved</label>
      <div class="MuiFormControl-root">
        <div><span>Minecraft</span></div>
        <span class="MuiChip-label">26.3</span>
      </div>
      <div class="MuiFormControl-root">
        <div><span>Release Type</span></div>
        <div role="combobox">Release</div>
      </div>
      <div role="combobox">WYSIWYG</div>
      <div role="option">Markdown</div>
      <textarea aria-hidden="true" id="tiny-react_1"></textarea>
      <textarea class="mde-text" id="md"></textarea>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/30">file</a>
    `;
    mount(authors);
    const mui = await fillCurseForgePage({ ...fill, code: true, changelog: "notes", relations: [] });
    assert.equal(mui.ok && mui.url, "https://authors.curseforge.com/#/projects/1/files/30");
    assert.equal((document.querySelector("#mui-name") as HTMLInputElement).value, "Sample");
    assert.equal((document.querySelector("#md") as HTMLTextAreaElement).value, "notes");
    assert.equal((document.querySelector("#tiny-react_1") as HTMLTextAreaElement).value, "");

    mount(authors.replace(">WYSIWYG<", ">Markdown<").replace('<div role="option">Markdown</div>', ""));
    const alreadyMd = await fillCurseForgePage({ ...fill, code: true, changelog: "kept", relations: [] });
    assert.equal(alreadyMd.ok, true);
    assert.equal((document.querySelector("#md") as HTMLTextAreaElement).value, "kept");

    mount(authors.replace('<div role="option">Markdown</div>', ""));
    const missingMode = await fillCurseForgePage({ ...fill, code: true, changelog: "still", relations: [] });
    assert.equal((document.querySelector("#md") as HTMLTextAreaElement).value, "still");
    assert.equal(missingMode.ok, true);

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <button type="button">Add File</button>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
      <a href="https://authors.curseforge.com/#/projects/1/files/31">file</a>
    `);
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    const framed = await fillCurseForgePage({ ...fill, changelog: "<p>Glass.</p>", relations: [] });
    assert.equal(framed.ok && framed.url, "https://authors.curseforge.com/#/projects/1/files/31");
    assert.equal(frame.contentDocument?.body.innerHTML, "<p>Glass.</p>");

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <button type="button">Add File</button>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
      <a href="https://authors.curseforge.com/#/projects/1/files/32">file</a>
    `);
    const plainFrame = document.querySelector("iframe") as HTMLIFrameElement;
    const plainWrote = await fillCurseForgePage({ ...fill, changelog: "plain glass", relations: [] });
    assert.equal(plainWrote.ok, true);
    assert.equal(plainFrame.contentDocument?.body.textContent, "plain glass");

    const win = window as unknown as {
      tinymce?: { get: (id: string) => { setContent: (value: string) => void } | null };
    };
    let stored = "";
    win.tinymce = {
      get(id: string) {
        return id === "tiny-react_9" ? { setContent(value: string) { stored = value; } } : null;
      },
    };
    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <textarea id="tiny-react_9"></textarea>
      <div role="combobox">Markdown</div>
      <div role="option">WYSIWYG</div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/33">file</a>
    `);
    const viaTiny = await fillCurseForgePage({ ...fill, changelog: "<p>via tiny</p>", relations: [] });
    assert.equal(viaTiny.ok && viaTiny.url, "https://authors.curseforge.com/#/projects/1/files/33");
    assert.equal(stored, "<p>via tiny</p>");

    win.tinymce = { get: () => null };
    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <textarea id="tiny-react_9"></textarea>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/34">file</a>
    `);
    const emptyTiny = document.querySelector("iframe") as HTMLIFrameElement;
    const fellBack = await fillCurseForgePage({ ...fill, changelog: "fallback", relations: [] });
    assert.equal(fellBack.ok, true);
    assert.equal(emptyTiny.contentDocument?.body.textContent, "fallback");

    win.tinymce = { get: () => null };
    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <button type="button">Add File</button>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
    `);
    const bare = document.querySelector("iframe") as HTMLIFrameElement;
    bare.contentDocument?.body?.remove();
    const noBody = await fillCurseForgePage(fill);
    assert.match(noBody.ok ? "" : noBody.message, /changelog/);
    bare.remove();
    const quiet = document.createElement("iframe");
    quiet.className = "tox-edit-area__iframe";
    quiet.srcdoc = "<html><body></body></html>";
    document.body.appendChild(quiet);
    Object.defineProperty(quiet, "contentDocument", { configurable: true, get: () => null });
    const closed = await fillCurseForgePage(fill);
    assert.match(closed.ok ? "" : closed.message, /changelog/);
    delete win.tinymce;
  });

  it("drops copied Minecraft versions and reports a release control that is not there", async () => {
    const view = Object.getOwnPropertyDescriptor(Document.prototype, "defaultView");
    Object.defineProperty(document, "defaultView", { configurable: true, get: () => null });
    mount(`
      <input type="file" />
      <label>Display name <input /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <span>Minecraft *</span>
        <div role="option">26.9</div>
        <span>26.2</span>
        <span>9.9</span>
        <div>8.8<button type="button">×</button></div>
        <div>26.4<button type="button"></button></div>
        <li>11111111111111111111111111111111111111111<button type="button">ok</button></li>
        <span>notes</span>
      </div>
      <label>Release Type <select><option>Release</option></select></label>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/40">file</a>
    `);
    const kept = await fillCurseForgePage({ ...fill, displayName: "", versions: ["26.2"], changelog: "", relations: [] });
    if (view) Object.defineProperty(document, "defaultView", view);
    assert.equal(kept.ok, true);

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div id="mine">
        <span>Minecraft *</span>
        <span>26.4<button id="drop" type="button" aria-label="Remove">x</button></span>
      </div>
      <label>Release Type <select><option>Release</option></select></label>
      <button type="button">Add File</button>
    `);
    document.getElementById("drop")?.addEventListener("click", () => document.getElementById("mine")?.remove());
    const gone = await fillCurseForgePage({ ...fill, displayName: "", versions: ["26.2"], changelog: "", relations: [] });
    assert.equal(gone.ok, false);
    if (!gone.ok) assert.equal(gone.reason, "no Minecraft field");

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button">Add File</button>
    `);
    const noBox = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [] });
    assert.equal(noBox.ok, false);
    if (!noBox.ok) assert.equal(noBox.step, "release type");

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <div><span>Release Type</span></div>
      <button type="button">Beta</button>
      <button type="button">Add File</button>
    `);
    const noChoice = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [], waitMs: 20, stepMs: 5 });
    assert.equal(noChoice.ok, false);
    if (!noChoice.ok) assert.equal(noChoice.step, "release type");

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <div>
        <div>
          extra
          <span>Release Type</span>
        </div>
        <select><option>Release</option></select>
      </div>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/42">file</a>
    `);
    const walked = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [] });
    assert.equal(walked.ok, true);

    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <button type="button">Add File</button>
    `);
    const unlabeled = await fillCurseForgePage({ ...fill, displayName: "", changelog: "", relations: [] });
    assert.equal(unlabeled.ok, false);
    if (!unlabeled.ok) assert.equal(unlabeled.step, "release type");
  });

  it("removes a copied Minecraft chip that was not requested", async () => {
    let dropped = 0;
    let kept = 0;
    mount(`
      <input type="file" />
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <div>
        <span>Minecraft</span>
        <div class="MuiChip-root" id="old">
          <span class="MuiChip-label">26.3</span>
          <svg class="MuiChip-deleteIcon" data-testid="CancelIcon"></svg>
        </div>
        <div class="MuiChip-root" id="keep">
          <span class="MuiChip-label">26.2</span>
          <svg class="MuiChip-deleteIcon" data-testid="CancelIcon"></svg>
        </div>
      </div>
      <label>Release Type <select><option>Release</option></select></label>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/43">file</a>
    `);
    document.querySelector("#old svg")?.addEventListener("click", () => {
      dropped += 1;
    });
    document.querySelector("#keep svg")?.addEventListener("click", () => {
      kept += 1;
    });
    const result = await fillCurseForgePage({ ...fill, displayName: "", versions: ["26.2"], changelog: "", relations: [] });
    assert.equal(dropped, 1);
    assert.equal(kept, 0);
    assert.equal(result.ok, true);
  });

  it("stops on a jar and writes a hidden markdown box through the other editor", async () => {
    mount(`${form}<a href="https://authors.curseforge.com/#/projects/1/files/2">file</a>`);
    const refused = await fillCurseForgePage({ ...fill, fileName: "test-mod.jar" });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.step, "file");
      assert.equal(refused.reason, "form accepts .zip only");
      assert.match(refused.message, /form accepts \.zip only/);
      assert.equal(refused.filled, undefined);
    }
    assert.equal((document.querySelector("#name") as HTMLInputElement).value, "");

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <div role="combobox">WYSIWYG</div>
      <div role="option">Markdown</div>
      <div style="display: none"><textarea class="mde-text" id="md"></textarea></div>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/40">file</a>
    `);
    const frame = document.querySelector("iframe") as HTMLIFrameElement;
    const hidden = await fillCurseForgePage({ ...fill, code: true, changelog: "from tiny", relations: [] });
    assert.equal(hidden.ok, false);
    if (!hidden.ok) {
      assert.equal(hidden.step, "changelog");
      assert.equal(hidden.reason, "markdown editor stayed hidden");
      assert.match(hidden.message, /stayed on WYSIWYG/);
    }
    assert.equal((document.querySelector("#md") as HTMLTextAreaElement).value, "");
    assert.equal(frame.contentDocument?.body.textContent, "");

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <div class="MuiFormControl-root"><span>Release Type</span><div role="combobox">Release</div></div>
      <div role="combobox" id="decoy">WYSIWYG</div>
      <div class="MuiFormControl-root"><span>Changelog</span><div role="combobox" id="log">Markdown</div></div>
      <textarea class="mde-text" id="md"></textarea>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/41">file</a>
    `);
    let clicked = "";
    document.querySelectorAll("[role='combobox']").forEach((node) => {
      node.addEventListener("click", () => {
        clicked = node.textContent ?? "";
      });
    });
    const scoped = await fillCurseForgePage({ ...fill, code: true, changelog: "scoped", relations: [] });
    assert.equal(scoped.ok, true);
    assert.equal(clicked, "");
    assert.equal((document.querySelector("#md") as HTMLTextAreaElement).value, "scoped");

    mount(`
      <input type="file" />
      <label>Display name <input id="name" /></label>
      <label><input type="radio" /> Publish this file automatically once approved</label>
      <span>Minecraft *</span>
      <button type="button" role="option">26.3</button>
      <span>Release Type</span>
      <button type="button" role="option">Release</button>
      <div role="combobox">WYSIWYG</div>
      <div role="option">Markdown</div>
      <textarea class="mde-text" id="stuck"></textarea>
      <iframe class="tox-edit-area__iframe" srcdoc="<html><body></body></html>"></iframe>
      <button type="button">Add File</button>
      <a href="https://authors.curseforge.com/#/projects/1/files/42">file</a>
    `);
    const stuck = document.querySelector("#stuck") as HTMLTextAreaElement;
    Object.defineProperty(stuck, "value", { configurable: true, get: () => "", set: () => {} });
    const stuckFrame = document.querySelector("iframe") as HTMLIFrameElement;
    const recovered = await fillCurseForgePage({ ...fill, code: true, changelog: "recovered", relations: [] });
    assert.equal(recovered.ok, false);
    if (!recovered.ok) assert.equal(recovered.reason, "markdown editor did not keep the text");
    assert.equal(stuckFrame.contentDocument?.body.textContent, "");
  });

  it("describes an exception thrown while the form is filling", async () => {
    mount(form);
    const query = document.querySelector.bind(document);
    const all = document.querySelectorAll.bind(document);
    let seen = 0;
    document.querySelectorAll = ((selector: string) => {
      seen += 1;
      if (seen > 2) throw new Error("portal missing");
      return all(selector);
    }) as typeof document.querySelectorAll;
    const described = await fillCurseForgePage(fill);
    document.querySelectorAll = all;
    assert.equal(described.ok, false);
    if (!described.ok) {
      assert.equal(described.step, "exception");
      assert.equal(described.reason, "Error: portal missing");
      assert.match(described.message, /portal missing/);
      assert.match(described.logs?.join("\n") ?? "", /file placed/);
      assert.match(described.logs?.join("\n") ?? "", /exception: Error: portal missing/);
      assert.ok((described.filled ?? []).includes("file"));
    }
    document.querySelector = (() => {
      throw new Error("");
    }) as typeof document.querySelector;
    const empty = await fillCurseForgePage(fill);
    assert.equal(empty.ok ? "" : empty.reason, "The form script threw.");
    document.querySelector = (() => {
      throw "boom";
    }) as typeof document.querySelector;
    const bare = await fillCurseForgePage(fill);
    assert.match(bare.ok ? "" : bare.message, /The form script threw/);
    document.querySelector = query;
  });
});

describe("failure report", () => {
  it("strips secrets and builds a ticket from the public facts", async () => {
    assert.equal(publicHostConfig("nexus", undefined), undefined);
    assert.equal(publicHostConfig("nexus", {}), undefined);
    assert.equal(publicHostConfig("curseforge", { projectId: "  " }), undefined);
    assert.deepEqual(
      publicHostConfig("curseforge", { projectId: "9", password: "p", cookie: "c", secretNote: "s", myKey: "k" }),
      { projectId: "9" },
    );
    const configs = defaultConfigs();
    configs.nexus.fields = { apiKey: "secret-key", gameDomain: "site", modId: "1", token: "nope" };
    assert.deepEqual(failureFacts("nexus", input, configs), {
      file: "lanterns.zip",
      config: { gameDomain: "site", modId: "1" },
    });
    configs.github.fields = { token: "t" };
    assert.deepEqual(failureFacts("github", { ...input, fileName: "" }, configs), {});
    configs.curseforge.fields = { projectId: "2" };
    assert.deepEqual(failureFacts("curseforge", { ...input, fileName: "  " }, configs), {
      config: { projectId: "2" },
    });

    const bot: SiteResult = {
      id: "curseforge",
      status: "error",
      message: "CurseForge changelog editor did not open. The tab was left open.",
      step: "changelog",
      reason: "Both  Editors",
      file: "README.md.zip",
      filled: ["file"],
      config: { projectId: "2", custom: "x" },
    };
    assert.equal(failureSignature(bot), "curseforge|changelog|both editors");
    assert.equal(failureSignature({ id: "nexus", message: "Host down" }), "nexus|host|host down");
    assert.equal(ticketTitle("CurseForge", bot), "OmniMod: CurseForge bot failed — changelog: Both Editors");
    assert.equal(
      ticketTitle("Nexus Mods", { id: "nexus", status: "error", message: "Host down", step: "upload" }),
      "OmniMod: Nexus Mods failed — upload: Host down",
    );
    assert.equal(
      ticketTitle("Ghost", { id: "ghost" as SiteResult["id"], status: "error", message: "Unknown host failed." }),
      "OmniMod: Ghost failed — host: Unknown host failed.",
    );
    const body = ticketBody(bot);
    assert.match(body, /\*\*Host:\*\* CurseForge/);
    assert.match(body, /\*\*Lane:\*\* bot/);
    assert.match(body, /\*\*Step:\*\* changelog/);
    assert.match(body, /\*\*File:\*\* README.md.zip/);
    assert.match(body, /## Filled/);
    assert.match(body, /Project ID: 2/);
    assert.match(body, /custom: x/);
    assert.match(body, /The tab was left open/);
    assert.match(body, /\*\*Time:\*\* \d{4}-/);
    assert.equal(body.includes("CurseForge changelog editor did not open"), false);
    assert.equal(body.includes("## Log"), false);
    const logged = ticketBody({ ...bot, logs: ["file placed", "stop changelog: both editors stayed empty"] });
    assert.match(logged, /## Log/);
    assert.match(logged, /file placed/);
    const api = ticketBody({ id: "github", status: "error", message: "HTTP 500" });
    assert.match(api, /HTTP 500/);
    assert.equal(api.includes("## Notes"), false);
    assert.equal(api.includes("## Filled"), false);
    const bare = ticketBody({ id: "github", status: "error", message: "HTTP 500", filled: [], config: {}, logs: [] });
    assert.equal(bare.includes("## Filled"), false);
    assert.equal(bare.includes("## Config"), false);
    assert.equal(bare.includes("## Log"), false);
    const later = ticketBody({ id: "steam", status: "error", message: "later", reason: "not yet" });
    assert.match(later, /not implemented yet/);
    assert.equal(later.includes("\nlater"), false);
    const href = ticketHref("OmniMod: CurseForge bot failed — changelog: Both Editors", body, "curseforge");
    assert.match(href, /^https:\/\/github.com\/musical-pig-dev\/OmniMod\/issues\/new\?/);
    assert.match(href, /bug/);

    const title = "OmniMod: CurseForge bot failed — file: form accepts .zip only";
    const quoted = 'OmniMod: CurseForge bot failed — file: say "zip"';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    assert.equal(await findOpenTicket(title), null);
    globalThis.fetch = originalFetch;

    const seen: string[] = [];
    const lookup = async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        json: async () => ({
          items: [
            null,
            "skip",
            { title: "other", html_url: "https://github.com/musical-pig-dev/OmniMod/issues/1" },
            { title, html_url: 4 },
            { title, html_url: "http://example.com/nope" },
            { title, html_url: "https://github.com/musical-pig-dev/OmniMod/issues/12" },
          ],
        }),
      };
    };
    assert.equal(await findOpenTicket(quoted, lookup), null);
    assert.match(seen[0] ?? "", /say%20zip/);
    assert.equal((seen[0] ?? "").includes("%22zip%22"), false);
    assert.equal(
      await findOpenTicket(title, async () => ({ ok: false, json: async () => ({}) })),
      null,
    );
    assert.equal(
      await findOpenTicket(title, async () => ({
        ok: true,
        json: async () => {
          throw new Error("bad");
        },
      })),
      null,
    );
    assert.equal(await findOpenTicket(title, async () => ({ ok: true, json: async () => null })), null);
    assert.equal(await findOpenTicket(title, async () => ({ ok: true, json: async () => "nope" })), null);
    assert.equal(await findOpenTicket(title, async () => ({ ok: true, json: async () => ({}) })), null);
    assert.equal(await findOpenTicket(title, async () => ({ ok: true, json: async () => ({ items: "no" }) })), null);
    assert.equal(await findOpenTicket(title, async () => ({ ok: true, json: async () => ({ items: [] }) })), null);
    assert.equal(await findOpenTicket(title, lookup), "https://github.com/musical-pig-dev/OmniMod/issues/12");
  });
});
