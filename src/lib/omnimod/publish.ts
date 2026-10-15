import {
  PLATFORMS,
  type ConfigMap,
  type PlatformId,
  isConfigured,
  platformById,
  typeBlock,
} from "./catalog.ts";

export type PublishInput = {
  fileName: string;
  version: string;
  changelog: string;
  override?: Record<string, string>;
  file?: Blob | null;
  fields?: Record<string, string>;
};

export type SiteStatus = "skipped" | "success" | "error";

export type SiteResult = {
  id: PlatformId;
  status: SiteStatus;
  message: string;
  url?: string;
};

export type TransportResult = { ok: true; detail?: string; url?: string } | { ok: false; message: string };

export type Transport = (
  id: PlatformId,
  input: PublishInput,
) => Promise<TransportResult>;

export type SkipReason = "disabled" | "missing-credentials" | "no-package" | "later" | "type";

export type PlanEntry =
  | { id: PlatformId; action: "publish" }
  | { id: PlatformId; action: "skip"; reason: Exclude<SkipReason, "type"> }
  | { id: PlatformId; action: "skip"; reason: "type"; detail: string };

export function planPublish(configs: ConfigMap, input: PublishInput): PlanEntry[] {
  const hasPackage = input.fileName.trim().length > 0;
  return PLATFORMS.map((platform) => {
    const config = configs[platform.id];
    if (platform.later) return { id: platform.id, action: "skip", reason: "later" };
    if (!config.enabled) return { id: platform.id, action: "skip", reason: "disabled" };
    const blocked = typeBlock(platform, configs, input.fileName);
    if (blocked) return { id: platform.id, action: "skip", reason: "type", detail: blocked };
    if (!isConfigured(platform, config)) {
      return { id: platform.id, action: "skip", reason: "missing-credentials" };
    }
    if (!hasPackage) return { id: platform.id, action: "skip", reason: "no-package" };
    return { id: platform.id, action: "publish" };
  });
}

export function readyCount(configs: ConfigMap, input: PublishInput): number {
  return planPublish(configs, input).filter((entry) => entry.action === "publish").length;
}

function skipMessage(entry: Extract<PlanEntry, { action: "skip" }>, name: string): string {
  if (entry.reason === "disabled") return `${name} is turned off.`;
  if (entry.reason === "later") return `${name} is not available until a later date.`;
  if (entry.reason === "no-package") return `No package selected, so ${name} was not contacted.`;
  if (entry.reason === "type") return `${name}: ${entry.detail}`;
  return `${name} needs account details. Left alone.`;
}

function successMessage(id: PlatformId, input: PublishInput): string {
  const name = platformById(id).name;
  const version = input.version.trim() || "unversioned";
  const note = input.changelog.trim() ? "" : " No changelog was attached.";
  return `${name} accepted ${version}.${note}`;
}

export type PublishProgress = {
  completed: number;
  total: number;
  current: PlatformId | null;
};

export async function runPublish(args: {
  input: PublishInput;
  configs: ConfigMap;
  transport: Transport;
  file?: Blob | null;
  onProgress?: (progress: PublishProgress) => void;
}): Promise<SiteResult[]> {
  const plan = planPublish(args.configs, args.input);
  const results: SiteResult[] = [];
  const queued = plan.filter((entry) => entry.action === "publish");
  let completed = 0;
  args.onProgress?.({
    completed,
    total: queued.length,
    current: queued[0]?.id ?? null,
  });

  for (const entry of plan) {
    const name = platformById(entry.id).name;
    if (entry.action === "skip") {
      results.push({
        id: entry.id,
        status: "skipped",
        message: skipMessage(entry, name),
      });
      continue;
    }

    try {
      args.onProgress?.({ completed, total: queued.length, current: entry.id });
      const response = await args.transport(entry.id, {
        ...args.input,
        file: args.file ?? args.input.file ?? null,
        fields: args.configs[entry.id].fields,
      });
      if (response.ok) {
        const extra = response.detail ? ` ${response.detail}` : "";
        const url = response.url?.trim() ?? "";
        results.push({
          id: entry.id,
          status: "success",
          message: `${successMessage(entry.id, args.input)}${extra}`,
          ...(url ? { url } : {}),
        });
      } else {
        results.push({
          id: entry.id,
          status: "error",
          message: response.message || `${name} rejected the upload.`,
        });
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : "Request failed.";
      results.push({
        id: entry.id,
        status: "error",
        message: `${name}: ${detail}`,
      });
    }
    completed += 1;
    args.onProgress?.({
      completed,
      total: queued.length,
      current: queued[completed]?.id ?? null,
    });
  }

  return results;
}

const PRACTICE: Record<string, string> = {
  apiKey: "practice-nexus-key",
  token: "practice-token",
  modId: "104822",
  gameDomain: "skyrimspecialedition",
  projectId: "88211",
  project: "weathered-lanterns",
  gameVersions: "1.20.1",
  loaders: "fabric",
  repo: "studio/weathered-lanterns",
  namespace: "Studio",
  community: "riskofrain2",
  appId: "480",
  itemId: "2904410021",
  releaseType: "release",
  publishWhen: "auto",
  changelogType: "markdown",
  displayName: "Weathered Lanterns",
  relations: "jei:requiredDependency",
};

export function practiceValue(key: string): string {
  return PRACTICE[key] ?? "practice";
}

export function practiceFields(id: PlatformId): Record<string, string> {
  const platform = platformById(id);
  const fields: Record<string, string> = {};
  for (const field of platform.fields) fields[field.key] = practiceValue(field.key);
  return fields;
}

const RELATION_TYPE_ID: Record<string, number> = {
  embeddedLibrary: 1,
  optionalDependency: 2,
  requiredDependency: 3,
  tool: 4,
  incompatible: 5,
};

/** Authors form: release 1, beta 2, alpha 3. HTML/WYSIWYG is changelog type 1. */
const RELEASE_TYPE_ID: Record<string, number> = { release: 1, beta: 2, alpha: 3 };
const CHANGELOG_TYPE_ID: Record<string, number> = { html: 1, text: 2, markdown: 3 };

export type CurseRelation = { slug: string; type: number } | { projectId: number; type: number };

export type CurseForgeFileBody = {
  addedProjectRelations: CurseRelation[];
  changelog: string;
  changelogType: number;
  displayName: string;
  fileLength: number;
  fileName: string;
  gameVersionIds: number[];
  includeDefaultProjectRelations: true;
  releaseType: number;
  isMarkedForManualRelease?: true;
};

export type CurseForgeDraft = {
  body: CurseForgeFileBody;
  pendingNames: string[];
  versionRaw: string;
};

export type CurseGameVersion = { id: number; name: string; slug: string };

export type CurseForgeTab = { open: boolean; active: false; closeOnSuccess: boolean };

function written(value: string | undefined): string {
  return (value ?? "").trim();
}

function prefer(override: string | undefined, host: string | undefined, fallback = ""): string {
  return written(override) || written(host) || fallback;
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function numericId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
}

export function parseCurseRelations(raw: string): CurseRelation[] {
  const projects: CurseRelation[] = [];
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const colon = piece.indexOf(":");
    const typeName = piece.slice(colon + 1).trim();
    const type = RELATION_TYPE_ID[typeName];
    if (colon <= 0 || type == null) continue;
    const name = piece.slice(0, colon).trim();
    const projectId = numericId(name);
    if (projectId != null) projects.push({ projectId, type });
    else projects.push({ slug: name, type });
  }
  return projects;
}

function curseDefault(key: string): string {
  const field = platformById("curseforge").fields.find((item) => item.key === key);
  return field!.defaultValue!;
}

function curseChangelog(value: string, type: number): string {
  const text = value.trim();
  if (type !== 1 || !text || /<[a-z][\s\S]*>/i.test(text)) return text;
  const safe = text.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
  return `<p>${safe}</p>`;
}

function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const next: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function curseForgeFileBody(args: {
  changelog: string;
  fileName: string;
  fileLength: number;
  host: Record<string, string | undefined>;
  override?: Record<string, string | undefined>;
}): CurseForgeDraft {
  const over = args.override ?? {};
  const host = args.host;
  const versionRaw = prefer(over.gameVersions, host.gameVersions);
  const ids: number[] = [];
  const pendingNames: string[] = [];
  for (const part of commaList(versionRaw)) {
    const id = numericId(part);
    if (id == null) pendingNames.push(part);
    else ids.push(id);
  }
  const changelogType = CHANGELOG_TYPE_ID[prefer(undefined, host.changelogType, curseDefault("changelogType"))] ?? 1;
  const fileName = args.fileName.trim();
  const body: CurseForgeFileBody = {
    addedProjectRelations: parseCurseRelations(prefer(over.relations, host.relations)),
    changelog: curseChangelog(args.changelog, changelogType),
    changelogType,
    displayName: prefer(over.displayName, host.displayName) || fileName,
    fileLength: args.fileLength,
    fileName,
    gameVersionIds: uniqueIds(ids),
    includeDefaultProjectRelations: true,
    releaseType: RELEASE_TYPE_ID[prefer(over.releaseType, host.releaseType, curseDefault("releaseType"))] ?? 1,
  };
  if (prefer(over.publishWhen, host.publishWhen, curseDefault("publishWhen")) === "manual") {
    body.isMarkedForManualRelease = true;
  }
  return { body, pendingNames, versionRaw };
}

export function curseVersionCatalog(payload: unknown): CurseGameVersion[] | null {
  const rows = versionRows(payload);
  if (!rows) return null;
  const versions: CurseGameVersion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    versions.push({ id, name: String(record.name ?? ""), slug: String(record.slug ?? "") });
  }
  return versions;
}

function versionRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (record.data && typeof record.data === "object") {
    const data = record.data as Record<string, unknown>;
    if (Array.isArray(data.gameVersions)) return data.gameVersions;
    if (Array.isArray(data.versions)) return data.versions;
  }
  if (Array.isArray(record.gameVersions)) return record.gameVersions;
  return null;
}

export function resolveCurseVersionIds(
  raw: string,
  catalog: CurseGameVersion[] | null,
): { ok: true; ids: number[] } | { ok: false; message: string } {
  const ids: number[] = [];
  const names: string[] = [];
  for (const part of commaList(raw)) {
    const id = numericId(part);
    if (id == null) names.push(part);
    else ids.push(id);
  }
  if (ids.length === 0 && names.length === 0) {
    return { ok: false, message: "CurseForge needs a game version id." };
  }
  if (names.length === 0) return { ok: true, ids: uniqueIds(ids) };
  if (!catalog) return { ok: false, message: "CurseForge did not list game versions. Enter the version id." };
  const resolved = [...ids];
  for (const name of names) {
    const key = name.toLowerCase();
    const hits = catalog.filter((version) => version.name.toLowerCase() === key || version.slug.toLowerCase() === key);
    if (hits.length === 0) {
      return { ok: false, message: `CurseForge has no game version named ${name}. Enter the version id.` };
    }
    if (hits.length > 1) {
      return { ok: false, message: `Game version ${name} matches more than one id. Enter the id.` };
    }
    resolved.push(hits[0]!.id);
  }
  return { ok: true, ids: uniqueIds(resolved) };
}

export function curseForgeViewUrl(args: { fileId?: string; slug?: string; projectId?: string }): string | null {
  const fileId = (args.fileId ?? "").trim();
  if (!fileId) return null;
  const slug = (args.slug ?? "").trim();
  if (slug) {
    return `https://www.curseforge.com/projects/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`;
  }
  const projectId = (args.projectId ?? "").trim();
  if (!projectId) return null;
  return `https://authors.curseforge.com/#/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
}

/** Silent upload. A background tab opens only when the page holds a document token, and it closes only after a clean success. */
export function curseForgeTab(needsDocumentToken: boolean): CurseForgeTab {
  if (!needsDocumentToken) return { open: false, active: false, closeOnSuccess: false };
  return { open: true, active: false, closeOnSuccess: true };
}

export function curseForgeDocumentToken(status: number, body: string, contentType = ""): boolean {
  const text = body.trim().toLowerCase();
  const html = contentType.toLowerCase().includes("text/html") || text.startsWith("<!doctype") || text.startsWith("<html");
  if (html) return true;
  if (status !== 401 && status !== 403) return false;
  return text.includes("token") || text.includes("login") || text.includes("antiforgery");
}
