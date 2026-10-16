export const PLATFORM_IDS = [
  "nexus",
  "modrinth",
  "github",
  "thunderstore",
  "curseforge",
  "steam",
  "basedmods",
  "ayakamods",
  "afkmods",
  "moddinghaven",
  "laxmods",
  "moddb",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type HostLane = "api" | "bot" | "later";

export type FieldChoice = { value: string; label: string };

export type PlatformField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder: string;
  optional?: boolean;
  defaultValue?: string;
  choices?: FieldChoice[];
};

export type Platform = {
  id: PlatformId;
  name: string;
  summary: string;
  lane: HostLane;
  later?: boolean;
  accepts?: string[];
  site?: string;
  tokenUrl?: string;
  tokenLabel?: string;
  fields: PlatformField[];
};

export const PLATFORMS: Platform[] = [
  {
    id: "nexus",
    name: "Nexus Mods",
    summary: "Upload API. A personal API key, the game from the URL, and the existing mod id.",
    lane: "api",
    accepts: [".zip", ".rar", ".7z"],
    tokenUrl: "https://www.nexusmods.com/",
    tokenLabel: "Open Nexus Mods",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "Your Nexus API key" },
      { key: "gameDomain", label: "Game domain", placeholder: "skyrimspecialedition" },
      { key: "modId", label: "Mod ID", placeholder: "123456" },
    ],
  },
  {
    id: "modrinth",
    name: "Modrinth",
    summary: "Versions API. A token with version create, the project, and the game versions and loaders that file supports.",
    lane: "api",
    accepts: [".jar"],
    tokenUrl: "https://modrinth.com/settings/pats",
    tokenLabel: "Create a Modrinth token",
    fields: [
      { key: "token", label: "Personal access token", secret: true, placeholder: "mrp_…" },
      { key: "project", label: "Project ID or slug", placeholder: "lanterns" },
      { key: "gameVersions", label: "Game versions", placeholder: "1.20.1, 1.20.2" },
      { key: "loaders", label: "Loaders", placeholder: "fabric" },
    ],
  },
  {
    id: "github",
    name: "GitHub Releases",
    summary: "Releases API. A token that can write the repository.",
    lane: "api",
    tokenUrl: "https://github.com/settings/tokens",
    tokenLabel: "Create a GitHub token",
    fields: [
      { key: "token", label: "Personal access token", secret: true, placeholder: "github_pat_…" },
      { key: "repo", label: "Repository", placeholder: "owner/mod" },
    ],
  },
  {
    id: "thunderstore",
    name: "Thunderstore",
    summary: "Upload API. A service-account token, the team, and the community the package is listed in.",
    lane: "api",
    accepts: [".zip"],
    tokenUrl: "https://thunderstore.io/",
    tokenLabel: "Open Thunderstore",
    fields: [
      { key: "token", label: "Service token", secret: true, placeholder: "tss_…" },
      { key: "namespace", label: "Team namespace", placeholder: "MyTeam" },
      { key: "community", label: "Community", placeholder: "riskofrain2" },
      { key: "categories", label: "Categories", placeholder: "items, skills", optional: true },
    ],
  },
  {
    id: "curseforge",
    name: "CurseForge",
    summary: "Authors form. Opens the upload page in a background tab and fills it with the browser login. A project id and game versions. No API token.",
    lane: "bot",
    accepts: [".zip"],
    tokenUrl: "https://www.curseforge.com/",
    tokenLabel: "Open CurseForge",
    fields: [
      { key: "projectId", label: "Project ID", placeholder: "987654" },
      { key: "gameVersions", label: "Game versions", placeholder: "17045 or 26.3" },
      {
        key: "releaseType",
        label: "Release type",
        placeholder: "release",
        defaultValue: "release",
        choices: [
          { value: "release", label: "Release" },
          { value: "beta", label: "Beta" },
          { value: "alpha", label: "Alpha" },
        ],
      },
      {
        key: "publishWhen",
        label: "Publish when",
        placeholder: "auto",
        defaultValue: "auto",
        choices: [
          { value: "auto", label: "When it is approved" },
          { value: "manual", label: "Keep it as a draft" },
        ],
      },
      {
        key: "changelogType",
        label: "Changelog format",
        placeholder: "html",
        defaultValue: "html",
        choices: [
          { value: "html", label: "WYSIWYG" },
          { value: "text", label: "Text" },
          { value: "markdown", label: "Markdown" },
        ],
      },
      { key: "relations", label: "Relations", placeholder: "jei:requiredDependency", optional: true },
      { key: "displayName", label: "Display name", placeholder: "File name", optional: true },
    ],
  },
  {
    id: "steam",
    name: "Steam Workshop",
    summary: "Not available until a later date. A local helper will upload to Workshop.",
    lane: "later",
    later: true,
    site: "https://steamcommunity.com/workshop/",
    fields: [
      { key: "appId", label: "App ID", placeholder: "480" },
      { key: "itemId", label: "Workshop item ID", placeholder: "1234567890" },
    ],
  },
  {
    id: "basedmods",
    name: "Basedmods",
    summary: "Permanent archive for video game mods. No download caps. Prohibits adult/NSFW content.",
    lane: "later",
    later: true,
    site: "https://basedmods.org",
    fields: [],
  },
  {
    id: "ayakamods",
    name: "AyakaMods",
    summary: "Community-driven alternative built by modders. Hosts gameplay adjustments, UI fixes, and skin swaps.",
    lane: "later",
    later: true,
    site: "https://ayakamods.com",
    fields: [],
  },
  {
    id: "afkmods",
    name: "AFK Mods",
    summary: "Long-standing curated site. Elder Scrolls and Fallout focused.",
    lane: "later",
    later: true,
    site: "https://www.afkmods.com",
    fields: [],
  },
  {
    id: "moddinghaven",
    name: "Modding Haven",
    summary: "Community hub that hosts independent archives and files. Emphasizes user ownership of mod files.",
    lane: "later",
    later: true,
    site: "https://moddinghaven.com",
    fields: [],
  },
  {
    id: "laxmods",
    name: "LaxMods",
    summary: "Independent archive for mainstream game modifications.",
    lane: "later",
    later: true,
    site: "https://laxmods.su",
    fields: [],
  },
  {
    id: "moddb",
    name: "Mod DB",
    summary: "Independent PC modding site. Standard community content and total conversions.",
    lane: "later",
    later: true,
    site: "https://www.moddb.com",
    fields: [],
  },
];

export type PlatformConfig = {
  enabled: boolean;
  fields: Record<string, string>;
};

export type ConfigMap = Record<PlatformId, PlatformConfig>;

export function emptyConfig(): PlatformConfig {
  return { enabled: true, fields: {} };
}

export function defaultConfigs(): ConfigMap {
  const configs = {} as ConfigMap;
  for (const platform of PLATFORMS) configs[platform.id] = emptyConfig();
  return configs;
}

export function platformById(id: PlatformId): Platform {
  const found = PLATFORMS.find((platform) => platform.id === id);
  if (!found) throw new Error(`Unknown platform ${id}`);
  return found;
}

export function accountFields(platform: Platform): PlatformField[] {
  return platform.fields.filter((field) => field.secret || field.key === "namespace");
}

export function modFields(platform: Platform): PlatformField[] {
  return platform.fields.filter((field) => !field.secret && field.key !== "namespace");
}

export function fieldValue(config: PlatformConfig, key: string): string {
  return (config.fields[key] ?? "").trim();
}

export function resolvedField(field: PlatformField, config: PlatformConfig): string {
  const value = fieldValue(config, field.key);
  if (value) return value;
  return (field.defaultValue ?? "").trim();
}

export function isConfigured(platform: Platform, config: PlatformConfig): boolean {
  return platform.fields.every((field) => field.optional || resolvedField(field, config).length > 0);
}

export type SiteReadiness = "ready" | "needs-setup" | "off";

export function readiness(platform: Platform, config: PlatformConfig): SiteReadiness {
  if (!config.enabled) return "off";
  if (!isConfigured(platform, config)) return "needs-setup";
  return "ready";
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

type HostUpload = { maxBytes: number | null; label: string; multiple: boolean };

const HOST_UPLOAD: Record<PlatformId, HostUpload> = {
  modrinth: { maxBytes: 500 * MiB, label: "500 MiB", multiple: true },
  curseforge: { maxBytes: 2 * GiB - 1, label: "2 GB", multiple: false },
  github: { maxBytes: 2 * GiB - 1, label: "2 GiB", multiple: true },
  thunderstore: { maxBytes: 5_242_880_000, label: "5 GB", multiple: false },
  nexus: { maxBytes: null, label: "", multiple: false },
  steam: { maxBytes: null, label: "", multiple: false },
  basedmods: { maxBytes: null, label: "", multiple: false },
  ayakamods: { maxBytes: null, label: "", multiple: false },
  afkmods: { maxBytes: null, label: "", multiple: false },
  moddinghaven: { maxBytes: null, label: "", multiple: false },
  laxmods: { maxBytes: null, label: "", multiple: false },
  moddb: { maxBytes: null, label: "", multiple: false },
};

export type UploadRule = {
  hosts: number;
  maxBytes: number | null;
  label: string;
  multiple: boolean;
  extensions: string[] | null;
};

export function fileExtension(name: string): string {
  const base = name.trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export function acceptLabel(platform: Platform): string {
  if (!platform.accepts?.length) return "Accepts any file type.";
  return `Accepts ${platform.accepts.join(", ")}.`;
}

export function typeLock(configs: ConfigMap): string[] | null {
  const lists: string[][] = [];
  for (const platform of PLATFORMS) {
    if (platform.lane !== "api" || !platform.accepts?.length) continue;
    const config = configs[platform.id];
    if (!config.enabled || !isConfigured(platform, config)) continue;
    lists.push(platform.accepts);
  }
  if (lists.length === 0) return null;
  return lists.reduce((shared, list) => shared.filter((ext) => list.includes(ext)));
}

export function hostTakesOne(id: PlatformId): boolean {
  return !HOST_UPLOAD[id].multiple;
}

export function typeBlock(platform: Platform, configs: ConfigMap, fileName: string, autoZip = false): string | null {
  if (platform.lane === "later") return null;
  const accepts = platform.accepts;
  const ext = fileExtension(fileName);
  if (ext) {
    if (!accepts?.length || accepts.includes(ext)) return null;
    if (autoZip && accepts.includes(".zip")) return null;
    return `Accepts ${accepts.join(", ")}. This file is ${ext}.`;
  }
  if (autoZip && accepts?.includes(".zip")) return null;
  const lock = typeLock(configs);
  if (lock == null || !accepts?.length) return null;
  if (lock.length === 0) return "These hosts do not accept the same file type.";
  if (accepts.some((item) => lock.includes(item))) return null;
  return `Accepts ${accepts.join(", ")}. The ready hosts need ${lock.join(", ")}.`;
}

export function curseForgeOnForm(configs: ConfigMap, fileName: string, autoZip = false): boolean {
  const platform = platformById("curseforge");
  const config = configs.curseforge;
  if (!config.enabled || !isConfigured(platform, config)) return false;
  return !typeBlock(platform, configs, fileName, autoZip);
}

function ruleExtensions(configs: ConfigMap): string[] | null {
  const lock = typeLock(configs);
  if (lock && lock.length === 0) {
    const open = PLATFORMS.some((platform) => {
      if (platform.lane !== "api" || platform.accepts?.length) return false;
      const config = configs[platform.id];
      return config.enabled && isConfigured(platform, config);
    });
    if (open) return null;
  }
  return lock;
}

export function uploadRule(configs: ConfigMap, fileName = "", autoZip = false): UploadRule {
  const extensions = ruleExtensions(configs);
  const hosts = PLATFORMS.filter((platform) => {
    if (platform.lane !== "api") return false;
    const config = configs[platform.id];
    if (!config.enabled || !isConfigured(platform, config)) return false;
    return !typeBlock(platform, configs, fileName, autoZip);
  });
  if (hosts.length === 0) return { hosts: 0, maxBytes: null, label: "", multiple: false, extensions };
  let maxBytes: number | null = null;
  let label = "";
  for (const host of hosts) {
    const rule = HOST_UPLOAD[host.id];
    if (rule.maxBytes == null) continue;
    if (maxBytes == null || rule.maxBytes < maxBytes) {
      maxBytes = rule.maxBytes;
      label = rule.label;
    }
  }
  return {
    hosts: hosts.length,
    maxBytes,
    label,
    multiple: hosts.every((host) => HOST_UPLOAD[host.id].multiple),
    extensions,
  };
}

export function hostLimitDetail(id: PlatformId): string {
  const rule = HOST_UPLOAD[id];
  const files = rule.multiple ? "More than one file" : "One archive";
  if (!rule.label) return `${files}. No published size cap.`;
  return rule.multiple ? `${files}, up to ${rule.label} each.` : `${files}, up to ${rule.label}.`;
}

export function uploadHint(rule: UploadRule): string {
  if (rule.hosts === 0) return "Add a host key to set a size limit.";
  const count = rule.multiple ? "More than one file is allowed." : "One archive.";
  const size = rule.label ? ` Largest file ${rule.label}.` : " No size cap from these hosts.";
  return count + size;
}

export function acceptFiles(
  files: { name: string; size: number }[],
  rule: UploadRule,
  version: string,
  autoZip = false,
): { ok: true; fileName: string; version: string; size: number } | { ok: false; message: string } {
  if (files.length === 0) return { ok: false, message: "" };
  if (!autoZip && rule.extensions && rule.extensions.length === 0) {
    return { ok: false, message: "These hosts do not accept the same file type." };
  }
  const chosen = autoZip || rule.multiple ? files : files.slice(0, 1);
  if (rule.extensions && rule.extensions.length > 0) {
    const wrong = chosen.find((file) => {
      const ext = fileExtension(file.name);
      if (rule.extensions!.includes(ext)) return false;
      return !(autoZip && (ext === ".zip" || rule.extensions!.includes(".zip")));
    });
    if (wrong) {
      return { ok: false, message: `${wrong.name} is not accepted. These hosts need ${rule.extensions.join(", ")}.` };
    }
  }
  if (rule.maxBytes != null) {
    const tooBig = chosen.find((file) => file.size > rule.maxBytes!);
    if (tooBig) return { ok: false, message: `${tooBig.name} is over the ${rule.label} limit for the hosts on this mod.` };
  }
  const match = !version.trim() ? chosen[0]?.name.match(/(\d+\.\d+\.\d+)/) : null;
  return {
    ok: true,
    fileName: chosen.map((file) => file.name).join(", "),
    version: match?.[1] ?? version,
    size: chosen.reduce((sum, file) => sum + file.size, 0),
  };
}
