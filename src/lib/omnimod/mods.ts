import {
  PLATFORMS,
  accountFields,
  defaultConfigs,
  modFields,
  type ConfigMap,
  type PlatformId,
} from "./catalog.ts";

export type TargetMap = Record<PlatformId, Record<string, string>>;

export type ModRecord = {
  id: string;
  name: string;
  fileName: string;
  version: string;
  changelog: string;
  configs: ConfigMap;
  publishedVersions: string[];
  curseforgeOverride: Record<string, string>;
};

export type StoredMod = Partial<ModRecord> & {
  targets?: TargetMap;
};

export function emptyTargets(): TargetMap {
  return {
    nexus: {},
    curseforge: {},
    modrinth: {},
    github: {},
    thunderstore: {},
    steam: {},
  };
}

export function nameTaken(mods: { id?: string; name: string }[], name: string, exceptId?: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  return mods.some((mod) => mod.id !== exceptId && mod.name.trim().toLowerCase() === key);
}

export function modId(source: { randomUUID?: () => string } | undefined = globalThis.crypto): string {
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  return `mod-${Date.now()}`;
}

export function createMod(name = "Untitled mod"): ModRecord {
  const id = modId();
  return {
    id,
    name,
    fileName: "",
    version: "0.0.1",
    changelog: "",
    configs: defaultConfigs(),
    publishedVersions: [],
    curseforgeOverride: {},
  };
}

export function normalizeConfigs(value: Partial<ConfigMap> | undefined): ConfigMap {
  const configs = defaultConfigs();
  for (const platform of PLATFORMS) {
    const source = value?.[platform.id];
    configs[platform.id] = {
      enabled: source?.enabled !== false,
      fields: { ...(source?.fields ?? {}) },
    };
  }
  return configs;
}

function curseOverride(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") next[key] = item;
  }
  return next;
}

export function hydrateMod(raw: StoredMod, account: ConfigMap): ModRecord {
  const base = createMod(raw.name || "Untitled mod");
  const configs = raw.configs
    ? normalizeConfigs(raw.configs)
    : mergeAccount(account, raw.targets ?? emptyTargets());
  return {
    id: raw.id || base.id,
    name: raw.name || "Untitled mod",
    fileName: raw.fileName ?? "",
    version: raw.version ?? "",
    changelog: raw.changelog ?? "",
    configs,
    publishedVersions: Array.isArray(raw.publishedVersions) ? raw.publishedVersions.filter((item) => item.trim()) : [],
    curseforgeOverride: curseOverride(raw.curseforgeOverride),
  };
}

export function versionUsed(publishedVersions: string[] | undefined, version: string): boolean {
  const key = version.trim();
  if (!key) return false;
  return (publishedVersions ?? []).some((item) => item.trim() === key);
}

export function nextFreeVersion(current: string, taken: readonly string[]): string {
  const used = new Set(taken.map((tag) => tag.trim().replace(/^refs\/tags\//, "").replace(/^v/, "")));
  let version = current.trim();
  while (used.has(version)) {
    const next = nextPatch(version);
    if (!next) return "";
    version = next;
  }
  return version;
}

export function nextPatch(version: string): string {
  const match = version.trim().match(/^(.*?)(\d+)([^\d]*)$/);
  if (!match) return "";
  const next = String(Number(match[2]) + 1).padStart(match[2].length, "0");
  return `${match[1]}${next}${match[3]}`;
}

export function lastPublished(publishedVersions: string[] | undefined): string {
  const versions = publishedVersions ?? [];
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const value = versions[index]?.trim();
    if (value) return value;
  }
  return "";
}

export function recordPublish<
  T extends {
    fileName: string;
    version: string;
    changelog: string;
    publishedVersions: string[];
    curseforgeOverride?: Record<string, string>;
  },
>(mod: T, version: string, succeeded: boolean): T {
  if (!succeeded) return mod;
  const key = version.trim();
  const publishedVersions =
    key && !versionUsed(mod.publishedVersions, key) ? [...mod.publishedVersions, key] : mod.publishedVersions;
  return { ...mod, fileName: "", version: nextPatch(key), changelog: "", publishedVersions, curseforgeOverride: {} };
}

export function targetsFromConfigs(configs: ConfigMap): TargetMap {
  const targets = emptyTargets();
  for (const platform of PLATFORMS) {
    for (const field of modFields(platform)) {
      const value = configs[platform.id]?.fields[field.key] ?? "";
      if (value.trim()) targets[platform.id][field.key] = value;
    }
  }
  return targets;
}

export function mergeAccount(account: ConfigMap, targets: TargetMap): ConfigMap {
  const merged = defaultConfigs();
  for (const platform of PLATFORMS) {
    const fields: Record<string, string> = {};
    for (const field of accountFields(platform)) {
      fields[field.key] = account[platform.id]?.fields[field.key] ?? "";
    }
    for (const field of modFields(platform)) {
      fields[field.key] = targets[platform.id]?.[field.key] ?? "";
    }
    merged[platform.id] = {
      enabled: account[platform.id]?.enabled !== false,
      fields,
    };
  }
  return merged;
}
