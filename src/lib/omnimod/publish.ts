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
  if (sources.length > 1 && hostTakesOne(id)) return preferZip(zip, file);
  const ext = fileExtension(first.name);
  if (!accepts || accepts.includes(ext)) return first.blob;
  if (accepts.includes(".zip")) return preferZip(zip, file);
  return file;
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
        });
      }
    } catch (error) {
      failed += 1;
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

export type CurseFillResult = { ok: true; url: string } | { ok: false; message: string };

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
      const nested = textInput(node);
      if (nested) return nested;
      const parent = node.parentElement;
      if (parent && parent !== doc.body) {
        const near = textInput(parent);
        if (near) return near;
      }
    }
    return null;
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

  let fileInput: HTMLInputElement | null = null;
  const ready = await waitFor(() => {
    if (isLogin()) return true;
    const found = doc.querySelector("input[type='file']");
    if (found) fileInput = found as HTMLInputElement;
    return fileInput != null || isLogin();
  });
  if (!ready || isLogin()) {
    return {
      ok: false,
      message: !ready
        ? "CurseForge form did not load. The tab was left open."
        : "CurseForge needs a sign-in. The form tab was left open.",
    };
  }
  if (fill.versions.length === 0) {
    return { ok: false, message: "CurseForge needs a game version on the host key." };
  }

  placeFile(fileInput as HTMLInputElement, new File([new Uint8Array(fill.bytes)], fill.fileName ? fill.fileName : "package", { type: fill.mime }));

  if (waitMs > 0) {
    const copyUntil = Date.now() + Math.min(waitMs, 400);
    while (Date.now() < copyUntil && !/copied from the file/i.test(plain(doc.body))) await delay(stepMs);
  }

  if (fill.displayName) {
    const box = fieldInput("Display name");
    if (!box) return { ok: false, message: "CurseForge form has no display name field. The tab was left open." };
    writeControl(box, fill.displayName);
  }

  const choice = radioNamed(fill.manual ? CURSE_MANUAL : CURSE_AUTO);
  if (!choice) return { ok: false, message: "CurseForge form has no release option. The tab was left open." };
  choice.click();

  for (const version of fill.versions) {
    const section = heading("Minecraft") as Element;
    const parent = section.parentElement;
    const scope = parent && parent !== doc.body ? parent : section;
    const wanted = version.toLowerCase();
    const chip = [...scope.querySelectorAll("span, div, button, li, [data-chip]")].find((node) => {
      if (node.getAttribute("role") === "option") return false;
      return plain(node).toLowerCase().replace(/[×x✕]/g, "").trim() === wanted;
    });
    if (chip) continue;
    const opener = scope.querySelector("button, [role='combobox']");
    if (opener) (opener as HTMLElement).click();
    const field = scope.querySelector("input:not([type='file']):not([type='radio'])");
    if (field) writeControl(field as HTMLInputElement, version);
    const option = [...doc.querySelectorAll("[role='option'], li, button")].find((node) => plain(node).toLowerCase() === wanted);
    if (!(option instanceof HTMLElement)) {
      return { ok: false, message: `CurseForge has no Minecraft version ${version}. The tab was left open.` };
    }
    option.click();
  }

  const releaseLabel = heading("Release Type") as Element;
  const nested = releaseLabel.querySelector("select");
  const parent = releaseLabel.parentElement;
  const sibling = parent && parent !== doc.body ? parent.querySelector("select") : null;
  const releaseSelect = nested ?? sibling;
  if (releaseSelect instanceof HTMLSelectElement) {
    const option = [...releaseSelect.options].find((item) => plain(item).toLowerCase() === fill.releaseType.toLowerCase());
    if (!option) return { ok: false, message: `CurseForge has no release type ${fill.releaseType}. The tab was left open.` };
    releaseSelect.value = option.value;
    releaseSelect.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const scope = parent && parent !== doc.body ? parent : releaseLabel;
    const opener = scope.querySelector("button, [role='combobox']");
    if (opener instanceof HTMLElement && plain(opener).toLowerCase() !== fill.releaseType.toLowerCase()) opener.click();
    const option = [...doc.querySelectorAll("[role='option'], button")].find(
      (node) => plain(node).toLowerCase() === fill.releaseType.toLowerCase(),
    );
    if (!(option instanceof HTMLElement)) {
      return { ok: false, message: "CurseForge form has no release type. The tab was left open." };
    }
    option.click();
  }

  if (fill.changelog) {
    if (fill.code) {
      const codeButton = buttonNamed("</>") ?? buttonNamed("code");
      if (codeButton) codeButton.click();
      const area = doc.querySelector("textarea");
      if (!(area instanceof HTMLTextAreaElement)) {
        return { ok: false, message: "CurseForge changelog editor did not open. The tab was left open." };
      }
      writeControl(area, fill.changelog);
    } else {
      const editor = doc.querySelector("[contenteditable='true']");
      if (!(editor instanceof HTMLElement)) {
        return { ok: false, message: "CurseForge changelog editor did not open. The tab was left open." };
      }
      if (/<[a-z][\s\S]*>/i.test(fill.changelog)) editor.innerHTML = fill.changelog;
      else editor.textContent = fill.changelog;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  for (const relation of fill.relations) {
    const add = buttonNamed("Add related project");
    if (!add) return { ok: false, message: "CurseForge form has no related projects. The tab was left open." };
    add.click();
    const search = doc.querySelector("[role='dialog'] input, dialog input");
    if (!(search instanceof HTMLInputElement)) {
      return { ok: false, message: "CurseForge relation search did not open. The tab was left open." };
    }
    writeControl(search, relation);
    const confirm = buttonNamed("Add to relations");
    if (!confirm) return { ok: false, message: "CurseForge did not offer Add to relations. The tab was left open." };
    confirm.click();
  }

  const submit = buttonNamed("Add File");
  if (!submit) return { ok: false, message: "CurseForge form has no Add File button. The tab was left open." };
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
    if (alertText && !/copied from the file/i.test(alertText)) return { ok: false, message: alertText };
    if (waitMs < 1 || Date.now() - started >= waitMs) break;
    await delay(stepMs);
  }
  return { ok: false, message: "CurseForge did not finish the upload. The tab was left open." };
}
