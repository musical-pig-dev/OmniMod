import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  acceptFiles,
  acceptLabel,
  accountFields,
  defaultConfigs,
  fieldValue,
  fileExtension,
  hostLimitDetail,
  isConfigured,
  modFields,
  platformById,
  readiness,
  resolvedField,
  curseForgeOnForm,
  typeBlock,
  typeLock,
  uploadHint,
  uploadRule,
  type PlatformId,
} from "./catalog.ts";

describe("catalog", () => {
  it("splits account keys from per-mod ids", () => {
    const nexus = platformById("nexus");
    assert.deepEqual(accountFields(nexus).map((field) => field.key), ["apiKey"]);
    assert.deepEqual(modFields(nexus).map((field) => field.key), ["gameDomain", "modId"]);
    assert.deepEqual(accountFields(platformById("thunderstore")).map((field) => field.key), ["token", "namespace"]);
    assert.deepEqual(modFields(platformById("steam")).map((field) => field.key), ["appId", "itemId"]);
  });

  it("trims field values and reports readiness", () => {
    const platform = platformById("nexus");
    const empty = defaultConfigs().nexus;
    assert.equal(fieldValue(empty, "apiKey"), "");
    assert.equal(fieldValue({ enabled: true, fields: { apiKey: "  k  " } }, "apiKey"), "k");
    assert.equal(readiness(platform, empty), "needs-setup");
    assert.equal(readiness(platform, { enabled: false, fields: { apiKey: "k", gameDomain: "site", modId: "1" } }), "off");
    assert.equal(isConfigured(platform, { enabled: true, fields: { apiKey: "k", gameDomain: "site", modId: "1" } }), true);
    assert.equal(readiness(platform, { enabled: true, fields: { apiKey: "k", gameDomain: "site", modId: "1" } }), "ready");
  });

  it("rejects an unknown platform id", () => {
    assert.throws(() => platformById("nope" as PlatformId), /Unknown platform nope/);
  });

  it("limits the upload to the strictest host that has keys", () => {
    const configs = defaultConfigs();
    assert.equal(hostLimitDetail("modrinth"), "More than one file, up to 500 MiB each.");
    assert.equal(hostLimitDetail("github"), "More than one file, up to 2 GiB each.");
    assert.equal(hostLimitDetail("curseforge"), "One archive, up to 2 GB.");
    assert.equal(platformById("curseforge").tokenUrl, "https://www.curseforge.com/");
    assert.equal(hostLimitDetail("thunderstore"), "One archive, up to 5 GB.");
    assert.equal(hostLimitDetail("nexus"), "One archive. No published size cap.");
    assert.equal(hostLimitDetail("steam"), "One archive. No published size cap.");
    assert.equal(acceptLabel(platformById("github")), "Accepts any file type.");
    assert.equal(acceptLabel(platformById("modrinth")), "Accepts .jar.");
    assert.equal(fileExtension("pack.JAR"), ".jar");
    assert.equal(fileExtension("README"), "");
    assert.equal(fileExtension(".jar"), "");
    const fill = (id: PlatformId) => {
      configs[id] = {
        enabled: true,
        fields: Object.fromEntries(platformById(id).fields.map((field) => [field.key, "set"])),
      };
    };
    assert.equal(typeLock(configs), null);
    assert.equal(typeBlock(platformById("steam"), configs, "mod.jar"), null);
    fill("modrinth");
    const jars = uploadRule(configs);
    assert.equal(jars.maxBytes, 500 * 1024 * 1024);
    assert.equal(jars.multiple, true);
    assert.deepEqual(jars.extensions, [".jar"]);
    assert.equal(uploadHint(jars), "More than one file is allowed. Largest file 500 MiB.");
    fill("github");
    const wider = uploadRule(configs);
    assert.equal(wider.maxBytes, 500 * 1024 * 1024);
    assert.equal(wider.multiple, true);
    assert.equal(wider.hosts, 2);
    const githubFirst = defaultConfigs();
    githubFirst.github = {
      enabled: true,
      fields: Object.fromEntries(platformById("github").fields.map((field) => [field.key, "set"])),
    };
    githubFirst.modrinth = {
      enabled: true,
      fields: Object.fromEntries(platformById("modrinth").fields.map((field) => [field.key, "set"])),
    };
    const tighter = uploadRule({
      ...defaultConfigs(),
      github: githubFirst.github,
      modrinth: { enabled: false, fields: githubFirst.modrinth.fields },
    });
    assert.equal(tighter.label, "2 GiB");
    assert.equal(tighter.extensions, null);
    const bothCaps = uploadRule(githubFirst);
    assert.equal(bothCaps.label, "500 MiB");
    assert.equal(bothCaps.hosts, 2);
    configs.modrinth = { enabled: true, fields: { token: "only-the-key" } };
    configs.github.enabled = false;
    const partial = uploadRule({ ...defaultConfigs(), github: configs.github, modrinth: configs.modrinth });
    assert.equal(partial.hosts, 0);
    fill("thunderstore");
    const thunder = uploadRule(configs);
    assert.equal(thunder.maxBytes, 5_242_880_000);
    assert.equal(thunder.multiple, false);
    assert.deepEqual(thunder.extensions, [".zip"]);
    assert.equal(uploadHint(thunder), "One archive. Largest file 5 GB.");
    fill("github");
    configs.github.enabled = true;
    const capped = uploadRule(configs);
    assert.equal(capped.maxBytes, 2 * 1024 * 1024 * 1024 - 1);
    assert.equal(capped.multiple, false);
    const openClash = defaultConfigs();
    openClash.modrinth = githubFirst.modrinth;
    openClash.thunderstore = configs.thunderstore;
    openClash.github = configs.github;
    assert.equal(uploadRule(openClash).extensions, null);
    assert.equal(uploadRule(openClash).hosts, 1);
    configs.thunderstore.enabled = false;
    configs.github.enabled = false;
    configs.modrinth.enabled = false;
    fill("curseforge");
    const bot = uploadRule(configs);
    assert.equal(bot.hosts, 0);
    assert.equal(bot.extensions, null);
    const nexusOnly = defaultConfigs();
    nexusOnly.nexus = {
      enabled: true,
      fields: Object.fromEntries(platformById("nexus").fields.map((field) => [field.key, "set"])),
    };
    const nexus = uploadRule(nexusOnly);
    assert.equal(nexus.maxBytes, null);
    assert.equal(uploadHint(nexus), "One archive. No size cap from these hosts.");
    assert.deepEqual(nexus.extensions, [".zip", ".rar", ".7z"]);
    const clash = defaultConfigs();
    clash.modrinth = githubFirst.modrinth;
    clash.thunderstore = {
      enabled: true,
      fields: Object.fromEntries(platformById("thunderstore").fields.map((field) => [field.key, "set"])),
    };
    const conflict = uploadRule(clash);
    assert.deepEqual(conflict.extensions, []);
    assert.equal(conflict.hosts, 0);
    assert.equal(typeLock(clash)?.length, 0);
    assert.equal(typeBlock(platformById("modrinth"), clash, ""), "These hosts do not accept the same file type.");
    assert.equal(typeBlock(platformById("github"), clash, ""), null);
    assert.match(typeBlock(platformById("nexus"), githubFirst, "") ?? "", /ready hosts need \.jar/);
    assert.match(typeBlock(platformById("curseforge"), githubFirst, "") ?? "", /ready hosts need \.jar/);
    assert.match(typeBlock(platformById("modrinth"), githubFirst, "lanterns.zip") ?? "", /This file is \.zip/);
    assert.equal(typeBlock(platformById("nexus"), githubFirst, "lanterns.zip"), null);
    assert.equal(typeBlock(platformById("github"), githubFirst, "lanterns.jar"), null);
    const taken = acceptFiles(
      [
        { name: "a-1.2.3.jar", size: 10 },
        { name: "b.jar", size: 500 * 1024 * 1024 + 1 },
      ],
      jars,
      "",
    );
    assert.equal(taken.ok, false);
    assert.match(taken.ok ? "" : taken.message, /500 MiB/);
    const typed = acceptFiles([{ name: "notes.zip", size: 4 }], jars, "");
    assert.equal(typed.ok, false);
    assert.match(typed.ok ? "" : typed.message, /need \.jar/);
    const blocked = acceptFiles([{ name: "notes.jar", size: 4 }], conflict, "");
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok ? "" : blocked.message, /same file type/);
    assert.equal(acceptFiles([], jars, "").ok, false);
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
    const dropped = uploadRule(githubFirst, "lanterns.zip");
    assert.equal(dropped.hosts, 1);
    assert.equal(dropped.label, "2 GiB");
    const shut = defaultConfigs();
    shut.modrinth = githubFirst.modrinth;
    shut.thunderstore = clash.thunderstore;
    shut.github = { enabled: false, fields: { token: "t", repo: "a/b" } };
    assert.deepEqual(uploadRule(shut).extensions, []);
    assert.equal(typeBlock(platformById("nexus"), defaultConfigs(), ""), null);
  });

  it("keeps CurseForge ready only with a project id and game versions", () => {
    const curse = platformById("curseforge");
    const bare = { enabled: true, fields: {} };
    assert.equal(isConfigured(curse, bare), false);
    assert.equal(isConfigured(curse, { enabled: true, fields: { projectId: "  " } }), false);
    assert.equal(isConfigured(curse, { enabled: true, fields: { projectId: "9" } }), false);
    assert.equal(isConfigured(curse, { enabled: true, fields: { projectId: "9", gameVersions: "  " } }), false);
    assert.equal(isConfigured(curse, { enabled: true, fields: { projectId: "9", gameVersions: "17045" } }), true);
    const release = curse.fields.find((field) => field.key === "releaseType");
    const project = curse.fields.find((field) => field.key === "projectId");
    assert.ok(release && project);
    assert.equal(resolvedField(release, bare), "release");
    assert.equal(resolvedField(release, { enabled: true, fields: { releaseType: " beta " } }), "beta");
    assert.equal(resolvedField(project, bare), "");
    const configs = defaultConfigs();
    assert.equal(curseForgeOnForm(configs, ""), false);
    configs.curseforge = { enabled: false, fields: { projectId: "9", gameVersions: "17045" } };
    assert.equal(curseForgeOnForm(configs, "a.zip"), false);
    configs.curseforge = { enabled: true, fields: { projectId: "9" } };
    assert.equal(curseForgeOnForm(configs, "a.zip"), false);
    configs.curseforge = { enabled: true, fields: { projectId: "9", gameVersions: "17045" } };
    assert.equal(curseForgeOnForm(configs, ""), true);
    assert.equal(curseForgeOnForm(configs, "a.zip"), true);
    assert.equal(curseForgeOnForm(configs, "a.jar"), false);
    assert.equal(curseForgeOnForm(configs, "a.jar", true), true);
    assert.equal(curseForgeOnForm(configs, "notes.txt"), false);
    assert.equal(curseForgeOnForm(configs, "notes.txt", true), true);
    assert.equal(typeBlock(platformById("nexus"), configs, "mod.jar", true), null);
    assert.equal(typeBlock(platformById("modrinth"), configs, "notes.txt", true), "Accepts .jar. This file is .txt.");
    assert.equal(typeBlock(platformById("github"), defaultConfigs(), "", true), null);
    const jarHost = defaultConfigs();
    jarHost.modrinth = {
      enabled: true,
      fields: Object.fromEntries(platformById("modrinth").fields.map((field) => [field.key, "set"])),
    };
    assert.equal(typeBlock(platformById("nexus"), jarHost, "", true), null);
    assert.equal(typeBlock(platformById("modrinth"), jarHost, "", true), null);
    const nexusOnly = defaultConfigs();
    nexusOnly.nexus = {
      enabled: true,
      fields: Object.fromEntries(platformById("nexus").fields.map((field) => [field.key, "set"])),
    };
    const zipRule = uploadRule(nexusOnly, "", true);
    const packed = acceptFiles(
      [
        { name: "mod.jar", size: 4 },
        { name: "notes.txt", size: 4 },
      ],
      zipRule,
      "",
      true,
    );
    assert.equal(packed.ok && packed.fileName, "mod.jar, notes.txt");
    const jars = uploadRule(jarHost);
    const already = acceptFiles([{ name: "mod.zip", size: 4 }], jars, "", true);
    assert.equal(already.ok && already.fileName, "mod.zip");
    const rejected = acceptFiles([{ name: "notes.txt", size: 4 }], jars, "", true);
    assert.equal(rejected.ok, false);
    const open = acceptFiles([{ name: "notes.txt", size: 4 }], { ...jars, extensions: null }, "", true);
    assert.equal(open.ok && open.fileName, "notes.txt");
    const clash = defaultConfigs();
    clash.modrinth = jarHost.modrinth;
    clash.thunderstore = {
      enabled: true,
      fields: Object.fromEntries(platformById("thunderstore").fields.map((field) => [field.key, "set"])),
    };
    const clashPacked = acceptFiles([{ name: "notes.txt", size: 4 }], uploadRule(clash), "", true);
    assert.equal(clashPacked.ok && clashPacked.fileName, "notes.txt");
  });
});
