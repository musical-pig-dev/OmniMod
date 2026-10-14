export type ConfigMap = Record<string, Record<string, string>>;

export type ModRecord = {
  id: string;
  name: string;
  fileName?: string;
  version?: string;
  changelog?: string;
  configs: ConfigMap;
  publishedVersions: string[];
};

export function lastPublished(mod: { publishedVersions?: string[]; version?: string }): string {
  const list = mod.publishedVersions ?? [];
  return list.length ? list[list.length - 1] : mod.version ?? "—";
}

export function versionUsed(mod: { publishedVersions?: string[] }, version: string): boolean {
  return (mod.publishedVersions ?? []).includes(version);
}

export function recordPublish<T extends ModRecord>(mod: T, version: string, succeeded: boolean): T {
  if (!succeeded) return mod;
  const next = { ...mod, fileName: undefined, version: "", changelog: "" };
  if (!versionUsed(mod, version)) {
    next.publishedVersions = [...(mod.publishedVersions ?? []), version];
  }
  return next;
}

export function hydrateMod(raw: Partial<ModRecord>): ModRecord {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? "Untitled",
    fileName: raw.fileName,
    version: raw.version ?? "",
    changelog: raw.changelog ?? "",
    configs: raw.configs ?? {},
    publishedVersions: raw.publishedVersions ?? [],
  };
}
