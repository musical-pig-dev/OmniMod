import type { PlatformId } from "./catalog.ts";
import type { PublishInput, Transport, TransportResult } from "./publish.ts";
import { studioTransport } from "./storage.ts";

const NEXUS = "https://api.nexusmods.com/v3";
const NEXUS_SINGLE_PART = 100 * 1024 * 1024;
const NEXUS_POLLS = 8;
const NEXUS_POLL_MS = 1500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function selectTransport(override?: Transport, dev = import.meta.env.DEV): Transport {
  if (override) return override;
  return dev ? studioTransport() : liveTransport();
}

export function liveTransport(fetchImpl: typeof fetch = fetch, pause: (ms: number) => Promise<void> = sleep): Transport {
  return async (id, input) => {
    if (id === "steam") {
      return { ok: false, message: "Steam Workshop has no browser upload API. Use SteamCMD." };
    }
    if (!input.file) return { ok: false, message: "Choose the package again. It is only kept until you publish." };
    const fields = input.fields ?? {};
    if (id === "nexus") return publishNexus(fetchImpl, input, fields, pause);
    if (id === "curseforge") return publishCurseForge(fetchImpl, input, fields);
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
  if (file.size > NEXUS_SINGLE_PART) {
    return { ok: false, message: "Nexus single-part upload stops at 100 MiB." };
  }
  const filename = safeNexusName(input.fileName);
  const created = await fetchImpl(`${NEXUS}/uploads`, {
    method: "POST",
    headers: { ...nexusHeaders(fields.apiKey ?? ""), "content-type": "application/json" },
    body: JSON.stringify({ size_bytes: file.size, filename }),
  });
  if (!created.ok) return { ok: false, message: await errorText(created) };
  const session = dataOf(await created.json());
  const uploadId = String(session.id ?? "");
  const target = String(session.presigned_url ?? "");
  if (!uploadId || !target) return { ok: false, message: "Nexus did not return an upload slot." };
  const put = await fetchImpl(target, {
    method: "PUT",
    headers: { "content-disposition": `attachment; filename="${filename}"` },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!put.ok) return { ok: false, message: await errorText(put) };
  const finalised = await fetchImpl(`${NEXUS}/uploads/${uploadId}/finalise`, {
    method: "POST",
    headers: nexusHeaders(fields.apiKey ?? ""),
  });
  if (!finalised.ok) return { ok: false, message: await errorText(finalised) };
  const ready = await waitForNexus(fetchImpl, uploadId, fields.apiKey ?? "", pause);
  if (!ready.ok) return ready;
  const published = await fetchImpl(`${NEXUS}/mod-files`, {
    method: "POST",
    headers: { ...nexusHeaders(fields.apiKey ?? ""), "content-type": "application/json" },
    body: JSON.stringify({
      upload_id: uploadId,
      mod_id: (fields.modId ?? "").trim(),
      name: filename,
      version: input.version.trim(),
      description: input.changelog.trim(),
      file_category: "main",
      update_mod_version: true,
    }),
  });
  if (!published.ok) return { ok: false, message: await errorText(published) };
  return { ok: true };
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

async function publishCurseForge(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const body = new FormData();
  body.set(
    "metadata",
    JSON.stringify({
      changelog: input.changelog.trim(),
      changelogType: "markdown",
      displayName: input.fileName,
      releaseType: "release",
    }),
  );
  body.set("file", input.file!, input.fileName);
  const response = await fetchImpl(
    `https://upload.curseforge.com/api/projects/${encodeURIComponent((fields.projectId ?? "").trim())}/upload-file`,
    { method: "POST", headers: { "x-api-token": (fields.token ?? "").trim() }, body },
  );
  if (!response.ok) return { ok: false, message: await errorText(response) };
  return { ok: true };
}

async function publishModrinth(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const body = new FormData();
  body.set(
    "data",
    JSON.stringify({
      name: input.version.trim(),
      version_number: input.version.trim(),
      changelog: input.changelog.trim(),
      dependencies: [],
      game_versions: [],
      version_type: "release",
      loaders: [],
      featured: false,
      status: "listed",
      project_id: (fields.project ?? "").trim(),
      file_parts: ["file"],
      primary_file: "file",
    }),
  );
  body.set("file", input.file!, input.fileName);
  const response = await fetchImpl("https://api.modrinth.com/v2/version", {
    method: "POST",
    headers: { authorization: (fields.token ?? "").trim() },
    body,
  });
  if (!response.ok) return { ok: false, message: await errorText(response) };
  return { ok: true };
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
  return { ok: true };
}

async function publishThunderstore(
  fetchImpl: typeof fetch,
  input: PublishInput,
  fields: Record<string, string>,
): Promise<TransportResult> {
  const body = new FormData();
  body.set("file", input.file!, input.fileName);
  const response = await fetchImpl("https://thunderstore.io/api/experimental/package/submit/", {
    method: "POST",
    headers: { authorization: `Bearer ${(fields.token ?? "").trim()}` },
    body,
  });
  if (!response.ok) return { ok: false, message: await errorText(response) };
  return { ok: true, detail: (fields.namespace ?? "").trim() };
}

function dataOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return record.data as Record<string, unknown>;
  return record;
}

async function errorText(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  if (!text) return `The host returned HTTP ${response.status}.`;
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
  if (id === "curseforge") return "https://upload.curseforge.com";
  if (id === "modrinth") return "https://api.modrinth.com";
  if (id === "github") return "https://api.github.com";
  return "https://thunderstore.io";
}
