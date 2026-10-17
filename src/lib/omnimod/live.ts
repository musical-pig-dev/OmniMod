import type { PlatformId } from "./catalog.ts";
import {
  curseForgeFilesPage,
  curseForgeFormValues,
  fillCurseForgePage,
  type CurseFillResult,
  type CurseFormFill,
  type Transport,
  type TransportResult,
  type PublishInput,
} from "./publish.ts";
import { studioTransport } from "./storage.ts";
import { completeThunderstoreZip, pngIconFits } from "./zip.ts";

export const OMNIMOD_EXTENSION_ID = "bcaflimdmlindhijdekblbebekkbgegn";

const MODRINTH = "https://api.modrinth.com/v2";
const MODRINTH_AGENT = "OmniMod/0.1";
const NEXUS = "https://api.nexusmods.com/v3";
const NEXUS_POLLS = 8;
const NEXUS_POLL_MS = 1500;
const CURSEFORGE = "https://authors.curseforge.com";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function selectTransport(override?: Transport, dev = import.meta.env.DEV): Transport {
  if (override) return override;
  return dev ? studioTransport() : liveTransport();
}

export function liveTransport(
  fetchImpl: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = sleep,
  curse: CurseTabDriver = chromeCurseDriver(),
): Transport {
  return async (id, input) => {
    if (id === "steam") {
      return { ok: false, message: "Steam Workshop is not available until a later date." };
    }
    if (!input.file) return { ok: false, message: "Choose the package again. It is only kept until you publish." };
    const fields = input.fields ?? {};
    if (id === "curseforge") return publishCurseForge(input, fields, curse);
    if (id === "nexus") return publishNexus(fetchImpl, input, fields, pause);
    if (id === "modrinth") return publishModrinth(fetchImpl, input, fields);
    if (id === "github") return publishGitHub(fetchImpl, input, fields);
    return publishThunderstore(fetchImpl, input, fields);
  };
}

async function publishNexus(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
  pause: (ms: number) => Promise<void>,
): Promise<TransportResult> {
  const file = input.file!;
  const filename = safeNexusName(input.fileName);
  const apiKey = fields.apiKey ?? "";
  const created = await fetchImpl(`${NEXUS}/uploads/multipart`, {
    method: "POST",
    headers: { ...nexusHeaders(apiKey), "content-type": "application/json" },
    body: JSON.stringify({ filename, size_bytes: file.size }),
  });
  if (!created.ok) return { ok: false, message: await errorText(created) };
  const session = dataOf(await created.json());
  const uploadId = String(session.id ?? "");
  const listed = session.part_presigned_urls;
  const parts = Array.isArray(listed) ? listed.map((part) => String(part)) : [];
  const completeUrl = String(session.complete_presigned_url ?? "");
  const partSize = Number(session.part_size_bytes) || file.size;
  if (!uploadId || parts.length === 0 || !completeUrl) {
    return { ok: false, message: "Nexus did not return an upload slot." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const etags: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const start = index * partSize;
    const chunk = bytes.subarray(start, Math.min(start + partSize, bytes.length));
    const put = await fetchImpl(parts[index], {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(chunk.length),
      },
      body: chunk,
    });
    if (!put.ok) return { ok: false, message: await errorText(put) };
    etags.push((put.headers.get("etag") ?? "").replace(/"/g, ""));
  }
  const xml = `<CompleteMultipartUpload>\n${etags
    .map((etag, index) => `  <Part>\n    <PartNumber>${index + 1}</PartNumber>\n    <ETag>${etag}</ETag>\n  </Part>`)
    .join("\n")}\n</CompleteMultipartUpload>`;
  const completed = await fetchImpl(completeUrl, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: xml,
  });
  if (!completed.ok) return { ok: false, message: await errorText(completed) };
  const finalised = await fetchImpl(`${NEXUS}/uploads/${uploadId}/finalise`, {
    method: "POST",
    headers: nexusHeaders(apiKey),
  });
  if (!finalised.ok) return { ok: false, message: await errorText(finalised) };
  const ready = await waitForNexus(fetchImpl, uploadId, fields.apiKey ?? "", pause);
  if (!ready.ok) return ready;
  const game = (fields.gameDomain ?? "").trim();
  const scoped = (fields.modId ?? "").trim();
  if (!game || !scoped) {
    return { ok: false, message: "Nexus needs the game domain and mod ID from the mod URL." };
  }
  const looked = await fetchImpl(`${NEXUS}/games/${encodeURIComponent(game)}/mods/${encodeURIComponent(scoped)}`, {
    headers: nexusHeaders(apiKey),
  });
  if (!looked.ok) return { ok: false, message: await errorText(looked) };
  const internalId = String(dataOf(await looked.json()).id ?? "");
  if (!internalId) return { ok: false, message: "Nexus mod lookup returned no id." };
  const published = await fetchImpl(`${NEXUS}/mod-files`, {
    method: "POST",
    headers: { ...nexusHeaders(fields.apiKey ?? ""), "content-type": "application/json" },
    body: JSON.stringify({
      upload_id: uploadId,
      mod_id: internalId,
      name: filename,
      version: input.version.trim(),
      description: input.changelog.trim(),
      file_category: "main",
      update_mod_version: true,
    }),
  });
  if (!published.ok) return { ok: false, message: await errorText(published) };
  return {
    ok: true,
    url: `https://www.nexusmods.com/${encodeURIComponent(game)}/mods/${encodeURIComponent(scoped)}`,
  };
}

async function waitForNexus(
  fetchImpl: typeof fetch,
  id: string,
  apiKey: string,
  pause: (ms: number) => Promise<void>,
): Promise<TransportResult> {
  for (let attempt = 0; attempt < NEXUS_POLLS; attempt += 1) {
    const response = await fetchImpl(`${NEXUS}/uploads/${id}`, { headers: nexusHeaders(apiKey) });
    if (!response.ok) return { ok: false, message: await errorText(response) };
    const state = String(dataOf(await response.json()).state ?? "");
    if (state === "available") return { ok: true };
    if (attempt < NEXUS_POLLS - 1) await pause(NEXUS_POLL_MS);
  }
  return { ok: false, message: "Nexus has not finished processing the upload." };
}

function nexusHeaders(apiKey: string): Record<string, string> {
  return { apikey: apiKey, authorization: `Bearer ${apiKey}`, accept: "application/json" };
}

function safeNexusName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9 _'().-]+/g, " ").trim().slice(0, 50);
  return cleaned || "package.zip";
}

async function publishModrinth(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const token = (fields.token ?? "").trim();
  const project = (fields.project ?? "").trim();
  let projectId = project;
  if (project) {
    const looked = await fetchImpl(`${MODRINTH}/project/${encodeURIComponent(project)}`, {
      headers: modrinthHeaders(token),
    });
    if (!looked.ok) return { ok: false, message: await errorText(looked) };
    const data = dataOf(await looked.json());
    projectId = String(data.id ?? "");
    if (!projectId) return { ok: false, message: "Modrinth project lookup returned no id." };
    const mismatch = modrinthFile(String(data.project_type ?? ""), input.fileName);
    if (mismatch) return { ok: false, message: mismatch };
  }
  const body = new FormData();
  body.set(
    "data",
    JSON.stringify({
      name: input.version.trim(),
      version_number: input.version.trim(),
      changelog: input.changelog.trim(),
      dependencies: [],
      game_versions: splitList(fields.gameVersions),
      version_type: "release",
      loaders: splitList(fields.loaders),
      featured: false,
      status: "listed",
      project_id: projectId,
      file_parts: ["file"],
      primary_file: "file",
    }),
  );
  body.set("file", input.file!, input.fileName);
  const response = await fetchImpl(`${MODRINTH}/version`, {
    method: "POST",
    headers: modrinthHeaders(token),
    body,
  });
  if (!response.ok) return { ok: false, message: await errorText(response) };
  if (!project) return { ok: true };
  return { ok: true, url: `https://modrinth.com/mod/${encodeURIComponent(project)}/versions` };
}

function modrinthHeaders(token: string): Record<string, string> {
  return { authorization: token, "user-agent": MODRINTH_AGENT, accept: "application/json" };
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function modrinthFile(projectType: string, fileName: string): string | null {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  if (projectType === "mod" && ext !== ".jar") {
    return "This Modrinth project is a mod. It needs a .jar with fabric.mod.json or mods.toml.";
  }
  if (projectType === "modpack" && ext !== ".mrpack") {
    return "This Modrinth project is a modpack. It needs a .mrpack file.";
  }
  if ((projectType === "resourcepack" || projectType === "datapack" || projectType === "shader") && ext !== ".zip") {
    return `This Modrinth project is a ${projectType}. It needs a .zip file.`;
  }
  return null;
}

async function publishGitHub(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const repo = (fields.repo ?? "").trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return { ok: false, message: "Repository must look like owner/name." };
  const token = (fields.token ?? "").trim();
  const created = await fetchImpl(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tag_name: input.version.trim(),
      name: input.version.trim(),
      body: input.changelog.trim(),
    }),
  });
  if (!created.ok) return { ok: false, message: await errorText(created) };
  const release = (await created.json()) as { upload_url?: string };
  const uploadUrl = String(release.upload_url ?? "").replace(
    "{?name,label}",
    `?name=${encodeURIComponent(input.fileName)}`,
  );
  if (!uploadUrl) return { ok: false, message: "GitHub did not return an upload URL." };
  const asset = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/octet-stream",
    },
    body: input.file,
  });
  if (!asset.ok) return { ok: false, message: await errorText(asset) };
  return { ok: true, url: `https://github.com/${repo}/releases` };
}

export type ThunderstorePageJob = {
  token: string;
  team: string;
  community: string;
  categories: string[];
  fileName: string;
  bytes: number[];
};

export type ThunderstorePageResult = { ok: true; message?: string } | { ok: false; message: string };

/** Runs inside a thunderstore.io tab. That origin is the only one their API allows. */
export async function uploadThunderstoreInPage(job: ThunderstorePageJob): Promise<ThunderstorePageResult> {
  function md5(input: Uint8Array): Uint8Array {
    const shift = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
      20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
      10, 15, 21,
    ];
    const sine = new Uint32Array(64);
    for (let index = 0; index < 64; index += 1) sine[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000);
    let length = input.length + 1;
    while (length % 64 !== 56) length += 1;
    const padded = new Uint8Array(length + 8);
    padded.set(input);
    padded[input.length] = 0x80;
    const view = new DataView(padded.buffer);
    const bits = input.length * 8;
    view.setUint32(padded.length - 8, bits >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const words = new Uint32Array(16);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, true);
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let index = 0; index < 64; index += 1) {
        let mixed = 0;
        let source = 0;
        if (index < 16) {
          mixed = (b & c) | (~b & d);
          source = index;
        } else if (index < 32) {
          mixed = (d & b) | (~d & c);
          source = (5 * index + 1) % 16;
        } else if (index < 48) {
          mixed = b ^ c ^ d;
          source = (3 * index + 5) % 16;
        } else {
          mixed = c ^ (b | ~d);
          source = (7 * index) % 16;
        }
        mixed = (mixed + a + sine[index] + words[source]) >>> 0;
        a = d;
        d = c;
        c = b;
        b = (b + ((mixed << shift[index]) | (mixed >>> (32 - shift[index])))) >>> 0;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    const digest = new Uint8Array(16);
    const state = [a0, b0, c0, d0];
    for (let index = 0; index < 4; index += 1) {
      digest[index * 4] = state[index] & 0xff;
      digest[index * 4 + 1] = (state[index] >>> 8) & 0xff;
      digest[index * 4 + 2] = (state[index] >>> 16) & 0xff;
      digest[index * 4 + 3] = (state[index] >>> 24) & 0xff;
    }
    return digest;
  }

  function contentMd5(chunk: Uint8Array): string {
    let binary = "";
    const digest = md5(chunk);
    for (const byte of digest) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function readError(response: Response): Promise<string> {
    const text = (await response.text()).trim();
    if (!text) return `Thunderstore returned HTTP ${response.status}.`;
    try {
      const body = JSON.parse(text) as { detail?: string; message?: string; error?: string };
      return body.detail || body.message || body.error || text.slice(0, 280);
    } catch {
      return text.slice(0, 280);
    }
  }

  try {
    const bytes = new Uint8Array(job.bytes);
    const headers = { authorization: `Bearer ${job.token}`, accept: "application/json", "content-type": "application/json" };
    const started = await fetch("https://thunderstore.io/api/experimental/usermedia/initiate-upload/", {
      method: "POST",
      headers,
      body: JSON.stringify({ filename: job.fileName || "package.zip", file_size_bytes: bytes.length }),
    });
    if (!started.ok) return { ok: false, message: await readError(started) };
    let session: { user_media?: { uuid?: string }; upload_urls?: Array<Record<string, unknown>> };
    try {
      session = (await started.json()) as typeof session;
    } catch {
      return { ok: false, message: "Thunderstore did not return an upload slot." };
    }
    const uuid = String(session.user_media?.uuid ?? "");
    const parts = Array.isArray(session.upload_urls) ? session.upload_urls : [];
    if (!uuid || parts.length === 0) return { ok: false, message: "Thunderstore did not return an upload slot." };
    const completed: { PartNumber: number; ETag: string }[] = [];
    for (const part of parts) {
      const url = String(part.url ?? "");
      const number = Number(part.part_number ?? part.PartNumber ?? 0);
      const offset = Number(part.offset ?? 0);
      const length = Number(part.length ?? bytes.length);
      if (!url || !number) return { ok: false, message: "Thunderstore did not return an upload slot." };
      const chunk = bytes.subarray(offset, Math.min(offset + length, bytes.length));
      const put = await fetch(url, { method: "PUT", headers: { "Content-MD5": contentMd5(chunk) }, body: chunk });
      if (!put.ok) return { ok: false, message: await readError(put) };
      completed.push({ PartNumber: number, ETag: (put.headers.get("etag") ?? "").replace(/"/g, "") });
    }
    const finished = await fetch(`https://thunderstore.io/api/experimental/usermedia/${uuid}/finish-upload/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ parts: completed }),
    });
    if (!finished.ok) return { ok: false, message: await readError(finished) };
    const submitted = await fetch("https://thunderstore.io/api/experimental/submission/submit/", {
      method: "POST",
      headers,
      body: JSON.stringify({
        upload_uuid: uuid,
        author_name: job.team,
        communities: [job.community],
        community_categories: { [job.community]: job.categories },
        has_nsfw_content: false,
      }),
    });
    if (!submitted.ok) return { ok: false, message: await readError(submitted) };
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "Failed to fetch";
    return { ok: false, message: detail === "Failed to fetch" ? "Thunderstore storage refused the upload." : detail };
  }
}

async function publishThunderstore(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const file = input.file!;
  const iconField = (fields.icon ?? "").trim();
  const icon = configuredIcon(iconField);
  if (iconField && !icon) return { ok: false, message: "Thunderstore icon must be a PNG no larger than 256×256." };
  const packed = completeThunderstoreZip(new Uint8Array(await file.arrayBuffer()), input, icon) ?? file;
  const missing = await thunderstorePackage(packed);
  if (missing) return { ok: false, message: missing };
  const token = (fields.token ?? "").trim();
  const team = (fields.namespace ?? "").trim();
  const community = (fields.community ?? "").trim();
  if (!community) return { ok: false, message: "Thunderstore needs a community slug." };
  const bytes = new Uint8Array(await packed.arrayBuffer());
  if (typeof chromeApi()?.scripting?.executeScript === "function") {
    const storedName = packed instanceof File && packed.name.trim() ? packed.name.trim() : input.fileName || "package.zip";
    const uploaded = await publishThunderstoreFromTab({
      token,
      team,
      community,
      categories: splitList(fields.categories),
      fileName: storedName,
      bytes: Array.from(bytes),
    });
    if (!uploaded.ok) return { ok: false, message: uploaded.message || "Thunderstore rejected the upload." };
    const named = packageName(new TextDecoder("latin1").decode(bytes));
    if (!team || !named) return { ok: true, detail: team };
    return {
      ok: true,
      detail: team,
      url: `https://thunderstore.io/c/${encodeURIComponent(community)}/p/${encodeURIComponent(team)}/${encodeURIComponent(named)}/`,
    };
  }
  const started = await fetchImpl("https://thunderstore.io/api/experimental/usermedia/initiate-upload/", {
    method: "POST",
    headers: thunderstoreHeaders(token),
    body: JSON.stringify({ filename: input.fileName || "package.zip", file_size_bytes: packed.size }),
  });
  if (!started.ok) return { ok: false, message: await errorText(started) };
  let session: { user_media?: { uuid?: string }; upload_urls?: Array<Record<string, unknown>> };
  try {
    session = (await started.json()) as typeof session;
  } catch {
    return { ok: false, message: "Thunderstore did not return an upload slot." };
  }
  const uuid = String(session.user_media?.uuid ?? "");
  const parts = Array.isArray(session.upload_urls) ? session.upload_urls : [];
  if (!uuid || parts.length === 0) return { ok: false, message: "Thunderstore did not return an upload slot." };
  const completed: { PartNumber: number; ETag: string }[] = [];
  for (const part of parts) {
    const url = String(part.url ?? "");
    const number = Number(part.part_number ?? part.PartNumber ?? 0);
    const offset = Number(part.offset ?? 0);
    const length = Number(part.length ?? bytes.length);
    if (!url || !number) return { ok: false, message: "Thunderstore did not return an upload slot." };
    const chunk = bytes.subarray(offset, Math.min(offset + length, bytes.length));
    const put = await fetchImpl(url, { method: "PUT", body: chunk });
    if (!put.ok) return { ok: false, message: await errorText(put) };
    completed.push({ PartNumber: number, ETag: (put.headers.get("etag") ?? "").replace(/"/g, "") });
  }
  const finished = await fetchImpl(`https://thunderstore.io/api/experimental/usermedia/${uuid}/finish-upload/`, {
    method: "POST",
    headers: thunderstoreHeaders(token),
    body: JSON.stringify({ parts: completed }),
  });
  if (!finished.ok) return { ok: false, message: await errorText(finished) };
  const categories = splitList(fields.categories);
  const submitted = await fetchImpl("https://thunderstore.io/api/experimental/submission/submit/", {
    method: "POST",
    headers: thunderstoreHeaders(token),
    body: JSON.stringify({
      upload_uuid: uuid,
      author_name: team,
      communities: [community],
      community_categories: { [community]: categories },
      has_nsfw_content: false,
    }),
  });
  if (!submitted.ok) return { ok: false, message: await errorText(submitted) };
  const named = packageName(new TextDecoder("latin1").decode(bytes));
  if (!team || !named) return { ok: true, detail: team };
  return {
    ok: true,
    detail: team,
    url: `https://thunderstore.io/c/${encodeURIComponent(community)}/p/${encodeURIComponent(team)}/${encodeURIComponent(named)}/`,
  };
}

const THUNDERSTORE_ROOT = ["icon.png", "README.md", "manifest.json"];

function configuredIcon(value: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]*)$/.exec(value.trim());
  if (!match?.[1]) return null;
  let binary = "";
  try {
    binary = atob(match[1]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return pngIconFits(bytes) ? bytes : null;
}

function packageName(text: string): string {
  const found = text.match(/"name"\s*:\s*"([^"\\]+)"/);
  return found ? found[1].trim() : "";
}

async function thunderstorePackage(file: Blob): Promise<string | null> {
  const text = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
  const missing = THUNDERSTORE_ROOT.filter((name) => !text.includes(name));
  if (missing.length === 0) return null;
  return `Thunderstore package needs ${missing.join(", ")} at the zip root.`;
}

function thunderstoreHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" };
}

function dataOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return record.data as Record<string, unknown>;
  return record;
}

async function errorText(response: Response): Promise<string> {
  return hostMessage((await response.text()).trim(), response.status);
}

async function publishCurseForge(
  input: PublishInput,
  fields: Record<string, string>,
  curse: CurseTabDriver,
): Promise<TransportResult> {
  const projectId = (fields.projectId ?? "").trim();
  if (!projectId) return { ok: false, message: "CurseForge needs a project id." };
  const values = curseForgeFormValues({
    changelog: input.changelog,
    host: fields,
    override: input.override,
  });
  if (values.versions.length === 0) {
    return { ok: false, message: "CurseForge needs a game version on the host key." };
  }
  const file = input.file!;
  const fill: CurseFormFill = {
    ...values,
    fileName: input.fileName,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    mime: file.type,
    waitMs: 12000,
    stepMs: 50,
  };
  const url = `${CURSEFORGE}/#/projects/${encodeURIComponent(projectId)}/files/create`;
  if (curse.fromExtension && typeof chromeApi()?.scripting?.executeScript !== "function") {
    return askInstalledExtension(url, fill);
  }
  let tabId: number | null = null;
  try {
    tabId = await curse.open(url);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "The tab could not be opened.";
    return {
      ok: false,
      message: `CurseForge could not open the form tab. ${detail}`,
      step: "tab",
      reason: detail,
      logs: [detail],
    };
  }
  if (tabId == null) {
    return {
      ok: false,
      message: "CurseForge could not open the form tab.",
      step: "tab",
      reason: "no tab id",
      logs: ["tabs.create returned no tab"],
    };
  }
  let result: CurseFillResult;
  try {
    result = await curse.run(tabId, fill);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "The form script threw.";
    return {
      ok: false,
      message: `CurseForge form could not be filled. ${detail} The tab was left open.`,
      step: "scripting",
      reason: detail,
      logs: ["opened the form tab", `exception: ${detail}`],
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      ...(result.step ? { step: result.step } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.filled && result.filled.length > 0 ? { filled: result.filled } : {}),
      logs: ["opened the form tab", ...(result.logs ?? [])],
    };
  }
  const view = curseForgeFilesPage(projectId);
  if (!view || !result.url.trim()) return { ok: false, message: "CurseForge did not show the uploaded file. The tab was left open." };
  try {
    await curse.close(tabId);
  } catch {
    return { ok: true, url: view };
  }
  return { ok: true, url: view };
}

type ChromeTab = { id?: number; status?: string; url?: string };

type ChromeApi = {
  runtime?: {
    lastError?: { message?: string };
    sendMessage?: (message: { type: string; url: string }) => Promise<{ id?: number | null; error?: string }>;
  };
  tabs?: {
    create?: (opts: { url: string; active: boolean }) => Promise<ChromeTab>;
    query?: (opts: { url: string }) => Promise<ChromeTab[]>;
    update?: (id: number, opts: { url: string; active: boolean }) => Promise<ChromeTab>;
    get?: (id: number) => Promise<ChromeTab>;
    remove?: (id: number) => Promise<void>;
  };
  scripting?: {
    executeScript?: (opts: {
      target: { tabId: number };
      func: (fill: CurseFormFill) => Promise<CurseFillResult>;
      args: [CurseFormFill];
    }) => Promise<Array<{ result?: CurseFillResult }>>;
  };
};

export type CurseTabDriver = {
  fromExtension?: boolean;
  open(url: string): Promise<number | null>;
  run(tabId: number, fill: CurseFormFill): Promise<CurseFillResult>;
  close(tabId: number): Promise<void>;
};

function chromeApi(): ChromeApi | null {
  return (globalThis as { chrome?: ChromeApi }).chrome ?? null;
}

async function publishThunderstoreFromTab(job: ThunderstorePageJob): Promise<ThunderstorePageResult> {
  const api = chromeApi() as ChromeApi;
  const tabs = api.tabs;
  if (!tabs || typeof tabs.create !== "function") return { ok: false, message: "Thunderstore could not open a tab." };
  let tabId: number | null = null;
  const finish = async (result: ThunderstorePageResult): Promise<ThunderstorePageResult> => {
    if (tabId != null && typeof tabs.remove === "function") {
      try {
        await tabs.remove(tabId);
      } catch {
        /* the request already finished */
      }
    }
    return result;
  };
  try {
    const tab = await tabs.create({ url: "https://thunderstore.io/", active: false });
    if (tab?.id == null) return finish({ ok: false, message: "Thunderstore could not open a tab." });
    tabId = tab.id;
    await waitUntilReady(api, tabId);
    const execute = api.scripting!.executeScript!;
    const packed = await execute({ target: { tabId }, world: "MAIN", func: uploadThunderstoreInPage, args: [job] });
    const result = packed?.[0]?.result;
    if (!result || typeof result.ok !== "boolean") return finish({ ok: false, message: "Thunderstore did not answer." });
    return finish(result);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "The tab could not be opened.";
    return finish({ ok: false, message: `Thunderstore could not open a tab. ${detail}` });
  }
}

async function waitUntilReady(api: ChromeApi, id: number): Promise<void> {
  const get = api.tabs?.get;
  if (typeof get !== "function") return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let tab: ChromeTab | undefined;
    try {
      tab = await get(id);
    } catch {
      return;
    }
    if (tab?.status !== "loading") return;
    await sleep(25);
  }
}

function askInstalledExtension(url: string, fill: CurseFormFill): Promise<TransportResult> {
  const runtime = (globalThis as {
    chrome?: { runtime?: { sendMessage?: (...args: unknown[]) => void; lastError?: { message?: string } } };
  }).chrome?.runtime;
  if (typeof runtime?.sendMessage !== "function") {
    return Promise.resolve({
      ok: false,
      message: "npm run dev cannot open a Chrome tab. Load the unpacked OmniMod extension, then publish again from this page.",
      step: "tab",
      reason: "no extension",
      logs: ["npm run dev has no chrome.tabs"],
    });
  }
  return new Promise((resolve) => {
    runtime.sendMessage!(OMNIMOD_EXTENSION_ID, { type: "omnimod-curse-fill", url, fill }, (reply: CurseFillResult | undefined) => {
      const reason = runtime.lastError?.message;
      if (reason) {
        resolve({
          ok: false,
          message: `CurseForge could not open the form tab. ${reason}`,
          step: "tab",
          reason,
          logs: [reason],
        });
        return;
      }
      if (!reply || typeof reply.ok !== "boolean") {
        resolve({
          ok: false,
          message: "CurseForge could not open the form tab.",
          step: "tab",
          reason: "no reply",
          logs: ["extension returned nothing"],
        });
        return;
      }
      if (!reply.ok) {
        resolve({
          ok: false,
          message: reply.message,
          ...(reply.step ? { step: reply.step } : {}),
          ...(reply.reason ? { reason: reply.reason } : {}),
          ...(reply.filled && reply.filled.length > 0 ? { filled: reply.filled } : {}),
          logs: reply.logs,
        });
        return;
      }
      const view = reply.url.trim();
      if (!view) {
        resolve({ ok: false, message: "CurseForge did not show the uploaded file. The tab was left open." });
        return;
      }
      const project = decodeURIComponent(url.split("/projects/")[1].split("/")[0]);
      resolve({ ok: true, url: `https://authors.curseforge.com/#/projects/${project}/files` });
    });
  });
}

async function shownTab(api: ChromeApi, url: string): Promise<number | null> {
  const tabs = api.tabs;
  const existing = typeof tabs?.query === "function" ? await tabs.query({ url: "https://authors.curseforge.com/*" }) : [];
  const reuse = existing.find((tab) => tab.id != null);
  if (reuse?.id != null && typeof tabs?.update === "function") {
    await tabs.update(reuse.id, { url, active: false });
    await waitUntilReady(api, reuse.id);
    return reuse.id;
  }
  if (typeof tabs?.create !== "function") return null;
  const tab = await tabs.create({ url, active: false });
  if (tab?.id == null) return null;
  await waitUntilReady(api, tab.id);
  return tab.id;
}

async function openFromBackground(url: string): Promise<number | null> {
  const send = chromeApi()?.runtime?.sendMessage;
  if (typeof send !== "function") return null;
  const reply = await send({ type: "omnimod-open-tab", url });
  if (reply?.error) throw new Error(reply.error);
  return reply?.id ?? null;
}

export function chromeCurseDriver(): CurseTabDriver {
  return {
    fromExtension: true,
    async open(url) {
      const api = chromeApi();
      if (api) {
        try {
          const id = await shownTab(api, url);
          if (id != null) return id;
        } catch (error) {
          const id = await openFromBackground(url);
          if (id != null) return id;
          throw error;
        }
      }
      return openFromBackground(url);
    },
    async run(tabId, fill) {
      const execute = chromeApi()?.scripting?.executeScript;
      if (typeof execute !== "function") {
        return {
          ok: false,
          message: "CurseForge form could not be filled. The tab was left open.",
          step: "scripting",
          reason: "scripting is not available",
          logs: ["scripting.executeScript is missing"],
        };
      }
      const packed = await execute({ target: { tabId }, func: fillCurseForgePage, args: [fill] });
      const result = packed?.[0]?.result;
      if (!result || typeof result.ok !== "boolean") {
        return {
          ok: false,
          message: "CurseForge form could not be filled. The tab was left open.",
          step: "scripting",
          reason: "the form script returned nothing",
          logs: ["scripting.executeScript returned no result"],
        };
      }
      return result;
    },
    async close(tabId) {
      const remove = chromeApi()?.tabs?.remove;
      if (typeof remove !== "function") throw new Error("CurseForge tab could not be closed.");
      await remove(tabId);
    },
  };
}

function hostMessage(text: string, status: number): string {
  if (!text) return `The host returned HTTP ${status}.`;
  try {
    const body = JSON.parse(text) as {
      description?: string;
      detail?: string;
      title?: string;
      message?: string;
      error?: string;
      errorMessage?: string;
    };
    if (!body || typeof body !== "object") return text.slice(0, 280);
    return (
      body.description ||
      body.detail ||
      body.title ||
      body.message ||
      body.error ||
      body.errorMessage ||
      text.slice(0, 280)
    );
  } catch {
    return text.slice(0, 280);
  }
}

export function liveHost(id: PlatformId): string {
  if (id === "nexus") return NEXUS;
  if (id === "curseforge") return CURSEFORGE;
  if (id === "modrinth") return "https://api.modrinth.com";
  if (id === "github") return "https://api.github.com";
  return "https://thunderstore.io";
}
