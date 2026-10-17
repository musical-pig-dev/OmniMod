import {
  PLATFORMS,
  defaultConfigs,
  platformById,
  type ConfigMap,
  type PlatformId,
} from "./catalog.ts";
import { hydrateMod, type ModRecord } from "./mods.ts";
import { readDeploymentList, type Deployment } from "./history.ts";
import type { PublishInput, Transport } from "./publish.ts";

export const STORAGE_KEY = "omnimod-configs-v1";
export const MODS_KEY = "omnimod-mods-v3";
export const ACTIVE_KEY = "omnimod-active-mod-v3";
export const DEPLOY_KEY = "omnimod-deploys-v1";

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 104857.6) / 10} MB`;
}

export function loadConfigs(storage: Pick<Storage, "getItem"> | null = globalThis.localStorage): ConfigMap {
  const base = defaultConfigs();
  if (!storage) return base;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<ConfigMap>;
    if (!parsed || typeof parsed !== "object") return base;
    for (const platform of PLATFORMS) {
      const saved = parsed[platform.id];
      if (!saved || typeof saved !== "object") continue;
      base[platform.id] = {
        enabled: true,
        fields: { ...(saved.fields ?? {}) },
      };
    }
  } catch {
    return defaultConfigs();
  }
  return base;
}

export function loadLibrary(
  configs: ConfigMap,
  storage: Pick<Storage, "getItem"> | null = globalThis.localStorage,
): { mods: ModRecord[]; activeId: string } {
  const empty = () => ({ mods: [] as ModRecord[], activeId: "" });
  if (!storage) return empty();
  try {
    const raw = storage.getItem(MODS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return empty();
        const mods = parsed.map((mod) => hydrateMod(mod as ModRecord, configs));
        const saved = storage.getItem(ACTIVE_KEY);
        const activeId = mods.some((mod) => mod.id === saved) ? (saved as string) : mods[0].id;
        return { mods, activeId };
      }
    }
  } catch {
    return empty();
  }
  return empty();
}

export function loadDeployments(storage: Pick<Storage, "getItem"> | null = globalThis.localStorage): Deployment[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DEPLOY_KEY);
    if (!raw) return [];
    return readDeploymentList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function studioDelay(id: string): number {
  return 420 + (id.length % 5) * 160;
}

export function wait(ms: number, schedule: (fn: () => void, delay: number) => void = (fn, delay) => {
  setTimeout(fn, delay);
}): Promise<void> {
  return new Promise((resolve) => {
    schedule(resolve, ms);
  });
}

export function studioTransport(delay: (id: string) => number = studioDelay, pause: (ms: number) => Promise<void> = (ms) => wait(ms)): Transport {
  return async (id, input) => {
    await pause(delay(id));
    return studioResponse(id, input);
  };
}

export function studioResponse(id: PlatformId, input: PublishInput): { ok: true } | { ok: false; message: string } {
  if (input.version.trim() === "0.0.0") {
    return { ok: false, message: "The host refused version 0.0.0." };
  }
  platformById(id);
  return { ok: true };
}
