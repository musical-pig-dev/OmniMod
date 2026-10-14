export const PLATFORM_IDS = [
  "nexus",
  "curseforge",
  "modrinth",
  "github",
  "thunderstore",
  "steam",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type PlatformField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder: string;
};

export type Platform = {
  id: PlatformId;
  name: string;
  summary: string;
  experimental?: boolean;
  tokenUrl?: string;
  tokenLabel?: string;
  fields: PlatformField[];
};

export const PLATFORMS: Platform[] = [
  {
    id: "nexus",
    name: "Nexus Mods",
    summary: "Upload API. A personal API key, the game from the URL, and the existing mod id.",
    tokenUrl: "https://www.nexusmods.com/",
    tokenLabel: "Open Nexus Mods",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "Your Nexus API key" },
      { key: "gameDomain", label: "Game domain", placeholder: "skyrimspecialedition" },
      { key: "modId", label: "Mod ID", placeholder: "123456" },
    ],
  },
  {
    id: "curseforge",
    name: "CurseForge",
    summary: "File API. An account token and the project id.",
    tokenUrl: "https://console.curseforge.com/",
    tokenLabel: "Open CurseForge console",
    fields: [
      { key: "token", label: "API token", secret: true, placeholder: "X-Api-Token" },
      { key: "projectId", label: "Project ID", placeholder: "987654" },
    ],
  },
  {
    id: "modrinth",
    name: "Modrinth",
    summary: "Versions API. A token with version create, plus the project.",
    tokenUrl: "https://modrinth.com/settings/pats",
    tokenLabel: "Create a Modrinth token",
    fields: [
      { key: "token", label: "Personal access token", secret: true, placeholder: "mrp_…" },
      { key: "project", label: "Project ID or slug", placeholder: "lanterns" },
    ],
  },
  {
    id: "github",
    name: "GitHub Releases",
    summary: "Releases API. A token that can write the repository.",
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
    summary: "Package submit. A service-account token and the team namespace.",
    tokenUrl: "https://thunderstore.io/",
    tokenLabel: "Open Thunderstore",
    fields: [
      { key: "token", label: "Service token", secret: true, placeholder: "tss_…" },
      { key: "namespace", label: "Team namespace", placeholder: "MyTeam" },
    ],
  },
  {
    id: "steam",
    name: "Steam Workshop",
    summary: "SteamCMD handoff. Recorded here, marked experimental.",
    experimental: true,
    tokenUrl: "https://partner.steamgames.com/",
    tokenLabel: "Steamworks docs",
    fields: [
      { key: "appId", label: "App ID", placeholder: "480" },
      { key: "itemId", label: "Workshop item ID", placeholder: "1234567890" },
    ],
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
  return {
    nexus: emptyConfig(),
    curseforge: emptyConfig(),
    modrinth: emptyConfig(),
    github: emptyConfig(),
    thunderstore: emptyConfig(),
    steam: emptyConfig(),
  };
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

export function isConfigured(platform: Platform, config: PlatformConfig): boolean {
  return platform.fields.every((field) => fieldValue(config, field.key).length > 0);
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
};

export type UploadRule = {
  hosts: number;
  maxBytes: number | null;
  label: string;
  multiple: boolean;
};

export function uploadRule(configs: ConfigMap): UploadRule {
  const hosts = PLATFORMS.filter((platform) => {
    const config = configs[platform.id];
    return Boolean(config?.enabled && isConfigured(platform, config));
  });
  if (hosts.length === 0) return { hosts: 0, maxBytes: null, label: "", multiple: false };
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
  };
}

export function hostLimitDetail(id: PlatformId): string {
  const rule = HOST_UPLOAD[id];
  const files = rule.multiple ? "More than one file" : "One archive";
  if (!rule.label) return `${files}. No published size cap.`;
  return rule.multiple ? `${files}, up to ${rule.label} each.` : `${files}, up to ${rule.label}.`;
}

export function uploadHint(rule: UploadRule): string {
  if (rule.hosts === 0) return "One archive. Add a host key to set a size limit.";
  const count = rule.multiple ? "More than one file is allowed." : "One archive.";
  const size = rule.label ? ` Largest file ${rule.label}.` : " No size cap from these hosts.";
  return count + size;
}

export function acceptFiles(
  files: { name: string; size: number }[],
  rule: UploadRule,
  version: string,
): { ok: true; fileName: string; version: string; size: number } | { ok: false; message: string } {
  if (files.length === 0) return { ok: false, message: "" };
  const chosen = rule.multiple ? files : files.slice(0, 1);
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
