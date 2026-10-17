import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OMNIMOD_EXTENSION_ID, liveHost, liveTransport, selectTransport, sleep, chromeCurseDriver, uploadThunderstoreInPage } from "./live.ts";
import type { CurseFormFill, PublishInput, Transport } from "./publish.ts";
import { makeZip } from "./zip.ts";

const file = new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" });
const pack = new Blob(["icon.png README.md manifest.json"]);
const quiet = async () => {};
const input = (fields?: Record<string, string>, extra: Partial<PublishInput> = {}): PublishInput => ({
  fileName: "lanterns.zip",
  version: "0.0.1",
  changelog: "Glass.",
  file,
  ...(fields ? { fields } : {}),
  ...extra,
});

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

function partResponse(): Response {
  return new Response(null, { status: 200, headers: { etag: '"abc"' } });
}

function multipartBody(id = "up-1", partSize = 2): Record<string, unknown> {
  return {
    id,
    part_presigned_urls: ["https://files.example/p1", "https://files.example/p2"],
    part_size_bytes: partSize,
    complete_presigned_url: "https://files.example/complete",
  };
}

function host(fetchImpl: typeof fetch) {
  return liveTransport(fetchImpl, quiet);
}

describe("live transport", () => {
  it("stays on the rehearsal while developing and uses the override", async () => {
    const custom: Transport = async () => ({ ok: true });
    assert.equal(selectTransport(custom), custom);
    assert.equal(selectTransport(undefined, true).name, "");
    assert.notEqual(selectTransport(undefined, false), selectTransport(undefined, true));
    assert.equal(liveHost("nexus"), "https://api.nexusmods.com/v3");
    assert.equal(liveHost("curseforge"), "https://authors.curseforge.com");
    assert.equal(liveHost("modrinth"), "https://api.modrinth.com");
    assert.equal(liveHost("github"), "https://api.github.com");
    assert.equal(liveHost("thunderstore"), "https://thunderstore.io");
    assert.equal(liveHost("steam"), "https://thunderstore.io");
    assert.equal((await liveTransport()("steam", input())).ok, false);
    await sleep(0);
  });

  it("refuses steam and a missing package", async () => {
    const transport = host(async () => jsonResponse({}));
    assert.match((await transport("steam", input({}))).message ?? "", /later date/);
    assert.match((await transport("curseforge", input({ projectId: "9" }))).message ?? "", /game version/);
    assert.match((await transport("curseforge", input({}))).message ?? "", /project id/);
    const missing = await transport("github", { ...input({ repo: "a/b" }), file: null });
    assert.equal(missing.ok, false);
    const bare = await transport("modrinth", {
      fileName: "a.zip",
      version: "1.0.0",
      changelog: "c",
      file,
    });
    assert.equal(bare.ok, true);
  });

  it("publishes to each host and reports their refusals", async () => {
    const calls: string[] = [];
    const forms: string[] = [];
    const posted: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      calls.push(`${init?.method ?? "GET"} ${target}`);
      if (init?.body instanceof FormData) forms.push([...init.body.keys()].sort().join(","));
      if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
        return jsonResponse({ data: multipartBody() });
      }
      if (target.includes("files.example/p")) return partResponse();
      if (target.endsWith("/complete")) return new Response(null, { status: 200 });
      if (target.endsWith("/finalise")) return jsonResponse({ data: { state: "processing" } });
      if (target.endsWith("/uploads/up-1") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          data: { state: calls.filter((call) => call.includes("/uploads/up-1")).length > 1 ? "available" : "processing" },
        });
      }
      if (target.includes("/games/") && target.includes("/mods/")) {
        if (target.endsWith("/mods/missing")) return jsonResponse({ data: {} });
        if (target.includes("/games/gone/")) return jsonResponse({ message: "mod not found" }, 404);
        return jsonResponse({ data: { id: "internal-12" } });
      }
      if (target.endsWith("/mod-files")) {
        posted.push(String(init?.body ?? ""));
        return jsonResponse({ data: { id: "file-1" } }, 201);
      }
      if (target.includes("upload.curseforge.com")) return jsonResponse({ id: 9 });
      if (target.includes("api.modrinth.com")) return jsonResponse({ id: "ver" }, 200);
      if (target.includes("api.github.com") && init?.method === "POST") {
        return jsonResponse({ upload_url: "https://uploads.github.com/repos/a/b/releases/1/assets{?name,label}" });
      }
      if (target.includes("uploads.github.com")) return jsonResponse({ id: 3 }, 201);
      if (target.includes("initiate-upload")) {
        return jsonResponse({
          user_media: { uuid: "up-1" },
          upload_urls: [{ url: "https://files.example/ts1", part_number: 1, offset: 0, length: 99 }],
        }, 201);
      }
      if (target.includes("files.example/ts1")) return new Response(null, { status: 200, headers: { etag: '"etag"' } });
      if (target.includes("thunderstore.io")) return new Response("", { status: 204 });
      return jsonResponse({ message: "no" }, 500);
    };
    const transport = host(fetchImpl);
    const nexus = await transport("nexus", input({ apiKey: "k", gameDomain: "skyrimspecialedition", modId: "195304" }, { fileName: "bad [name].zip" }));
    assert.equal(nexus.ok && nexus.url, "https://www.nexusmods.com/skyrimspecialedition/mods/195304");
    assert.match(posted[0] ?? "", /"mod_id":"internal-12"/);
    assert.equal((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "12" }, { fileName: "###" }))).ok, true);
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "12" }))).message ?? "", /game domain/);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "site" }))).message ?? "", /game domain/);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "missing" }))).message ?? "", /no id/);
    assert.equal((await transport("nexus", input({ gameDomain: "site", modId: "12" }))).ok, true);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "gone", modId: "12" }))).message ?? "", /mod not found/);
    assert.match((await transport("curseforge", input({ projectId: "9" }))).message ?? "", /game version/);
    assert.match((await transport("curseforge", input({}))).message ?? "", /project id/);
    const modrinth = await transport("modrinth", input({ token: "mrp", project: "testproject-junk492304" }));
    assert.equal(modrinth.ok && modrinth.url, "https://modrinth.com/mod/testproject-junk492304/versions");
    const plain = await transport("modrinth", input({}));
    assert.equal(plain.ok, true);
    assert.equal(plain.url, undefined);
    assert.ok(calls.some((call) => call.startsWith("GET https://api.modrinth.com/v2/project/testproject-junk492304")));
    const github = await transport("github", input({ token: "gh", repo: "musical-pig-game/omnimod-test" }));
    assert.equal(github.ok && github.url, "https://github.com/musical-pig-game/omnimod-test/releases");
    assert.equal((await transport("github", input({ repo: "studio/mod" }))).ok, true);
    const thunder = await transport(
      "thunderstore",
      input({ token: "tss", namespace: "Team", community: "riskofrain2" }, { file: pack }),
    );
    assert.equal(thunder.ok && thunder.detail, "Team");
    assert.equal(thunder.url, undefined);
    const listed = await transport(
      "thunderstore",
      input(
        { token: "tss", namespace: "LazyTeamNoWork", community: "riskofrain2" },
        { file: new Blob(['{"name": "MyFirstMod"} icon.png README.md manifest.json']) },
      ),
    );
    assert.equal(listed.ok && listed.url, "https://thunderstore.io/c/riskofrain2/p/LazyTeamNoWork/MyFirstMod/");
    const unnamed = await transport("thunderstore", input({ community: "riskofrain2" }, { file: pack }));
    assert.equal(unnamed.ok && unnamed.detail, "");
    assert.ok(forms.includes("data,file"));
  });

  it("returns the host's reason when a call fails", async () => {
    const mode = { value: "empty", polls: 0 };
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      if (mode.value === "empty") return new Response("", { status: 422 });
      if (mode.value === "plain") return new Response("not-json-but-long", { status: 400 });
      if (mode.value === "detail") return jsonResponse({ detail: "archived" }, 422);
      if (mode.value === "title") return jsonResponse({ title: "Unprocessable Entity" }, 422);
      if (mode.value === "message") return jsonResponse({ message: "missing game version" }, 400);
      if (mode.value === "error") return jsonResponse({ error: "unauthorized" }, 401);
      if (mode.value === "cf") return jsonResponse({ errorMessage: "versions required" }, 400);
      if (mode.value === "slot") return jsonResponse({ data: {} });
      if (mode.value === "notarget") return jsonResponse({ data: { id: "up", part_presigned_urls: [] } });
      if (mode.value === "nocomplete") {
        return jsonResponse({ data: { id: "up", part_presigned_urls: ["https://files.example/p1"] } });
      }
      if (mode.value === "num") return new Response("1", { status: 201, headers: { "content-type": "application/json" } });
      if (mode.value === "put") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({ data: multipartBody("up") });
        }
        return new Response(JSON.stringify({ description: "signature" }), { status: 403 });
      }
      if (mode.value === "final") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({ data: multipartBody("up") });
        }
        if (target.includes("files.example")) return partResponse();
        return jsonResponse({ error: "closed" }, 409);
      }
      if (mode.value === "xml") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({
            data: { ...multipartBody("up"), complete_presigned_url: "https://complete.example" },
          });
        }
        if (target.includes("files.example/p")) return partResponse();
        return jsonResponse({ error: "closed" }, 409);
      }
      if (mode.value === "wait") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({
            id: "up",
            part_presigned_urls: ["https://files.example/p1"],
            complete_presigned_url: "https://files.example/complete",
          });
        }
        if (target.includes("files.example")) return new Response(null, { status: 200 });
        if (target.endsWith("/finalise")) return jsonResponse({ state: "processing" });
        return jsonResponse({ message: "still working" }, 503);
      }
      if (mode.value === "stuck") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({ data: multipartBody("up", 0) });
        }
        if (target.includes("files.example")) return partResponse();
        if (target.endsWith("/finalise")) return jsonResponse({ data: { state: "processing" } });
        mode.polls += 1;
        if (mode.polls === 1) return jsonResponse({ data: {} });
        return jsonResponse({ data: { state: "processing" } });
      }
      if (mode.value === "asset") {
        if (target.includes("api.github.com")) {
          return jsonResponse({ upload_url: "https://uploads.github.com/repos/a/b/releases/1/assets{?name,label}" });
        }
        return jsonResponse({ message: "asset rejected" }, 422);
      }
      if (mode.value === "publish") {
        if (target.endsWith("/uploads/multipart") && init?.method === "POST") {
          return jsonResponse({ data: multipartBody("up") });
        }
        if (target.includes("files.example")) return partResponse();
        if (target.endsWith("/finalise")) return jsonResponse({ data: { state: "processing" } });
        if (target.endsWith("/uploads/up")) return jsonResponse({ data: { state: "available" } });
        if (target.includes("/games/") && target.includes("/mods/")) return jsonResponse({ data: { id: "internal-1" } });
        return jsonResponse({ message: "mod id is not a uuid" }, 422);
      }
      if (mode.value === "nullbody") return new Response("null", { status: 201, headers: { "content-type": "application/json" } });
      if (mode.value === "textdata") return jsonResponse({ data: "x" });
      if (mode.value === "ts") return new Response("", { status: 204 });
      if (mode.value === "nourl") return jsonResponse({ upload_url: null });
      if (mode.value === "slice") return jsonResponse({ description: "", detail: "", title: "", message: "", error: "", errorMessage: "" }, 400);
      if (mode.value === "scalar") return new Response("true", { status: 400, headers: { "content-type": "application/json" } });
      if (mode.value === "nullerr") return new Response("null", { status: 400, headers: { "content-type": "application/json" } });
      return new Response("  ", { status: 400 });
    };
    const transport = host(fetchImpl);
    mode.value = "empty";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /422/);
    mode.value = "plain";
    assert.match((await transport("modrinth", input({ token: "t", project: "p" }))).message ?? "", /not-json/);
    mode.value = "detail";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /archived/);
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /archived/);
    assert.match((await transport("github", input({ token: "t", repo: "nope" }))).message ?? "", /owner\/name/);
    assert.match((await transport("github", input({ token: "t" }))).message ?? "", /owner\/name/);
    mode.value = "title";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /Unprocessable/);
    mode.value = "message";
    assert.match(
      (await transport("thunderstore", input({ token: "t", namespace: "Team", community: "riskofrain2" }, { file: pack }))).message ?? "",
      /game version/,
    );
    mode.value = "error";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /unauthorized/);
    mode.value = "cf";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /versions required/);
    mode.value = "slot";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "notarget";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "nocomplete";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "num";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "put";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /signature/);
    mode.value = "final";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /closed/);
    mode.value = "xml";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /closed/);
    mode.value = "wait";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /still working/);
    mode.value = "stuck";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /not finished/);
    mode.value = "asset";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /asset rejected/);
    mode.value = "publish";
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "1" }, { fileName: "   " }))).message ?? "", /uuid/);
    mode.value = "nullbody";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "nourl";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /upload URL/);
    mode.value = "ts";
    assert.match(
      (await transport("thunderstore", input({ token: "t", community: "riskofrain2" }, { file: pack }))).message ?? "",
      /upload slot/,
    );
    mode.value = "textdata";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "slice";
    assert.match((await transport("modrinth", input({ token: "t", project: "p" }))).message ?? "", /description/);
    mode.value = "scalar";
    assert.match((await transport("modrinth", input({ token: "t", project: "p" }))).message ?? "", /true/);
    mode.value = "nullerr";
    assert.match((await transport("modrinth", input({ token: "t", project: "p" }))).message ?? "", /null/);
    mode.value = "blank";
    assert.equal((await transport("modrinth", input({ token: "t", project: "p" }))).ok, false);
  });

  it("resolves a Modrinth slug and refuses a file the project type cannot take", async () => {
    const posted: string[] = [];
    const agents: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      const headers = new Headers(init?.headers);
      agents.push(headers.get("user-agent") ?? "");
      if (target.endsWith("/project/lanterns")) {
        return jsonResponse({ id: "XG8V0uy1", project_type: "mod" });
      }
      if (target.endsWith("/project/pack")) {
        return jsonResponse({ id: "PACKID01", project_type: "resourcepack" });
      }
      if (target.endsWith("/project/missing-id")) return jsonResponse({});
      if (target.endsWith("/version") && init?.method === "POST" && init.body instanceof FormData) {
        posted.push(String(init.body.get("data")));
        return jsonResponse({ id: "8uaAZimd" });
      }
      return jsonResponse({ description: "no" }, 404);
    };
    const transport = host(fetchImpl);
    const refused = await transport(
      "modrinth",
      input({ token: "mrp", project: "lanterns", gameVersions: "1.20.1", loaders: "fabric" }),
    );
    assert.match(refused.message ?? "", /needs a \.jar/);
    assert.equal(posted.length, 0);
    const accepted = await transport(
      "modrinth",
      input(
        { token: "mrp", project: "lanterns", gameVersions: "1.20.1, 1.21", loaders: "fabric, quilt" },
        { fileName: "test-mod.jar" },
      ),
    );
    assert.equal(accepted.ok, true);
    assert.match(posted[0] ?? "", /"project_id":"XG8V0uy1"/);
    assert.match(posted[0] ?? "", /"game_versions":\["1\.20\.1","1\.21"\]/);
    assert.match(posted[0] ?? "", /"loaders":\["fabric","quilt"\]/);
    const pack = await transport(
      "modrinth",
      input({ token: "mrp", project: "pack" }, { fileName: "pack.jar" }),
    );
    assert.match(pack.message ?? "", /resourcepack/);
    assert.match((await transport("modrinth", input({ token: "mrp", project: "missing-id" }))).message ?? "", /no id/);
    assert.ok(agents.every((agent) => agent === "OmniMod/0.1"));
  });

  it("uploads a Thunderstore package in parts and refuses a zip that is not a package", async () => {
    const puts: { url: string; auth: string | null; size: number }[] = [];
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      const headers = new Headers(init?.headers);
      if (target.includes("initiate-upload")) {
        return jsonResponse({
          user_media: { uuid: "media-1" },
          upload_urls: [
            { url: "https://s3.example/a", part_number: 1, offset: 0, length: 4 },
            { url: "https://s3.example/b", part_number: 2, offset: 4, length: 99 },
          ],
        }, 201);
      }
      if (target.includes("s3.example")) {
        puts.push({
          url: target,
          auth: headers.get("authorization"),
          size: init?.body instanceof Uint8Array ? init.body.byteLength : 0,
        });
        return new Response(null, { status: 200, headers: { etag: '"abc"' } });
      }
      if (init?.body) bodies.push(String(init.body));
      if (target.includes("finish-upload")) return new Response("", { status: 204 });
      if (target.includes("/submission/submit")) return jsonResponse({ package_version: "1" }, 201);
      return jsonResponse({ message: "no" }, 500);
    };
    const transport = host(fetchImpl);
    const refused = await transport("thunderstore", input({ token: "tss", namespace: "Team", community: "riskofrain2" }));
    assert.match(refused.message ?? "", /icon\.png/);
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const archive = new Blob([bytes, new TextEncoder().encode("icon.png README.md manifest.json")]);
    const sent = await transport(
      "thunderstore",
      input({ token: "tss", namespace: "Team", community: "lethal-company", categories: "items, skills" }, { file: archive }),
    );
    assert.equal(sent.ok && sent.detail, "Team");
    assert.equal(puts.length, 2);
    assert.equal(puts[0]?.auth, null);
    assert.equal(puts[0]?.size, 4);
    assert.equal(puts[1]?.size, archive.size - 4);
    assert.match(bodies.find((body) => body.includes("ETag")) ?? "", /"ETag":"abc"/);
    assert.match(bodies.find((body) => body.includes("author_name")) ?? "", /"author_name":"Team"/);
    assert.match(bodies.find((body) => body.includes("author_name")) ?? "", /"lethal-company":\["items","skills"\]/);
    const noCommunity = await transport("thunderstore", input({ token: "tss", namespace: "Team" }, { file: pack }));
    assert.match(noCommunity.message ?? "", /community/);
  });

  it("covers the remaining host branches", async () => {
    const mode = { value: "modpack" };
    const posted: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      if (target.includes("api.modrinth.com/v2/project/")) {
        return jsonResponse({ id: "ID000001", project_type: mode.value });
      }
      if (mode.value === "slot") return jsonResponse({ user_media: { uuid: "u" }, upload_urls: {} }, 201);
      if (mode.value === "nouuid") return jsonResponse({ upload_urls: [] }, 201);
      if (mode.value === "nourl") {
        return jsonResponse({ user_media: { uuid: "u" }, upload_urls: [{ offset: 0 }] }, 201);
      }
      if (mode.value === "alt") {
        if (target.includes("initiate-upload")) {
          return jsonResponse(
            { user_media: { uuid: "u" }, upload_urls: [{ url: "https://s3.example/c", PartNumber: 3 }] },
            201,
          );
        }
        return jsonResponse({ message: "no" }, 500);
      }
      if (mode.value === "put") {
        if (target.includes("initiate-upload")) {
          return jsonResponse(
            { user_media: { uuid: "u" }, upload_urls: [{ url: "https://s3.example/d", part_number: 1, offset: 0, length: 2 }] },
            201,
          );
        }
        return jsonResponse({ message: "part failed" }, 403);
      }
      if (mode.value === "finish") {
        if (target.includes("initiate-upload")) {
          return jsonResponse(
            { user_media: { uuid: "u" }, upload_urls: [{ url: "https://s3.example/e", part_number: 1 }] },
            201,
          );
        }
        if (target.includes("s3.example")) return new Response(null, { status: 200 });
        return jsonResponse({ detail: "finish failed" }, 409);
      }
      if (mode.value === "submit") {
        if (target.includes("initiate-upload")) {
          return jsonResponse(
            { user_media: { uuid: "u" }, upload_urls: [{ url: "https://s3.example/f", part_number: 1, offset: 0, length: 1 }] },
            201,
          );
        }
        if (target.includes("s3.example")) return new Response(null, { status: 200, headers: { etag: "bare" } });
        if (target.includes("finish-upload")) {
          posted.push(String(init?.body ?? ""));
          return new Response("", { status: 204 });
        }
        return jsonResponse({ error: "rejected" }, 400);
      }
      if (mode.value === "name") {
        posted.push(String(init?.body ?? ""));
        return jsonResponse(
          { user_media: { uuid: "u" }, upload_urls: [{ url: "https://s3.example/g", part_number: 1, offset: 0, length: 1 }] },
          201,
        );
      }
      return jsonResponse({ message: "no" }, 500);
    };
    const transport = host(fetchImpl);
    const fields = { token: "mrp", project: "pack" };
    assert.match((await transport("modrinth", input(fields, { fileName: "pack.zip" }))).message ?? "", /modpack/);
    mode.value = "datapack";
    assert.match((await transport("modrinth", input(fields, { fileName: "pack" }))).message ?? "", /datapack/);
    mode.value = "shader";
    assert.match((await transport("modrinth", input(fields, { fileName: "shade.jar" }))).message ?? "", /shader/);
    mode.value = "mod";
    assert.equal((await transport("modrinth", input(fields, { fileName: "ok.jar" }))).ok, false);
    const ready = { token: "tss", namespace: "Team", community: "riskofrain2" };
    mode.value = "slot";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /upload slot/);
    mode.value = "nouuid";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /upload slot/);
    mode.value = "nourl";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /upload slot/);
    mode.value = "alt";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /part failed|finish failed|rejected|no/);
    mode.value = "put";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /part failed/);
    mode.value = "finish";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /finish failed/);
    mode.value = "submit";
    assert.match((await transport("thunderstore", input(ready, { file: pack }))).message ?? "", /rejected/);
    assert.match(posted[0] ?? "", /"ETag":"bare"/);
    mode.value = "name";
    await transport("thunderstore", input(ready, { file: pack, fileName: "" }));
    assert.match(posted.find((body) => body.includes("filename")) ?? "", /package\.zip/);
    const partial = new Blob(["icon.png README.md"]);
    assert.match((await transport("thunderstore", input(ready, { file: partial }))).message ?? "", /manifest\.json/);
    const jarZip = makeZip([{ name: "mod.jar", bytes: new Uint8Array([1, 2, 3]) }], "MyProject.zip");
    const mark = new Uint8Array(24);
    mark.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(mark.buffer).setUint32(16, 256);
    new DataView(mark.buffer).setUint32(20, 256);
    let binary = "";
    for (const byte of mark) binary += String.fromCharCode(byte);
    const icon = `data:image/png;base64,${btoa(binary)}`;
    const wide = new Uint8Array(mark);
    new DataView(wide.buffer).setUint32(16, 512);
    let wideBinary = "";
    for (const byte of wide) wideBinary += String.fromCharCode(byte);
    assert.match(
      (
        await host(async () => new Response(""))(
          "thunderstore",
          input({ ...ready, icon: `data:image/png;base64,${btoa(wideBinary)}` }, { file: jarZip }),
        )
      ).message ?? "",
      /no larger than 256/,
    );
    assert.match(
      (await host(async () => new Response(""))("thunderstore", input({ ...ready, icon: "data:image/png;base64,a" }, { file: jarZip }))).message ?? "",
      /no larger than 256/,
    );
    assert.match(
      (await host(async () => new Response(""))(
        "thunderstore",
        input(ready, { file: jarZip, fileName: "MyProject.zip", fields: undefined }),
      )).message ?? "",
      /icon\.png/,
    );
    assert.match(
      (await host(async () => new Response(""))("thunderstore", input({ ...ready, icon: "nope" }, { file: jarZip }))).message ?? "",
      /no larger than 256/,
    );
    assert.match(
      (await host(async () => new Response(""))("thunderstore", input({ ...ready, icon: "data:image/png;base64," }, { file: jarZip }))).message ?? "",
      /no larger than 256/,
    );
    let sent = new Uint8Array();
    const packedFetch: typeof fetch = async (url, init) => {
      const target = String(url);
      if (target.includes("initiate-upload")) {
        return jsonResponse(
          {
            user_media: { uuid: "up-2" },
            upload_urls: [{ url: "https://files.example/pack", part_number: 1, offset: 0, length: 9_000_000 }],
          },
          201,
        );
      }
      if (target.includes("files.example/pack")) {
        sent = new Uint8Array(await new Response(init?.body).arrayBuffer());
        return new Response(null, { status: 200, headers: { etag: '"etag"' } });
      }
      return new Response("", { status: 204 });
    };
    const added = await host(packedFetch)(
      "thunderstore",
      input({ ...ready, icon }, { file: jarZip, fileName: "MyProject.zip", version: "0.0.6", changelog: "Notes." }),
    );
    assert.equal(added.ok, true);
    const packedText = new TextDecoder().decode(sent);
    assert.match(packedText, /icon\.png/);
    assert.match(packedText, /README\.md/);
    assert.match(packedText, /manifest\.json/);
    assert.match(packedText, /mod\.jar/);
    assert.match(packedText, /"name": "MyProject"/);
  });
});

describe("curseforge form tab", () => {
  const base = {
    fileName: "lanterns.zip",
    bytes: [1, 2, 3],
    mime: "application/zip",
    displayName: "",
    manual: false,
    versions: ["26.3"],
    releaseType: "Release",
    changelog: "",
    code: false,
    relations: [],
    waitMs: 0,
    stepMs: 0,
  } satisfies CurseFormFill;

  function driver(behavior: {
    open?: (url: string) => Promise<number | null>;
    run?: (tabId: number, fill: CurseFormFill) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
    close?: (tabId: number) => Promise<void>;
  }) {
    const opened: string[] = [];
    const closed: number[] = [];
    return {
      opened,
      closed,
      tabs: {
        open: behavior.open ?? (async (url: string) => {
          opened.push(url);
          return 4;
        }),
        run: behavior.run ?? (async () => ({ ok: true as const, url: "https://authors.curseforge.com/#/projects/1744552/files/9" })),
        close: behavior.close ?? (async (tabId: number) => {
          closed.push(tabId);
        }),
      },
    };
  }

  it("opens the authors form in the background and returns the file link", async () => {
    const form = driver({});
    const transport = liveTransport(async () => jsonResponse({}), quiet, form.tabs);
    const sent = await transport(
      "curseforge",
      input(
        { projectId: "1744552", gameVersions: "26.3", releaseType: "alpha", publishWhen: "manual" },
        { override: { displayName: "Sample", gameVersions: "26.3" } },
      ),
    );
    assert.equal(sent.ok && sent.url, "https://authors.curseforge.com/#/projects/1744552/files");
    assert.equal(form.opened[0], "https://authors.curseforge.com/#/projects/1744552/files/create");
    assert.deepEqual(form.closed, [4]);

    const blank = driver({ run: async () => ({ ok: true, url: "  " }) });
    const missingLink = await liveTransport(async () => jsonResponse({}), quiet, blank.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.match(missingLink.ok ? "" : missingLink.message, /did not show the uploaded file/);
    assert.deepEqual(blank.closed, []);

    const refused = driver({ run: async () => ({ ok: false, message: "CurseForge needs a sign-in. The form tab was left open." }) });
    const blocked = await liveTransport(async () => jsonResponse({}), quiet, refused.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.match(blocked.ok ? "" : blocked.message, /sign-in/);
    assert.deepEqual(refused.closed, []);

    const stuck = driver({
      close: async () => {
        throw new Error("blocked");
      },
    });
    const kept = await liveTransport(async () => jsonResponse({}), quiet, stuck.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(kept.ok && kept.url, "https://authors.curseforge.com/#/projects/1744552/files");

    const noTab = driver({ open: async () => null });
    assert.match(
      (await liveTransport(async () => jsonResponse({}), quiet, noTab.tabs)(
        "curseforge",
        input({ projectId: "1744552", gameVersions: "26.3" }),
      )).ok
        ? ""
        : "CurseForge could not open the form tab.",
      /could not open/,
    );
    const thrown = driver({
      open: async () => {
        throw new Error("no");
      },
    });
    assert.match(
      (
        await liveTransport(async () => jsonResponse({}), quiet, thrown.tabs)(
          "curseforge",
          input({ projectId: "1744552", gameVersions: "26.3" }),
        )
      ).ok
        ? ""
        : "could not open",
      /could not open/,
    );
    const unnamedOpen = driver({
      open: async () => {
        throw "nope";
      },
    });
    const unnamedTab = await liveTransport(async () => jsonResponse({}), quiet, unnamedOpen.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(unnamedTab.ok ? "" : unnamedTab.reason, "The tab could not be opened.");
    const fillThrow = driver({
      run: async () => {
        throw new Error("script");
      },
    });
    const scripted = await liveTransport(async () => jsonResponse({}), quiet, fillThrow.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.match(scripted.ok ? "" : scripted.message, /script/);
    assert.match(scripted.ok ? "" : scripted.message, /left open/);
    assert.equal(scripted.ok ? "" : scripted.step, "scripting");
    assert.deepEqual(scripted.ok ? [] : scripted.logs, ["opened the form tab", "exception: script"]);
    const fillThrowBare = driver({
      run: async () => {
        throw "script";
      },
    });
    const unnamed = await liveTransport(async () => jsonResponse({}), quiet, fillThrowBare.tabs)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(unnamed.ok ? "" : unnamed.reason, "The form script threw.");
    assert.deepEqual(base.versions, ["26.3"]);
  });

  it("uses the chrome tab driver and leaves the tab when the script does not fill", async () => {
    const calls: Array<{ url?: string; active?: boolean; id?: number }> = [];
    const removed: number[] = [];
    let loads = 0;
    const chrome = {
      tabs: {
        create: async (opts: { url: string; active: boolean }) => {
          calls.push(opts);
          return { id: 8 };
        },
        get: async (id: number) => {
          loads += 1;
          if (loads === 1) throw new Error("not yet");
          return { id, status: loads === 2 ? "loading" : "complete" };
        },
        remove: async (id: number) => {
          removed.push(id);
        },
      },
      scripting: {
        executeScript: async () => [{ result: { ok: true, url: "https://www.curseforge.com/projects/simple/files/3" } }],
      },
    };
    (globalThis as { chrome?: unknown }).chrome = chrome;
    const transport = liveTransport(async () => jsonResponse({}), quiet);
    const sent = await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }));
    assert.equal(sent.ok && sent.url, "https://authors.curseforge.com/#/projects/1744552/files");
    assert.equal(calls[0]?.active, false);
    assert.match(calls[0]?.url ?? "", /1744552\/files\/create/);
    assert.deepEqual(removed, [8]);

    chrome.scripting.executeScript = async () => [{ result: { ok: false, message: "CurseForge form did not load. The tab was left open." } }];
    const failed = await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }));
    assert.match(failed.ok ? "" : failed.message, /did not load/);
    assert.equal(failed.ok ? "" : failed.step, undefined);
    assert.deepEqual(failed.ok ? [] : failed.logs, ["opened the form tab"]);

    chrome.scripting.executeScript = async () => [
      {
        result: {
          ok: false,
          message: "CurseForge changelog editor did not open. The tab was left open.",
          step: "changelog",
          reason: "both editors stayed empty",
          filled: ["file"],
          logs: ["file placed"],
        },
      },
    ];
    const detailed = await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }));
    assert.equal(detailed.ok, false);
    if (!detailed.ok) {
      assert.equal(detailed.step, "changelog");
      assert.equal(detailed.reason, "both editors stayed empty");
      assert.deepEqual(detailed.filled, ["file"]);
      assert.deepEqual(detailed.logs, ["opened the form tab", "file placed"]);
    }
    chrome.scripting.executeScript = async () => [{ result: { ok: false, message: "CurseForge form could not be filled. The tab was left open.", filled: [], logs: [] } }];
    const emptyFilled = await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }));
    assert.equal(emptyFilled.ok, false);
    if (!emptyFilled.ok) {
      assert.equal(emptyFilled.filled, undefined);
      assert.deepEqual(emptyFilled.logs, ["opened the form tab"]);
    }

    chrome.scripting.executeScript = async () => [{}];
    assert.match(
      (await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).ok
        ? ""
        : "could not be filled",
      /could not be filled/,
    );
    chrome.scripting.executeScript = async () => [];
    assert.match(
      (await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).ok
        ? ""
        : "could not be filled",
      /could not be filled/,
    );

    const bare = chromeCurseDriver();
    delete (globalThis as { chrome?: unknown }).chrome;
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), null);
    (globalThis as { chrome?: unknown }).chrome = { tabs: {} };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), null);
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        create: async () => ({}),
        remove: async () => {},
      },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), null);
    assert.match((await bare.run(1, base)).message ?? "", /could not be filled/);
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: { create: async () => ({ id: 2 }) },
      scripting: { executeScript: async () => [{ result: { ok: true, url: "https://authors.curseforge.com/#/projects/1/files/4" } }] },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 2);
    await assert.rejects(() => bare.close(2), /could not be closed/);

    let spins = 0;
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        create: async () => ({ id: 5 }),
        get: async () => {
          spins += 1;
          return { status: "loading" };
        },
        remove: async () => {
          throw new Error("no");
        },
      },
      scripting: { executeScript: async () => [{ result: { nope: true } }] },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 5);
    assert.equal(spins, 3);
    assert.match((await bare.run(5, base)).message ?? "", /could not be filled/);
    await assert.rejects(() => bare.close(5), /no/);

    const updated: Array<{ id: number; url: string; active: boolean }> = [];
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: async () => [{ id: 9, url: "https://authors.curseforge.com/#/projects/1" }],
        update: async (id: number, opts: { url: string; active: boolean }) => {
          updated.push({ id, ...opts });
          return { id };
        },
        create: async () => {
          throw new Error("should reuse");
        },
      },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 9);
    assert.equal(updated[0]?.active, false);
    assert.match(updated[0]?.url ?? "", /files\/create/);

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: async () => [{ url: "https://authors.curseforge.com/" }],
        create: async () => ({ id: 11 }),
      },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 11);

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        create: async () => {
          throw new Error("tabs are blocked");
        },
      },
      runtime: {
        sendMessage: async () => ({ id: 12 }),
      },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 12);

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        query: async () => [{ id: 3 }],
        create: async () => ({ id: 4 }),
      },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), 4);

    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        create: async () => {
          throw new Error("tabs are blocked");
        },
      },
      runtime: { sendMessage: async () => ({}) },
    };
    await assert.rejects(() => bare.open("https://authors.curseforge.com/#/projects/1/files/create"), /tabs are blocked/);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async () => ({ error: "I cannot open new tab" }),
      },
    };
    await assert.rejects(() => bare.open("https://authors.curseforge.com/#/projects/1/files/create"), /cannot open new tab/);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: async () => ({}) },
    };
    assert.equal(await bare.open("https://authors.curseforge.com/#/projects/1/files/create"), null);

    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("asks the installed extension to open CurseForge from npm run dev", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const missing = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.step, "tab");
      assert.equal(missing.reason, "no extension");
      assert.match(missing.message, /npm run dev/);
    }

    const calls: unknown[][] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (...args: unknown[]) => {
          calls.push(args);
          const done = args[2] as (reply: unknown) => void;
          done({ ok: true, url: "https://authors.curseforge.com/#/projects/1744552/files/9" });
        },
      },
    };
    const sent = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(sent.ok && sent.url, "https://authors.curseforge.com/#/projects/1744552/files");
    assert.equal(calls[0]?.[0], OMNIMOD_EXTENSION_ID);

    const runtime: { lastError?: { message?: string }; sendMessage: (...args: unknown[]) => void } = {
      sendMessage: (...args: unknown[]) => {
        runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        (args[2] as (reply: unknown) => void)(undefined);
      },
    };
    (globalThis as { chrome?: unknown }).chrome = { runtime };
    const offline = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.match(offline.ok ? "" : offline.message, /Receiving end does not exist/);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: (_id: string, _message: unknown, done: (reply: unknown) => void) => done(undefined) },
    };
    const empty = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(empty.ok ? "" : empty.reason, "no reply");

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (_id: string, _message: unknown, done: (reply: unknown) => void) =>
          done({ ok: false, message: "CurseForge form did not load. The tab was left open.", step: "form", reason: "form did not load", filled: [], logs: ["opened"] }),
      },
    };
    const failed = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(failed.ok ? "" : failed.step, "form");
    assert.equal(failed.ok ? "" : failed.filled, undefined);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (_id: string, _message: unknown, done: (reply: unknown) => void) =>
          done({ ok: false, message: "stopped", step: "minecraft", reason: "no Minecraft field", filled: ["file"], logs: ["file placed"] }),
      },
    };
    const detailed = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(detailed.ok, false);
    if (!detailed.ok) assert.deepEqual(detailed.filled, ["file"]);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: (_id: string, _message: unknown, done: (reply: unknown) => void) => done({ ok: true, url: "  " }) },
    };
    const blank = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.match(blank.ok ? "" : blank.message, /did not show/);

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (_id: string, _message: unknown, done: (reply: unknown) => void) =>
          done({ ok: false, message: "stopped", logs: ["opened"] }),
      },
    };
    const plain = await liveTransport(async () => jsonResponse({}), quiet)(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "26.3" }),
    );
    assert.equal(plain.ok, false);
    if (!plain.ok) {
      assert.equal(plain.step, undefined);
      assert.equal(plain.reason, undefined);
    }
    delete (globalThis as { chrome?: unknown }).chrome;
  });
});

describe("thunderstore page upload", () => {
  const job = {
    token: "tss",
    team: "LazyTeamNoWork",
    community: "riskofrain2",
    categories: ["items"],
    fileName: "test-mod.zip",
    bytes: [97],
  };
  const holder = globalThis as { chrome?: unknown; fetch: typeof fetch };
  const previous = holder.fetch;

  function install(fetchImpl: typeof fetch): void {
    holder.fetch = fetchImpl;
  }

  async function page(mode: string) {
    install(async (url, init) => {
      const target = String(url);
      if (mode === "throw-fetch" || mode === "throw-blank" || (mode === "put-throw" && target.includes("files.example"))) {
        throw mode === "throw-blank" ? new Error("") : new TypeError(mode === "throw-fetch" ? "Failed to fetch" : "socket");
      }
      if (mode === "throw-text") throw "down";
      if (target.includes("initiate-upload")) {
        if (mode === "denied") return new Response("", { status: 401 });
        if (mode === "detail") return jsonResponse({ detail: "bad token" }, 401);
        if (mode === "message") return jsonResponse({ message: "no" }, 400);
        if (mode === "error") return jsonResponse({ error: "nope" }, 400);
        if (mode === "plain") return new Response("not json", { status: 400 });
        if (mode === "emptyjson") return jsonResponse({}, 400);
        if (mode === "junk") return new Response("[]", { status: 201 });
        if (mode === "badjson") return new Response("not-json", { status: 201 });
        if (mode === "nouslot") return jsonResponse({ user_media: {} }, 201);
        if (mode === "nopart") return jsonResponse({ user_media: { uuid: "up" }, upload_urls: [{ url: "", part_number: 0 }] }, 201);
        if (mode === "nourl") return jsonResponse({ user_media: { uuid: "up" }, upload_urls: [{ part_number: 1 }] }, 201);
        if (mode === "nonumber") return jsonResponse({ user_media: { uuid: "up" }, upload_urls: [{ url: "https://files.example/p" }] }, 201);
        if (mode === "cap") return jsonResponse({ user_media: { uuid: "up" }, upload_urls: [{ url: "https://files.example/p", PartNumber: 1, offset: 0, length: 1 }] }, 201);
        return jsonResponse(
          {
            user_media: { uuid: "up-1" },
            upload_urls: [
              { url: "https://files.example/p1", part_number: 1, offset: 0, length: 1 },
              { url: "https://files.example/p2", PartNumber: 2, offset: 1, length: 1 },
            ],
          },
          201,
        );
      }
      if (target.includes("files.example")) {
        if (mode === "put-empty") return new Response("", { status: 403 });
        if (mode === "put-fail") return new Response("nope", { status: 403 });
        if (mode === "noetag") return new Response(null, { status: 200 });
        const header = new Headers(init?.headers).get("content-md5");
        return new Response(null, { status: 200, headers: { etag: `"${header}"` } });
      }
      if (target.includes("finish-upload")) {
        if (mode === "finish") return jsonResponse({ error: "finish failed" }, 400);
        return new Response("", { status: 204 });
      }
      if (mode === "submit") return jsonResponse({ detail: "rejected" }, 400);
      const body = String(init?.body ?? "");
      assert.match(body, /LazyTeamNoWork/);
      assert.match(body, /items/);
      return new Response("", { status: 201 });
    });
    return uploadThunderstoreInPage(mode === "empty-name" ? { ...job, fileName: "" } : job);
  }

  it("puts each part with Content-MD5 from a thunderstore.io document", async () => {
    const { createHash } = await import("node:crypto");
    const sent = await page("ok");
    assert.equal(sent.ok, true);
    holder.fetch = async (url, init) => {
      if (String(url).includes("initiate-upload")) {
        return jsonResponse({ user_media: { uuid: "up" }, upload_urls: [{ url: "https://files.example/p", part_number: 1, offset: 0, length: 1 }] }, 201);
      }
      if (String(url).includes("files.example")) {
        const expected = createHash("md5").update(Buffer.from([97])).digest("base64");
        assert.equal(new Headers(init?.headers).get("content-md5"), expected);
        return new Response(null, { status: 200, headers: { etag: '"abc"' } });
      }
      return new Response("", { status: 204 });
    };
    assert.equal((await uploadThunderstoreInPage(job)).ok, true);
    for (const mode of ["denied", "detail", "message", "error", "plain", "emptyjson", "junk", "badjson", "nouslot", "nopart", "nourl", "nonumber", "put-empty", "put-fail", "finish", "submit"]) {
      const failed = await page(mode);
      assert.equal(failed.ok, false);
    }
    assert.match((await page("throw-fetch")).ok ? "" : (await page("throw-fetch")).message, /storage refused/);
    assert.match((await page("throw-blank")).ok ? "" : (await page("throw-blank")).message, /storage refused/);
    assert.match((await page("put-throw")).ok ? "" : (await page("put-throw")).message, /socket/);
    assert.match((await page("throw-text")).ok ? "" : (await page("throw-text")).message, /storage refused/);
    assert.equal((await page("cap")).ok, true);
    assert.equal((await page("noetag")).ok, true);
    const named = await page("empty-name");
    assert.equal(named.ok, true);
    holder.fetch = previous;
  });

  it("opens a background thunderstore tab when the extension can script the page", async () => {
    const removed: number[] = [];
    const calls: Array<{ url?: string; active?: boolean }> = [];
    const chrome = {
      tabs: {
        create: async (opts: { url: string; active: boolean }) => {
          calls.push(opts);
          return { id: 4 };
        },
        get: async () => ({ id: 4, status: "complete" }),
        remove: async (id: number) => {
          removed.push(id);
        },
      },
      scripting: {
        executeScript: async () => [{ result: { ok: true } }],
      },
    };
    holder.chrome = chrome;
    const ready = { token: "tss", namespace: "LazyTeamNoWork", community: "riskofrain2", categories: "items" };
    const named = await host(async () => {
      throw new Error("extension fetch must not run");
    })("thunderstore", input(ready, { file: new Blob(['{"name": "MyFirstMod"} icon.png README.md manifest.json']) }));
    assert.equal(named.ok && named.url, "https://thunderstore.io/c/riskofrain2/p/LazyTeamNoWork/MyFirstMod/");
    assert.equal(calls[0]?.url, "https://thunderstore.io/");
    assert.equal(calls[0]?.active, false);
    assert.deepEqual(removed, [4]);

    chrome.scripting.executeScript = async () => [{ result: { ok: true } }];
    const unnamed = await host(async () => jsonResponse({}))(
      "thunderstore",
      input({ ...ready, namespace: "" }, { file: pack }),
    );
    assert.equal(unnamed.ok && unnamed.detail, "");
    assert.equal(unnamed.url, undefined);
    const noTitle = await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack, fileName: "" }));
    assert.equal(noTitle.ok && noTitle.url, undefined);

    let stored = "";
    chrome.scripting.executeScript = async (opts: { args?: Array<{ fileName?: string }> }) => {
      stored = opts.args?.[0]?.fileName ?? "";
      return [{ result: { ok: true } }];
    };
    await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: new File([pack], "Kept.zip") }));
    assert.equal(stored, "Kept.zip");
    await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: new File([pack], "  ") }));
    assert.equal(stored, "lanterns.zip");

    chrome.scripting.executeScript = async () => [{ result: { ok: false, message: "bad token" } }];
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /bad token/);
    chrome.scripting.executeScript = async () => [{ result: { ok: false, message: "" } }];
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /rejected the upload/);
    chrome.scripting.executeScript = async () => [];
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /did not answer/);
    chrome.scripting.executeScript = async () => undefined as never;
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /did not answer/);
    chrome.scripting.executeScript = async () => [{}] as never;
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /did not answer/);
    chrome.scripting.executeScript = async () => {
      throw new Error("tabs are blocked");
    };
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /tabs are blocked/);
    chrome.scripting.executeScript = async () => {
      throw new Error("");
    };
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);
    chrome.scripting.executeScript = async () => {
      throw "down";
    };
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);

    chrome.tabs.create = async () => ({});
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);
    chrome.tabs.create = async () => undefined as never;
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);
    chrome.tabs.create = async () => ({ id: 9 });
    delete (chrome.tabs as { remove?: unknown }).remove;
    chrome.scripting.executeScript = async () => [{ result: { ok: true } }];
    assert.equal((await host(async () => jsonResponse({}))("thunderstore", input({ ...ready, namespace: "" }, { file: pack }))).ok, true);

    chrome.tabs.remove = async () => {
      throw new Error("close failed");
    };
    assert.equal((await host(async () => jsonResponse({}))("thunderstore", input({ ...ready, namespace: "" }, { file: pack }))).ok, true);

    delete (chrome.tabs as { create?: unknown }).create;
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);
    (chrome as { tabs?: unknown }).tabs = undefined;
    assert.match((await host(async () => jsonResponse({}))("thunderstore", input(ready, { file: pack }))).message ?? "", /could not open a tab/);
    delete holder.chrome;
  });
});

