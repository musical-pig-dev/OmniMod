import {
  PLATFORMS,
  type ConfigMap,
  type PlatformId,
  isConfigured,
  platformById,
} from "./catalog.ts";

export type PublishInput = {
  fileName: string;
  version: string;
  changelog: string;
  file?: Blob | null;
  fields?: Record<string, string>;
};

export type SiteStatus = "skipped" | "success" | "error";

export type SiteResult = {
  id: PlatformId;
  status: SiteStatus;
  message: string;
};

export type TransportResult = { ok: true; detail?: string } | { ok: false; message: string };

export type Transport = (
  id: PlatformId,
  input: PublishInput,
) => Promise<TransportResult>;

export type SkipReason = "disabled" | "missing-credentials" | "no-package";

export type PlanEntry =
  | { id: PlatformId; action: "publish" }
  | { id: PlatformId; action: "skip"; reason: SkipReason };

export function planPublish(configs: ConfigMap, input: PublishInput): PlanEntry[] {
  const hasPackage = input.fileName.trim().length > 0;
  return PLATFORMS.map((platform) => {
    const config = configs[platform.id];
    if (!config.enabled) return { id: platform.id, action: "skip", reason: "disabled" };
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

function skipMessage(reason: SkipReason, name: string): string {
  if (reason === "disabled") return `${name} is turned off.`;
  if (reason === "no-package") return `No package selected, so ${name} was not contacted.`;
  return `${name} needs account details. Left alone.`;
}

function successMessage(id: PlatformId, input: PublishInput): string {
  const name = platformById(id).name;
  const version = input.version.trim() || "unversioned";
  const note = input.changelog.trim() ? "" : " No changelog was attached.";
  if (id === "steam") {
    return `SteamCMD handoff queued for ${name} (${version}).${note}`;
  }
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
        message: skipMessage(entry.reason, name),
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
        results.push({
          id: entry.id,
          status: "success",
          message: `${successMessage(entry.id, args.input)}${extra}`,
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
  appId: "480",
  itemId: "2904410021",
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
