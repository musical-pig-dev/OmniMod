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
    assert.equal(liveHost("curseforge"), "https://upload.curseforge.com");
    assert.equal(liveHost("modrinth"), "https://api.modrinth.com");
    assert.equal(liveHost("github"), "https://api.github.com");
    assert.equal(liveHost("thunderstore"), "https://thunderstore.io");
    assert.equal(liveHost("steam"), "https://thunderstore.io");
    assert.equal((await liveTransport()("steam", input())).ok, false);
    await sleep(0);
  });

  it("refuses steam and a missing package", async () => {
    const transport = host(async () => jsonResponse({}));
    assert.match((await transport("steam", input({}))).message ?? "", /SteamCMD/);
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
    assert.equal((await transport("curseforge", input({ token: "t", projectId: "9" }))).ok, true);
    assert.equal((await transport("curseforge", input({}))).ok, true);
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
    assert.ok(forms.includes("file,metadata"));
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
    assert.match((await transport("curseforge", input({ token: "t", projectId: "1" }))).message ?? "", /422/);
    mode.value = "plain";
    assert.match((await transport("modrinth", input({ token: "t", project: "p" }))).message ?? "", /not-json/);
    mode.value = "detail";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /archived/);
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /archived/);
    assert.match((await transport("github", input({ token: "t", repo: "nope" }))).message ?? "", /owner\/name/);
    assert.match((await transport("github", input({ token: "t" }))).message ?? "", /owner\/name/);
    mode.value = "title";
    assert.match((await transport("curseforge", input({ token: "t", projectId: "1" }))).message ?? "", /Unprocessable/);
    mode.value = "message";
    assert.match(
      (await transport("thunderstore", input({ token: "t", namespace: "Team", community: "riskofrain2" }, { file: pack }))).message ?? "",
      /game version/,
    );
    mode.value = "error";
    assert.match((await transport("curseforge", input({ token: "t", projectId: "1" }))).message ?? "", /unauthorized/);
    mode.value = "cf";
    assert.match((await transport("curseforge", input({ token: "t", projectId: "1" }))).message ?? "", /versions required/);
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
});
