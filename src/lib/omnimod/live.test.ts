import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { liveHost, liveTransport, selectTransport, sleep } from "./live.ts";
import type { PublishInput, Transport } from "./publish.ts";

const file = new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" });
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
      if (target.endsWith("/mod-files")) return jsonResponse({ data: { id: "file-1" } }, 201);
      if (target.includes("upload.curseforge.com")) return jsonResponse({ id: 9 });
      if (target.includes("api.modrinth.com")) return jsonResponse({ id: "ver" }, 200);
      if (target.includes("api.github.com") && init?.method === "POST") {
        return jsonResponse({ upload_url: "https://uploads.github.com/repos/a/b/releases/1/assets{?name,label}" });
      }
      if (target.includes("uploads.github.com")) return jsonResponse({ id: 3 }, 201);
      if (target.includes("thunderstore.io")) return new Response("", { status: 204 });
      return jsonResponse({ message: "no" }, 500);
    };
    const transport = host(fetchImpl);
    assert.equal((await transport("nexus", input({ apiKey: "k", modId: "12" }, { fileName: "bad [name].zip" }))).ok, true);
    assert.equal((await transport("nexus", input(undefined, { fileName: "###" }))).ok, true);
    assert.equal((await transport("curseforge", input({ token: "t", projectId: "9" }))).ok, true);
    assert.equal((await transport("curseforge", input({}))).ok, true);
    assert.equal((await transport("modrinth", input({ token: "mrp", project: "lanterns" }))).ok, true);
    assert.equal((await transport("modrinth", input({}))).ok, true);
    assert.equal((await transport("github", input({ token: "gh", repo: "studio/mod" }))).ok, true);
    assert.equal((await transport("github", input({ repo: "studio/mod" }))).ok, true);
    const thunder = await transport("thunderstore", input({ token: "tss", namespace: "Team" }));
    assert.equal(thunder.ok && thunder.detail, "Team");
    const unnamed = await transport("thunderstore", input({}));
    assert.equal(unnamed.ok && unnamed.detail, "");
    assert.ok(forms.includes("file,metadata"));
    assert.ok(forms.includes("data,file"));
    assert.ok(forms.includes("file"));
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
    assert.match((await transport("thunderstore", input({ token: "t", namespace: "Team" }))).message ?? "", /game version/);
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
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }, { fileName: "   " }))).message ?? "", /uuid/);
    mode.value = "nullbody";
    assert.match((await transport("nexus", input({ apiKey: "k", modId: "1" }))).message ?? "", /upload slot/);
    mode.value = "nourl";
    assert.match((await transport("github", input({ token: "t", repo: "a/b" }))).message ?? "", /upload URL/);
    mode.value = "ts";
    const quietResult = await transport("thunderstore", input({ token: "t" }));
    assert.equal(quietResult.ok && quietResult.detail, "");
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
});
