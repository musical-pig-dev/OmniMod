import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { liveHost, liveTransport, selectTransport, sleep } from "./live.ts";
import type { PublishInput, Transport } from "./publish.ts";

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
    assert.equal((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "12" }, { fileName: "bad [name].zip" }))).ok, true);
    assert.match(posted[0] ?? "", /"mod_id":"internal-12"/);
    assert.equal((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "12" }, { fileName: "###" }))).ok, true);
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "12" }))).message ?? "", /game domain/);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "site" }))).message ?? "", /game domain/);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "site", modId: "missing" }))).message ?? "", /no id/);
    assert.equal((await transport("nexus", input({ gameDomain: "site", modId: "12" }))).ok, true);
    assert.match((await transport("nexus", input({ apiKey: "k", gameDomain: "gone", modId: "12" }))).message ?? "", /mod not found/);
    assert.match((await transport("curseforge", input({ projectId: "9" }))).message ?? "", /game version/);
    assert.match((await transport("curseforge", input({}))).message ?? "", /project id/);
    assert.equal((await transport("modrinth", input({ token: "mrp", project: "lanterns" }))).ok, true);
    assert.equal((await transport("modrinth", input({}))).ok, true);
    assert.ok(calls.some((call) => call.startsWith("GET https://api.modrinth.com/v2/project/lanterns")));
    assert.equal((await transport("github", input({ token: "gh", repo: "studio/mod" }))).ok, true);
    assert.equal((await transport("github", input({ repo: "studio/mod" }))).ok, true);
    const thunder = await transport(
      "thunderstore",
      input({ token: "tss", namespace: "Team", community: "riskofrain2" }, { file: pack }),
    );
    assert.equal(thunder.ok && thunder.detail, "Team");
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
  });
});

describe("curseforge session upload", () => {
  const versions = { data: [{ id: 17045, name: "26.3", slug: "26-3" }, { id: 9, name: "Other", slug: "fabric" }] };

  function chromeStub(create: (opts: { url: string; active: boolean }) => Promise<unknown> | unknown) {
    (globalThis as { chrome?: unknown }).chrome = { tabs: { create } };
  }

  function clearChrome() {
    delete (globalThis as { chrome?: unknown }).chrome;
  }

  it("posts the live body, then the chunk, and returns the file link", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const creds: Array<RequestCredentials | undefined> = [];
    const keys: string[] = [];
    const mode = { value: "ok" };
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      calls.push(`${init?.method ?? "GET"} ${target}`);
      creds.push(init?.credentials);
      const headers = new Headers(init?.headers);
      keys.push(headers.get("x-api-key") ?? "");
      if (init?.body && !(init.body instanceof FormData)) bodies.push(String(init.body));
      if (target.endsWith("/game-versions")) {
        if (mode.value === "lookup-fail") return jsonResponse({ message: "signed out" }, 401);
        if (mode.value === "lookup-text") return new Response("nope", { status: 200 });
        if (mode.value === "lookup-shape") return jsonResponse({ nope: true });
        if (mode.value === "lookup-empty") return jsonResponse({ data: [] });
        if (mode.value === "lookup-ambiguous") {
          return jsonResponse({ data: [{ id: 1, name: "26.3" }, { id: 2, slug: "26.3" }] });
        }
        return jsonResponse(versions);
      }
      if (target.endsWith("/upload-file-details")) {
        if (mode.value === "wall") return new Response("<html>login</html>", { status: 401, headers: { "content-type": "text/html" } });
        if (mode.value === "wall-json") return jsonResponse({ error: "token" }, 403);
        if (mode.value === "denied") return jsonResponse({ message: "versions required" }, 400);
        if (mode.value === "empty-detail") return new Response(" ", { status: 200, headers: { "content-type": "" } });
        if (mode.value === "bad-detail") return new Response("not-json", { status: 200 });
        if (mode.value === "no-upload") return jsonResponse({ data: {} });
        if (mode.value === "slug") return jsonResponse({ data: { uploadId: "up-1", fileId: 9172385, slug: "simple mod" } });
        if (mode.value === "no-file") return jsonResponse({ data: { uploadId: "up-1" } });
        if (mode.value === "blank-id") return jsonResponse({ data: { uploadId: "up-1", fileId: " " } });
        return jsonResponse({ data: { uploadId: "up-1", fileId: 9172385 } });
      }
      if (target.endsWith("/upload-file-chunk")) {
        if (init?.body instanceof FormData) {
          bodies.push(
            ["chunkedUploadId", "chunkIndex", "totalChunks", "file"]
              .map((key) => `${key}=${String(init.body instanceof FormData ? init.body.get(key) : "")}`)
              .join("&"),
          );
        }
        if (mode.value === "chunk-fail") return jsonResponse({ message: "chunk rejected" }, 400);
        if (mode.value === "chunk-false") return jsonResponse({ data: false });
        if (mode.value === "chunk-text") return new Response("nope", { status: 200 });
        if (mode.value === "chunk-null") return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
        if (mode.value === "chunk-raw") return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
        return jsonResponse({ data: true });
      }
      return jsonResponse({ message: "no" }, 500);
    };
    const transport = host(fetchImpl);
    const sent = await transport(
      "curseforge",
      input({ projectId: "1744552", gameVersions: "17045", releaseType: "release", changelogType: "html" }),
    );
    assert.equal(sent.ok && sent.url, "https://authors.curseforge.com/#/projects/1744552/files/9172385");
    assert.ok(calls.some((call) => call === "POST https://authors.curseforge.com/_api/project-files/1744552/upload-file-details"));
    assert.ok(calls.some((call) => call.endsWith("/upload-file-chunk")));
    assert.ok(!calls.some((call) => call.includes("game-versions")));
    assert.ok(creds.every((item) => item === "include"));
    assert.ok(keys.every((item) => item === ""));
    const posted = JSON.parse(bodies[0] ?? "{}") as { gameVersionIds: number[]; changelogType: number; releaseType: number; changelog: string };
    assert.deepEqual(posted.gameVersionIds, [17045]);
    assert.equal(posted.changelogType, 1);
    assert.equal(posted.releaseType, 1);
    assert.equal(posted.changelog, "<p>Glass.</p>");
    assert.equal("isMarkedForManualRelease" in posted, false);
    assert.match(bodies.find((body) => body.startsWith("chunkedUploadId")) ?? "", /chunkedUploadId=up-1&chunkIndex=1&totalChunks=1/);

    const named = await transport(
      "curseforge",
      input(
        { projectId: "1744552", gameVersions: "1.20.1", publishWhen: "auto" },
        { override: { gameVersions: "26.3", displayName: "Sample", publishWhen: "manual", releaseType: "alpha" } },
      ),
    );
    assert.equal(named.ok, true);
    const namedBody = JSON.parse(bodies.filter((body) => body.startsWith("{")).at(-1) ?? "{}") as {
      gameVersionIds: number[];
      displayName: string;
      releaseType: number;
      isMarkedForManualRelease?: boolean;
    };
    assert.deepEqual(namedBody.gameVersionIds, [17045]);
    assert.equal(namedBody.displayName, "Sample");
    assert.equal(namedBody.releaseType, 3);
    assert.equal(namedBody.isMarkedForManualRelease, true);

    mode.value = "slug";
    const linked = await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }));
    assert.equal(linked.ok && linked.url, "https://www.curseforge.com/projects/simple%20mod/files/9172385");
    mode.value = "no-file";
    const quiet = await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }));
    assert.equal(quiet.ok, true);
    assert.equal(quiet.ok && quiet.url, undefined);
    mode.value = "blank-id";
    const blankId = await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }));
    assert.equal(blankId.ok, true);
    assert.equal(blankId.ok && blankId.url, undefined);
    mode.value = "chunk-raw";
    assert.equal((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).ok, true);

    mode.value = "lookup-fail";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).message ?? "", /signed out/);
    mode.value = "lookup-text";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).message ?? "", /did not list/);
    mode.value = "lookup-shape";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).message ?? "", /did not list/);
    mode.value = "lookup-empty";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).message ?? "", /no game version named/);
    mode.value = "lookup-ambiguous";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "26.3" }))).message ?? "", /more than one/);
    mode.value = "ok";
    const fabric = await transport("curseforge", input({ projectId: "1744552", gameVersions: "fabric" }));
    assert.equal(fabric.ok, true);

    mode.value = "denied";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /versions required/);
    mode.value = "empty-detail";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not return an upload/);
    mode.value = "bad-detail";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not return an upload/);
    mode.value = "no-upload";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not return an upload/);
    mode.value = "chunk-fail";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /chunk rejected/);
    mode.value = "chunk-false";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not accept/);
    mode.value = "chunk-text";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not accept/);
    mode.value = "chunk-null";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /did not accept/);

    mode.value = "wall";
    chromeStub(async (opts) => {
      assert.equal(opts.active, false);
      assert.match(opts.url, /1744552\/files\/create/);
      return { id: 7 };
    });
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /background tab/);
    clearChrome();
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /Sign in/);
    chromeStub(() => {
      throw new Error("blocked");
    });
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /Sign in/);
    (globalThis as { chrome?: unknown }).chrome = { tabs: {} };
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /Sign in/);
    clearChrome();
    mode.value = "wall-json";
    assert.match((await transport("curseforge", input({ projectId: "1744552", gameVersions: "17045" }))).message ?? "", /Sign in/);
  });
});

