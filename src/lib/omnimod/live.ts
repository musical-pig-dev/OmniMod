/**
 * Live host transport. Called only when the extension is built (not the Vite preview).
 * Keys stay on the machine. Each host is called with the fields the user saved under Hosts.
 */

export type PublishFields = Record<string, string>;

export type PublishInput = {
  id: string;
  name?: string;
  version: string;
  changelog?: string;
  file?: File | null;
  fileName?: string;
  fields: PublishFields;
};

export type PublishResult = {
  ok: boolean;
  message: string;
  detail?: string;
};

export type Transport = {
  publish: (input: PublishInput) => Promise<PublishResult>;
};

const NEXUS = "https://api.nexusmods.com/v3";
const CURSE = "https://api.curseforge.com";
const MODRINTH = "https://api.modrinth.com/v2";
const GITHUB = "https://api.github.com";
const THUNDER = "https://thunderstore.io";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataOf(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function errorText(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  const pick = b.description ?? b.detail ?? b.title ?? b.message ?? b.error ?? b.errorMessage;
  if (typeof pick === "string" && pick.trim()) return pick;
  if (pick != null && typeof pick !== "object") return String(pick);
  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return fallback;
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Nexus single-part: create session, PUT with exact Content-Disposition, finalise, poll, create file. */
async function publishNexus(input: PublishInput): Promise<PublishResult> {
  const apiKey = input.fields.apiKey?.trim();
  const modId = input.fields.modId?.trim();
  const file = input.file;
  if (!apiKey || !modId) return { ok: false, message: "Nexus needs an API key and mod ID." };
  if (!file) return { ok: false, message: "Nexus needs the package file." };

  const filename = file.name || input.fileName || "package.zip";
  const headers: Record<string, string> = {
    apikey: apiKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const create = await fetch(`${NEXUS}/uploads`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filename,
      size_bytes: file.size,
    }),
  });
  const created = await readJson(create);
  if (!create.ok) {
    return { ok: false, message: errorText(created, `Nexus create upload failed (${create.status})`) };
  }
  const session = dataOf(created) as { id?: string; presigned_url?: string } | null;
  const uploadId = session?.id;
  const presigned = session?.presigned_url;
  if (!uploadId || !presigned) {
    return { ok: false, message: "Nexus did not return an upload id or presigned URL." };
  }

  // Signed header is Content-Disposition only. Do not let the browser set Content-Type.
  const blob = new Blob([await file.arrayBuffer()]);
  const put = await fetch(presigned, {
    method: "PUT",
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: blob,
  });
  if (!put.ok) {
    const errBody = await put.text();
    return {
      ok: false,
      message: `Nexus storage PUT failed (${put.status}).`,
      detail: errBody.slice(0, 400),
    };
  }

  const finalise = await fetch(`${NEXUS}/uploads/${uploadId}/finalise`, {
    method: "POST",
    headers,
  });
  const finalised = await readJson(finalise);
  if (!finalise.ok) {
    return { ok: false, message: errorText(finalised, `Nexus finalise failed (${finalise.status})`) };
  }

  let ready = false;
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    const check = await fetch(`${NEXUS}/uploads/${uploadId}`, { headers });
    const checked = await readJson(check);
    if (!check.ok) continue;
    const state = (dataOf(checked) as { state?: string } | null)?.state;
    if (state === "available") {
      ready = true;
      break;
    }
  }
  if (!ready) {
    return { ok: false, message: "Nexus upload did not become available in time." };
  }

  const published = await fetch(`${NEXUS}/mod-files`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      upload_id: uploadId,
      mod_id: modId,
      name: filename.replace(/\.[^.]+$/, "") || filename,
      version: input.version,
      description: input.changelog || "",
      file_category: "main",
      allow_mod_manager_download: true,
    }),
  });
  const pubBody = await readJson(published);
  if (!published.ok) {
    return { ok: false, message: errorText(pubBody, `Nexus publish failed (${published.status})`) };
  }
  return { ok: true, message: `Published to Nexus as ${input.version}.` };
}

async function publishCurseForge(input: PublishInput): Promise<PublishResult> {
  const apiKey = input.fields.apiKey?.trim();
  const projectId = input.fields.projectId?.trim();
  const file = input.file;
  if (!apiKey || !projectId) return { ok: false, message: "CurseForge needs an API key and project ID." };
  if (!file) return { ok: false, message: "CurseForge needs the package file." };

  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      changelog: input.changelog || "",
      changelogType: "text",
      displayName: file.name,
      gameVersions: [],
      releaseType: "release",
    }),
  );
  form.append("file", file, file.name);

  const res = await fetch(`${CURSE}/v1/projects/${projectId}/upload-file`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    body: form,
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, message: errorText(body, `CurseForge failed (${res.status})`) };
  return { ok: true, message: `Published to CurseForge as ${input.version}.` };
}

async function publishModrinth(input: PublishInput): Promise<PublishResult> {
  const token = input.fields.token?.trim();
  const projectId = input.fields.projectId?.trim();
  const file = input.file;
  if (!token || !projectId) return { ok: false, message: "Modrinth needs a token and project ID." };
  if (!file) return { ok: false, message: "Modrinth needs the package file." };

  const form = new FormData();
  form.append(
    "data",
    JSON.stringify({
      name: input.version,
      version_number: input.version,
      changelog: input.changelog || "",
      dependencies: [],
      game_versions: [],
      version_type: "release",
      loaders: [],
      featured: false,
      project_id: projectId,
      file_parts: ["file"],
    }),
  );
  form.append("file", file, file.name);

  const res = await fetch(`${MODRINTH}/version`, {
    method: "POST",
    headers: { Authorization: token, Accept: "application/json" },
    body: form,
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, message: errorText(body, `Modrinth failed (${res.status})`) };
  return { ok: true, message: `Published to Modrinth as ${input.version}.` };
}

async function publishGitHub(input: PublishInput): Promise<PublishResult> {
  const token = input.fields.token?.trim();
  const repo = input.fields.repo?.trim();
  const file = input.file;
  if (!token || !repo) return { ok: false, message: "GitHub needs a token and repo (owner/name)." };
  if (!file) return { ok: false, message: "GitHub needs the package file." };

  const tag = input.version.startsWith("v") ? input.version : `v${input.version}`;
  const release = await fetch(`${GITHUB}/repos/${repo}/releases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: input.changelog || "",
      draft: false,
      prerelease: false,
    }),
  });
  const relBody = await readJson(release);
  if (!release.ok) return { ok: false, message: errorText(relBody, `GitHub release failed (${release.status})`) };
  const uploadUrl = (relBody as { upload_url?: string })?.upload_url;
  if (!uploadUrl) return { ok: false, message: "GitHub did not return an upload URL." };

  const assetUrl = uploadUrl.replace(/\{.*\}$/, "") + `?name=${encodeURIComponent(file.name)}`;
  const blob = new Blob([await file.arrayBuffer()]);
  const asset = await fetch(assetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/octet-stream",
    },
    body: blob,
  });
  if (!asset.ok) {
    const err = await asset.text();
    return { ok: false, message: `GitHub asset upload failed (${asset.status}).`, detail: err.slice(0, 400) };
  }
  return { ok: true, message: `Published to GitHub as ${tag}.` };
}

async function publishThunderstore(input: PublishInput): Promise<PublishResult> {
  const token = input.fields.token?.trim() || input.fields.apiKey?.trim();
  const file = input.file;
  if (!token) return { ok: false, message: "Thunderstore needs a token." };
  if (!file) return { ok: false, message: "Thunderstore needs the package file." };

  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${THUNDER}/api/experimental/package/submit/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, message: errorText(body, `Thunderstore failed (${res.status})`) };
  return { ok: true, message: `Published to Thunderstore as ${input.version}.` };
}

export const liveTransport: Transport = {
  async publish(input) {
    if (input.id === "steam") {
      return {
        ok: false,
        message: "Steam Workshop cannot be published from the browser. Use SteamCMD.",
      };
    }
    if (!input.file) {
      return { ok: false, message: "No package file on this publish." };
    }
    switch (input.id) {
      case "nexus":
        return publishNexus(input);
      case "curseforge":
        return publishCurseForge(input);
      case "modrinth":
        return publishModrinth(input);
      case "github":
        return publishGitHub(input);
      case "thunderstore":
        return publishThunderstore(input);
      default:
        return { ok: false, message: `No live publisher for ${input.id}.` };
    }
  },
};

export function selectTransport(override: Transport | undefined, dev: boolean): Transport {
  if (override) return override;
  if (dev) {
    return {
      async publish() {
        return { ok: true, message: "Rehearsal only." };
      },
    };
  }
  return liveTransport;
}