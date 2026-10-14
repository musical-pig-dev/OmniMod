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
    summary: "Upload API. A personal API key and the existing mod id.",
    tokenUrl: "https://www.nexusmods.com/",
    tokenLabel: "Open Nexus Mods",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "Your Nexus API key" },
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
