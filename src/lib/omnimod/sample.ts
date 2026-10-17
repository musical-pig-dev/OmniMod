import { defaultConfigs } from "./catalog.ts";
import { deploymentFrom, type Deployment } from "./history.ts";
import type { ModRecord } from "./mods.ts";

export type SampleBundle = {
  mods: ModRecord[];
  deployments: Deployment[];
  bugs: number;
};

function sampleMod(id: string, name: string, version: string): ModRecord {
  return {
    id,
    name,
    fileName: "",
    version,
    changelog: "",
    configs: defaultConfigs(),
    publishedVersions: ["0.9.0"],
    curseforgeOverride: {},
    autoZip: false,
    zipName: "",
  };
}

export function sampleBundle(): SampleBundle | null {
  if (import.meta.env.DEV && import.meta.env.VITE_OMNIMOD_SAMPLE === "1") {
    const lanterns = sampleMod("sample-lanterns", "Lanterns", "1.2.0");
    const moths = sampleMod("sample-moths", "Glass Moths", "0.4.1");
    const harbor = sampleMod("sample-harbor", "Harbor Bells", "2.0.0");
    const sent = deploymentFrom({
      id: "sample-deploy-lanterns",
      modId: lanterns.id,
      mod: lanterns.name,
      version: "1.1.0",
      notes: "Warmer glass.",
      when: "2026-01-02T15:04:00.000Z",
      results: [
        { id: "nexus", status: "success", message: "Nexus Mods accepted 1.1.0.", url: "https://www.nexusmods.com/lanterns" },
        { id: "modrinth", status: "success", message: "Modrinth accepted 1.1.0.", url: "https://modrinth.com/mod/lanterns" },
      ],
    });
    const mixed = deploymentFrom({
      id: "sample-deploy-moths",
      modId: moths.id,
      mod: moths.name,
      version: "0.4.0",
      notes: "A softer wing.",
      when: "2026-02-03T08:09:00.000Z",
      results: [
        { id: "github", status: "success", message: "GitHub Releases accepted 0.4.0.", url: "https://github.com/studio/moths/releases/tag/0.4.0" },
        { id: "curseforge", status: "error", message: "CurseForge rejected the upload." },
      ],
    });
    const failed = deploymentFrom({
      id: "sample-deploy-harbor",
      modId: harbor.id,
      mod: harbor.name,
      version: "1.9.0",
      notes: "The bell line.",
      when: "2026-03-04T12:30:00.000Z",
      results: [
        { id: "thunderstore", status: "error", message: "Thunderstore rejected the upload." },
        { id: "nexus", status: "error", message: "Nexus Mods rejected the upload." },
      ],
    });
    return {
      mods: [lanterns, moths, harbor],
      deployments: [sent, mixed, failed].filter((row): row is Deployment => row != null),
      bugs: 3,
    };
  }
  return null;
}

export function freshSample(): SampleBundle | null {
  const sample = sampleBundle();
  if (!sample) return null;
  if (localStorage.getItem("omnimod-vault-v3")) return null;
  const raw = localStorage.getItem("omnimod-mods-v3");
  if (!raw) return sample;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return null;
  } catch {
    return sample;
  }
  return sample;
}
