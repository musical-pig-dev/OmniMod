import {
  PLATFORMS,
  hostTakesOne,
  type ConfigMap,
  type PlatformId,
  isConfigured,
  platformById,
  fileExtension,
  typeBlock,
} from "./catalog.ts";

export type PublishInput = {
  fileName: string;
  version: string;
  changelog: string;
  override?: Record<string, string>;
  file?: Blob | null;
  fields?: Record<string, string>;
  autoZip?: boolean;
  zipName?: string;
};

export type SiteStatus = "skipped" | "success" | "error";

export type SiteResult = {
  id: PlatformId;
  status: SiteStatus;
  message: string;
  url?: string;
  step?: string;
  reason?: string;
  filled?: string[];
  file?: string;
  config?: Record<string, string>;
};

export type TransportResult =
  | { ok: true; detail?: string; url?: string }
  | { ok: false; message: string; step?: string; reason?: string; filled?: string[] };

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
    const blocked = typeBlock(platform, configs, input.fileName, Boolean(input.autoZip));
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

export function publicHostConfig(
  id: PlatformId,
  fields: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!fields) return undefined;
  const secrets = new Set(platformById(id).fields.filter((field) => field.secret).map((field) => field.key));
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!value.trim() || secrets.has(key) || /token|key|secret|password|cookie/i.test(key)) continue;
    config[key] = value;
  }
  return Object.keys(config).length ? config : undefined;
}

export function failureSignature(result: Pick<SiteResult, "id" | "step" | "reason" | "message">): string {
  const reason = (result.reason || result.message).replace(/\s+/g, " ").trim().toLowerCase();
  return `${result.id}|${result.step || "host"}|${reason}`;
}

export function ticketTitle(name: string, result: SiteResult): string {
  const short = result.step && result.reason ? result.reason : result.message;
  return `${name}: ${short}`;
}

export function ticketBody(result: SiteResult): string {
  const platform = platformById(result.id);
  const lines = [
    "## Failure",
    "",
    `- **Host:** ${platform.name}`,
    `- **Lane:** ${platform.lane}`,
    ...(result.step ? [`- **Step:** ${result.step}`] : []),
    ...(result.reason ? [`- **Reason:** ${result.reason}`] : []),
    ...(result.file ? [`- **File:** ${result.file}`] : []),
    `- **Time:** ${new Date().toISOString()}`,
  ];
  if (result.filled?.length) {
    lines.push("", "## Filled", "", ...result.filled.map((item) => `- ${item}`));
  }
  if (result.config && Object.keys(result.config).length) {
    lines.push("", "## Config", "");
    for (const [key, value] of Object.entries(result.config)) {
      const label = platform.fields.find((field) => field.key === key)?.label ?? key;
      lines.push(`- ${label}: ${value}`);
    }
  }
  const note =
    platform.lane === "bot"
      ? "The tab was left open. Partial fill is visible on the form."
      : platform.lane === "later"
        ? "This host is not implemented yet."
        : "";
  if (note) lines.push("", "## Notes", "", note);
  if (!result.step && !result.reason) lines.push("", result.message);
  return lines.join("\n");
}

export function ticketHref(title: string, body: string, host: string): string {
  const params = new URLSearchParams({ title, body, labels: `bug,form-filler,${host}` });
  return `https://github.com/musical-pig-dev/OmniMod/issues/new?${params.toString()}`;
}

const TICKET_KEY = "omnimod.tickets";

export function loadTickets(storage: Pick<Storage, "getItem"> = localStorage): Record<string, string> {
  try {
    const raw = storage.getItem(TICKET_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const saved: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.startsWith("https://github.com/")) saved[key] = value;
    }
    return saved;
  } catch {
    return {};
  }
}

export function saveTicket(
  signature: string,
  url: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const next = { ...loadTickets(storage), [signature]: url };
  storage.setItem(TICKET_KEY, JSON.stringify(next));
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
  failed?: number;
};

function preferZip(zip: Blob | null, file: Blob | null): Blob | null {
  return zip ?? file;
}

export function deliveryFile(
  id: PlatformId,
  input: PublishInput,
  file: Blob | null,
  zip: Blob | null,
  sources: { name: string; blob: Blob }[],
): Blob | null {
  if (!input.autoZip || sources.length === 0) return file;
  const accepts = platformById(id).accepts;
  const first = sources[0];
  if (id === "curseforge" && fileExtension(first.name) !== ".zip") return preferZip(zip, file);
  if (sources.length > 1 && hostTakesOne(id)) return preferZip(zip, file);
  const ext = fileExtension(first.name);
  if (!accepts || accepts.includes(ext)) return first.blob;
  if (accepts.includes(".zip")) return preferZip(zip, file);
  return file;
}

export function failureFacts(id: PlatformId, input: PublishInput, configs: ConfigMap) {
  const config = publicHostConfig(id, configs[id]?.fields);
  return {
    ...(input.fileName.trim() ? { file: input.fileName } : {}),
    ...(config ? { config } : {}),
  };
}

export async function runPublish(args: {
  input: PublishInput;
  configs: ConfigMap;
  transport: Transport;
  file?: Blob | null;
  zip?: Blob | null;
  sources?: { name: string; blob: Blob }[];
  onProgress?: (progress: PublishProgress) => void;
}): Promise<SiteResult[]> {
  const plan = planPublish(args.configs, args.input);
  const results: SiteResult[] = [];
  const queued = plan.filter((entry) => entry.action === "publish");
  let completed = 0;
  let failed = 0;
  args.onProgress?.({
    completed,
    total: queued.length,
    current: queued[0]?.id ?? null,
    failed,
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
      args.onProgress?.({ completed, total: queued.length, current: entry.id, failed });
      const response = await args.transport(entry.id, {
        ...args.input,
        file: deliveryFile(entry.id, args.input, args.file ?? args.input.file ?? null, args.zip ?? null, args.sources ?? []),
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
        failed += 1;
        results.push({
          id: entry.id,
          status: "error",
          message: response.message || `${name} rejected the upload.`,
          ...(response.step ? { step: response.step } : {}),
          ...(response.reason ? { reason: response.reason } : {}),
          ...(response.filled && response.filled.length > 0 ? { filled: response.filled } : {}),
          ...failureFacts(entry.id, args.input, args.configs),
        });
      }
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error && error.message ? error.message : "Request failed.";
      results.push({
        id: entry.id,
        status: "error",
        message: `${name}: ${detail}`,
        ...failureFacts(entry.id, args.input, args.configs),
      });
    }
    completed += 1;
    args.onProgress?.({
      completed,
      total: queued.length,
      current: queued[completed]?.id ?? null,
      failed,
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

export type CurseFormValues = {
  displayName: string;
  manual: boolean;
  versions: string[];
  releaseType: string;
  code: boolean;
  relations: string[];
  changelog: string;
};

export type CurseFormFill = CurseFormValues & {
  fileName: string;
  bytes: number[];
  mime: string;
  waitMs: number;
  stepMs: number;
};

export type CurseFillResult =
  | { ok: true; url: string }
  | { ok: false; message: string; step?: string; reason?: string; filled?: string[] };

const CURSE_AUTO = "Publish this file automatically once approved";
const CURSE_MANUAL = "I would like to publish this file manually once approved";

/** Field values for the authors form. A non-blank override wins. Names stay names. */
export function curseForgeFormValues(args: {
  changelog: string;
  host: Record<string, string | undefined>;
  override?: Record<string, string | undefined>;
}): CurseFormValues {
  const over = args.override ?? {};
  const host = args.host;
  const releaseKey = prefer(over.releaseType, host.releaseType, curseDefault("releaseType")).toLowerCase();
  const changelogKey = prefer(over.changelogType, host.changelogType, curseDefault("changelogType")).toLowerCase();
  const relations = parseCurseRelations(prefer(over.relations, host.relations)).map((item) =>
    "slug" in item ? item.slug : String(item.projectId),
  );
  return {
    displayName: prefer(over.displayName, host.displayName),
    manual: prefer(over.publishWhen, host.publishWhen, curseDefault("publishWhen")) === "manual",
    versions: commaList(prefer(over.gameVersions, host.gameVersions)),
    releaseType: releaseKey === "beta" ? "Beta" : releaseKey === "alpha" ? "Alpha" : "Release",
    code: changelogKey === "text" || changelogKey === "markdown",
    relations,
    changelog: args.changelog.trim(),
  };
}

/**
 * Fill the authors Upload New File form. Self-contained so the extension can
 * run this function inside the CurseForge tab. No _api calls.
 */
export async function fillCurseForgePage(fill: CurseFormFill): Promise<CurseFillResult> {
  const doc = document;
  const waitMs = fill.waitMs;
  const stepMs = fill.stepMs;

  function plain(node: Node): string {
    return (node.textContent as string).replace(/\s+/g, " ").trim();
  }

  function hrefOf(): string {
    return doc.location.href;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function isLogin(): boolean {
    if (/login|signin/i.test(hrefOf())) return true;
    return /sign in/i.test(plain(doc.body)) && doc.querySelector("input[type='file']") == null;
  }

  function buttonNamed(label: string): HTMLButtonElement | null {
    const wanted = label.toLowerCase();
    for (const button of doc.querySelectorAll("button")) {
      const text = plain(button).toLowerCase();
      const aria = (button.getAttribute("aria-label") ?? "").toLowerCase();
      if (text === wanted || text.includes(wanted) || aria.includes(wanted)) return button;
    }
    return null;
  }

  function heading(name: string): Element | null {
    const wanted = name.toLowerCase();
    const node = [...doc.querySelectorAll("label, legend, p, span, h2, h3")].find((item) => {
      const text = plain(item).toLowerCase();
      return text === wanted || text.startsWith(`${wanted} `) || text.startsWith(`${wanted}*`);
    });
    return node as Element;
  }

  function namedText(node: Element): string {
    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) text += child.textContent as string;
    }
    return text.replace(/\s+/g, " ").replace("*", "").trim().toLowerCase();
  }

  function textInput(scope: ParentNode): HTMLInputElement | null {
    for (const item of scope.querySelectorAll("input")) {
      if (item instanceof HTMLInputElement && item.type !== "radio" && item.type !== "file") return item;
    }
    return null;
  }

  function radioNamed(label: string): HTMLInputElement | null {
    const wanted = label.toLowerCase();
    for (const node of doc.querySelectorAll("label")) {
      if (!plain(node).toLowerCase().includes(wanted)) continue;
      const nested = node.querySelector("input[type='radio']");
      if (nested instanceof HTMLInputElement) return nested;
      const linked = node.getAttribute("for");
      const byId = linked ? doc.getElementById(linked) : null;
      if (byId instanceof HTMLInputElement && byId.type === "radio") return byId;
      const prev = node.previousElementSibling;
      if (prev instanceof HTMLInputElement && prev.type === "radio") return prev;
    }
    return null;
  }

  function fieldInput(label: string): HTMLInputElement | null {
    const wanted = label.toLowerCase();
    for (const node of doc.querySelectorAll("label, span, p, div")) {
      if (namedText(node) !== wanted) continue;
      let scope: Element | null = node;
      while (scope && scope !== doc.body) {
        const near = textInput(scope);
        if (near) return near;
        scope = scope.parentElement;
      }
    }
    return null;
  }

  function scopeOf(node: Element): Element {
    const form = node.closest(".MuiFormControl-root");
    if (form) return form;
    const parent = node.parentElement;
    if (parent && parent !== doc.body) return parent;
    return node;
  }

  function modeCombobox(): HTMLElement | null {
    const scopes: ParentNode[] = [];
    const label = heading("Changelog");
    if (label) scopes.push(scopeOf(label));
    scopes.push(doc);
    for (const scope of scopes) {
      for (const node of scope.querySelectorAll("[role='combobox']")) {
        const text = plain(node).toLowerCase();
        if (text === "wysiwyg" || text === "markdown") return node as HTMLElement;
      }
    }
    return null;
  }

  function writeTiny(html: string): boolean {
    const api = (doc.defaultView as { tinymce?: { get: (id: string) => { setContent: (value: string) => void } | null } }).tinymce;
    const hidden = doc.querySelector("textarea[id^='tiny-react']");
    if (api && hidden instanceof HTMLTextAreaElement) {
      const editor = api.get(hidden.id);
      if (editor) {
        editor.setContent(html);
        return true;
      }
    }
    const frame = doc.querySelector("iframe.tox-edit-area__iframe");
    if (!(frame instanceof HTMLIFrameElement)) return false;
    const inner = frame.contentDocument;
    if (!inner || !inner.body) return false;
    const body = inner.body;
    if (/<[a-z][\s\S]*>/i.test(html)) body.innerHTML = html;
    else body.textContent = html;
    body.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  async function pickMode(wanted: string): Promise<boolean> {
    const box = modeCombobox();
    if (!box) return false;
    if (plain(box).toLowerCase() === wanted) return true;
    box.click();
    let picked: HTMLElement | null = null;
    await waitFor(() => {
      const option = [...doc.querySelectorAll("[role='option'], li")].find((node) => plain(node).toLowerCase() === wanted);
      if (option instanceof HTMLElement) {
        picked = option;
        return true;
      }
      return false;
    });
    if (!picked) return false;
    picked.click();
    return true;
  }

  function writeControl(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const owner = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(owner, "value")?.set as (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function placeFile(input: HTMLInputElement, file: File): void {
    const view = input.ownerDocument.defaultView as { DataTransfer?: new () => DataTransfer } | null;
    const Transfer = view?.DataTransfer;
    if (typeof Transfer === "function") {
      try {
        const transfer = new Transfer();
        transfer.items.add(file);
        if (transfer.files?.length) {
          input.files = transfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      } catch {
        /* the property fallback below still sets the file */
      }
    }
    Object.defineProperty(input, "files", {
      configurable: true,
      value: { 0: file, length: 1 },
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitFor(ready: () => boolean): Promise<boolean> {
    const started = Date.now();
    let found = ready();
    while (!found && Date.now() - started < waitMs) {
      await delay(stepMs);
      found = ready();
    }
    return found;
  }

  const filled: string[] = [];

  function miss(step: string, reason: string, message: string): CurseFillResult {
    return { ok: false, message, step, reason, ...(filled.length > 0 ? { filled: filled.slice() } : {}) };
  }

  function concealed(node: Element): boolean {
    let current: Element | null = node;
    while (current && current !== doc.body) {
      if ((current as HTMLElement).style.display === "none") return true;
      current = current.parentElement;
    }
    return false;
  }

  let fileInput: HTMLInputElement | null = null;
  const ready = await waitFor(() => {
    if (isLogin()) return true;
    const found = doc.querySelector("input.dzu-input[type='file'], input[type='file']");
    if (found) fileInput = found as HTMLInputElement;
    return fileInput != null || isLogin();
  });
  if (!ready || isLogin()) {
    return miss(
      "form",
      !ready ? "form did not load" : "needs a sign-in",
      !ready
        ? "CurseForge form did not load. The tab was left open."
        : "CurseForge needs a sign-in. The form tab was left open.",
    );
  }
  if (fill.fileName && !fill.fileName.endsWith(".zip")) {
    return miss("file", "form accepts .zip only", "CurseForge form accepts .zip only. The tab was left open.");
  }
  if (fill.versions.length === 0) {
    return miss("versions", "needs a game version", "CurseForge needs a game version on the host key.");
  }

  placeFile(fileInput as HTMLInputElement, new File([new Uint8Array(fill.bytes)], fill.fileName ? fill.fileName : "package", { type: fill.mime }));
  filled.push("file");

  if (waitMs > 0) {
    const copyUntil = Date.now() + Math.min(waitMs, 400);
    while (Date.now() < copyUntil && !/copied from the file/i.test(plain(doc.body))) await delay(stepMs);
  }

  if (fill.displayName) {
    const box = fieldInput("Display name");
    if (!box) return miss("display name", "no display name field", "CurseForge form has no display name field. The tab was left open.");
    writeControl(box, fill.displayName);
    filled.push("display name");
  }

  const choice = radioNamed(fill.manual ? CURSE_MANUAL : CURSE_AUTO);
  if (!choice) return miss("release", "no release option", "CurseForge form has no release option. The tab was left open.");
  choice.click();
  filled.push("release");

  for (const version of fill.versions) {
    const section = heading("Minecraft") as Element;
    const scope = scopeOf(section);
    const wanted = version.toLowerCase();
    const chip = [...scope.querySelectorAll("span, div, button, li, [data-chip]")].find((node) => {
      if (node.getAttribute("role") === "option") return false;
      return plain(node).toLowerCase().replace(/[×x✕]/g, "").trim() === wanted;
    });
    if (chip) continue;
    const opener = scope.querySelector("button, [role='combobox']");
    if (opener instanceof HTMLElement) opener.click();
    const field = scope.querySelector("input:not([type='file']):not([type='radio'])");
    if (field instanceof HTMLInputElement) writeControl(field, version);
    let option: Element | undefined;
    await waitFor(() => {
      option = [...doc.querySelectorAll("[role='option'], li, button")].find((node) => plain(node).toLowerCase() === wanted);
      return option instanceof HTMLElement;
    });
    if (!(option instanceof HTMLElement)) {
      return miss("minecraft", `no Minecraft version ${version}`, `CurseForge has no Minecraft version ${version}. The tab was left open.`);
    }
    option.click();
  }
  filled.push("minecraft");

  const releaseLabel = heading("Release Type") as Element;
  const releaseScope = scopeOf(releaseLabel);
  const releaseSelect = releaseScope.querySelector("select");
  if (releaseSelect instanceof HTMLSelectElement) {
    const option = [...releaseSelect.options].find((item) => plain(item).toLowerCase() === fill.releaseType.toLowerCase());
    if (!option) return miss("release type", `no release type ${fill.releaseType}`, `CurseForge has no release type ${fill.releaseType}. The tab was left open.`);
    releaseSelect.value = option.value;
    releaseSelect.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const opener = releaseScope.querySelector("[role='combobox'], button");
    const showing = opener instanceof HTMLElement ? plain(opener).toLowerCase() : "";
    if (showing !== fill.releaseType.toLowerCase()) {
      if (opener instanceof HTMLElement) opener.click();
      let option: Element | undefined;
      await waitFor(() => {
        option = [...doc.querySelectorAll("[role='option'], button")].find(
          (node) => plain(node).toLowerCase() === fill.releaseType.toLowerCase(),
        );
        return option instanceof HTMLElement;
      });
      if (!(option instanceof HTMLElement)) {
        return miss("release type", "no release type", "CurseForge form has no release type. The tab was left open.");
      }
      option.click();
    }
  }
  filled.push("release type");

  if (fill.changelog) {
    let wrote = false;
    if (fill.code) {
      const switched = await pickMode("markdown");
      if (!switched) {
        const codeButton = buttonNamed("</>") ?? buttonNamed("code");
        if (codeButton) codeButton.click();
      } else {
        await waitFor(() => {
          const node = doc.querySelector("textarea.mde-text");
          return node instanceof HTMLTextAreaElement && !concealed(node);
        });
      }
      const marked = doc.querySelector("textarea.mde-text");
      if (marked instanceof HTMLTextAreaElement && !concealed(marked)) {
        writeControl(marked, fill.changelog);
        wrote = marked.value === fill.changelog;
      } else if (!(marked instanceof HTMLTextAreaElement)) {
        const fallback = doc.querySelector("textarea:not([aria-hidden='true'])");
        if (fallback instanceof HTMLTextAreaElement) {
          writeControl(fallback, fill.changelog);
          wrote = fallback.value === fill.changelog;
        }
      }
    } else {
      await pickMode("wysiwyg");
      const editor = doc.querySelector("[contenteditable='true']");
      if (editor instanceof HTMLElement) {
        if (/<[a-z][\s\S]*>/i.test(fill.changelog)) editor.innerHTML = fill.changelog;
        else editor.textContent = fill.changelog;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        wrote = true;
      }
    }
    if (!wrote && !writeTiny(fill.changelog)) {
      return miss("changelog", "both editors stayed empty", "CurseForge changelog editor did not open. The tab was left open.");
    }
    filled.push("changelog");
  }

  for (const relation of fill.relations) {
    const add = buttonNamed("Add related project");
    if (!add) return miss("relations", "no related projects", "CurseForge form has no related projects. The tab was left open.");
    add.click();
    const search = doc.querySelector("[role='dialog'] input, dialog input");
    if (!(search instanceof HTMLInputElement)) {
      return miss("relations", "relation search did not open", "CurseForge relation search did not open. The tab was left open.");
    }
    writeControl(search, relation);
    const confirm = buttonNamed("Add to relations");
    if (!confirm) return miss("relations", "did not offer Add to relations", "CurseForge did not offer Add to relations. The tab was left open.");
    confirm.click();
  }
  if (fill.relations.length > 0) filled.push("relations");

  const submit = buttonNamed("Add File");
  if (!submit) return miss("submit", "no Add File button", "CurseForge form has no Add File button. The tab was left open.");
  const before = hrefOf();
  submit.click();

  const started = Date.now();
  for (;;) {
    const link = [...doc.querySelectorAll("a")]
      .map((anchor) => anchor.getAttribute("href"))
      .find((href) => href != null && /\/files\/\d+/.test(href) && !href.includes("/create"));
    if (link) {
      const base = before.startsWith("http") ? before : "https://authors.curseforge.com/";
      return { ok: true, url: new URL(link as string, base).href };
    }
    const href = hrefOf();
    if (href && href !== before && !href.includes("/files/create") && !/^about:/i.test(href)) {
      return { ok: true, url: href };
    }
    const alert = doc.querySelector("[role='alert']");
    const alertText = alert ? plain(alert) : "";
    if (alertText && !/copied from the file/i.test(alertText)) return miss("submit", alertText, alertText);
    if (waitMs < 1 || Date.now() - started >= waitMs) break;
    await delay(stepMs);
  }
  return miss("submit", "upload did not finish", "CurseForge did not finish the upload. The tab was left open.");
}
