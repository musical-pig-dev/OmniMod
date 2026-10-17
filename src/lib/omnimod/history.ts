import { PLATFORM_IDS, fileExtension, platformById, type PlatformId } from "./catalog.ts";
import type { SiteResult } from "./publish.ts";
import { archiveName } from "./zip.ts";

export type DeployHost = {
  id: PlatformId;
  name: string;
  status: "success" | "error";
  message: string;
  url: string;
};

export type DeployNote = {
  name: string;
  version: string;
  notes: string;
  links: { host: string; url: string }[];
};

export type Deployment = {
  id: string;
  modId: string;
  mod: string;
  when: string;
  hosts: DeployHost[];
  note: DeployNote;
};

export function whenLabel(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso.trim() ? iso.trim() : "—";
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day} ${hour}:${minute}`;
}

export function hostLine(row: Deployment): string {
  return row.hosts.map((host) => host.name).join(", ");
}

export function failedHosts(row: Deployment): DeployHost[] {
  return row.hosts.filter((host) => host.status === "error");
}

export function failedLine(row: Deployment): string {
  const failed = failedHosts(row);
  return failed.length ? failed.map((host) => host.name).join(", ") : "None";
}

function knownHost(id: unknown): PlatformId | null {
  if (typeof id !== "string" || !(PLATFORM_IDS as readonly string[]).includes(id)) return null;
  return id as PlatformId;
}

export function readDeployment(value: unknown): Deployment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.mod !== "string") return null;
  if (!Array.isArray(raw.hosts)) return null;
  const hosts: DeployHost[] = [];
  for (const item of raw.hosts) {
    if (!item || typeof item !== "object") continue;
    const host = item as Record<string, unknown>;
    const id = knownHost(host.id);
    if (!id) continue;
    if (host.status !== "success" && host.status !== "error") continue;
    const named = typeof host.name === "string" && host.name.trim() ? host.name : platformById(id).name;
    hosts.push({
      id,
      name: named,
      status: host.status,
      message: typeof host.message === "string" ? host.message : "",
      url: typeof host.url === "string" ? host.url : "",
    });
  }
  if (hosts.length === 0) return null;
  const noteRaw = raw.note && typeof raw.note === "object" ? (raw.note as Record<string, unknown>) : {};
  const linksRaw = Array.isArray(noteRaw.links) ? noteRaw.links : [];
  const links: { host: string; url: string }[] = [];
  for (const link of linksRaw) {
    if (!link || typeof link !== "object") continue;
    const row = link as { host?: unknown; url?: unknown };
    if (typeof row.host !== "string") continue;
    links.push({ host: row.host, url: typeof row.url === "string" ? row.url : "" });
  }
  return {
    id: raw.id,
    modId: typeof raw.modId === "string" ? raw.modId : "",
    mod: raw.mod,
    when: typeof raw.when === "string" ? raw.when : "",
    hosts,
    note: {
      name: typeof noteRaw.name === "string" ? noteRaw.name : raw.mod,
      version: typeof noteRaw.version === "string" ? noteRaw.version : "",
      notes: typeof noteRaw.notes === "string" ? noteRaw.notes : "",
      links,
    },
  };
}

export function readDeploymentList(value: unknown): Deployment[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "deployments" in value
      ? (value as { deployments?: unknown }).deployments
      : null;
  if (!Array.isArray(list)) return [];
  const rows: Deployment[] = [];
  for (const item of list) {
    const row = readDeployment(item);
    if (row) rows.push(row);
  }
  return rows;
}

export function deploymentFrom(args: {
  id: string;
  modId: string;
  mod: string;
  version: string;
  notes: string;
  when: string;
  results: SiteResult[];
}): Deployment | null {
  const hosts: DeployHost[] = [];
  for (const result of args.results) {
    if (result.status === "skipped") continue;
    hosts.push({
      id: result.id,
      name: platformById(result.id).name,
      status: result.status,
      message: result.message,
      url: result.url?.trim() ?? "",
    });
  }
  if (hosts.length === 0) return null;
  return {
    id: args.id,
    modId: args.modId,
    mod: args.mod,
    when: args.when,
    hosts,
    note: {
      name: args.mod,
      version: args.version,
      notes: args.notes,
      links: hosts.filter((host) => host.status === "success").map((host) => ({ host: host.name, url: host.url })),
    },
  };
}

export type DeployFilter = { mod?: string; hosts?: string; when?: string; failed?: string };

export function filterDeployments(rows: Deployment[], filter: DeployFilter): Deployment[] {
  const mod = (filter.mod ?? "").trim().toLowerCase();
  const hosts = (filter.hosts ?? "").trim().toLowerCase();
  const when = (filter.when ?? "").trim().toLowerCase();
  const failed = (filter.failed ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (mod && !row.mod.toLowerCase().includes(mod)) return false;
    if (hosts && !hostLine(row).toLowerCase().includes(hosts)) return false;
    const label = whenLabel(row.when).toLowerCase();
    if (when && !label.includes(when) && !row.when.toLowerCase().includes(when)) return false;
    if (failed && !failedLine(row).toLowerCase().includes(failed)) return false;
    return true;
  });
}

export type DeploySortKey = "mod" | "hosts" | "when" | "failed";

export function columnText(row: Deployment, column: DeploySortKey): string {
  if (column === "mod") return row.mod;
  if (column === "hosts") return hostLine(row);
  if (column === "when") return `${whenLabel(row.when)} ${row.when}`;
  return `${failedHosts(row).length} ${failedLine(row)}`;
}

export function searchDeployments(rows: Deployment[], query: string, columns: DeploySortKey[]): Deployment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  const keys = columns.length > 0 ? columns : (["mod", "hosts", "when", "failed"] as const);
  return rows.filter((row) => keys.some((column) => columnText(row, column).toLowerCase().includes(needle)));
}

export function sortDeployments(rows: Deployment[], key: DeploySortKey, dir: "asc" | "desc"): Deployment[] {
  const sign = dir === "asc" ? 1 : -1;
  const copy = [...rows];
  copy.sort((left, right) => {
    if (key === "failed") {
      const delta = failedHosts(left).length - failedHosts(right).length;
      return delta * sign || left.mod.localeCompare(right.mod);
    }
    if (key === "when") {
      const a = Date.parse(left.when);
      const b = Date.parse(right.when);
      const delta = (Number.isNaN(a) ? 0 : a) - (Number.isNaN(b) ? 0 : b);
      return delta * sign || left.mod.localeCompare(right.mod);
    }
    const a = key === "hosts" ? hostLine(left) : left.mod;
    const b = key === "hosts" ? hostLine(right) : right.mod;
    return a.localeCompare(b) * sign;
  });
  return copy;
}

export function windowRows<T>(rows: T[], scrollTop: number, viewHeight: number, rowHeight: number): { start: number; end: number; items: T[] } {
  if (viewHeight <= 0 || rowHeight <= 0) return { start: 0, end: rows.length, items: rows };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight));
  const count = Math.ceil(viewHeight / rowHeight) + 1;
  const end = Math.min(rows.length, start + count);
  return { start, end, items: rows.slice(start, end) };
}

export function spanTops(heights: number[]): number[] {
  const tops: number[] = [];
  let offset = 0;
  for (const height of heights) {
    tops.push(offset);
    offset += height;
  }
  return tops;
}

export function windowSpans(heights: number[], scrollTop: number, viewHeight: number): { start: number; end: number; total: number } {
  let total = 0;
  for (const height of heights) total += height;
  if (viewHeight <= 0 || heights.length === 0) return { start: 0, end: heights.length, total };
  let start = heights.length;
  let offset = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index] as number;
    if (offset + height > scrollTop) {
      start = index;
      break;
    }
    offset += height;
  }
  if (start === heights.length) return { start, end: heights.length, total };
  let end = start;
  let seen = 0;
  while (end < heights.length && seen < viewHeight) {
    seen += heights[end] as number;
    end += 1;
  }
  if (end < heights.length) end += 1;
  return { start, end, total };
}

export function panelHeight(hosts: number, failed: number, width: number): number {
  const list = 40 + hosts * 44;
  const actions = failed > 0 ? 60 : 56;
  return list + actions + (width >= 840 ? 28 : 36);
}

export type HostRunState = "queued" | "sending" | "sent" | "failed";

export type HostRun = { id: PlatformId; name: string; state: HostRunState };

export function markRun(hosts: HostRun[], id: PlatformId, state: HostRunState): HostRun[] {
  return hosts.map((host) => (host.id === id ? { ...host, state } : host));
}

export function runLabel(state: HostRunState): string {
  if (state === "queued") return "Waiting";
  if (state === "sending") return "Sending";
  if (state === "sent") return "Sent";
  return "Failed";
}

export function addNoteLink<T extends { links: { host: string; url: string }[] }>(note: T, host: string, url: string): T {
  if (note.links.some((link) => link.host === host)) return note;
  return { ...note, links: [...note.links, { host, url }] };
}

export function markHost(row: Deployment, id: PlatformId, patch: { status: "success"; message: string; url: string }): Deployment {
  const hosts = row.hosts.map((host) => (host.id === id ? { ...host, ...patch } : host));
  const updated = hosts.find((host) => host.id === id && host.status === "success");
  const note = updated ? addNoteLink(row.note, updated.name, updated.url) : row.note;
  return { ...row, hosts, note };
}

export function noteText(note: DeployNote): string {
  const name = note.name.trim() || "Untitled mod";
  const version = note.version.trim();
  const notes = note.notes.trim();
  const places = note.links
    .map((link) => [link.host.trim(), link.url.trim()].filter(Boolean).join("\n"))
    .filter(Boolean);
  return [name, version ? `Version ${version}` : "", notes, ...places].filter(Boolean).join("\n\n");
}

export async function copyNote(note: DeployNote): Promise<void> {
  const write = navigator.clipboard?.writeText;
  if (!write) return;
  await write.call(navigator.clipboard, noteText(note));
}

export function rememberDeployment(list: Deployment[], row: Deployment | null): Deployment[] {
  if (!row) return list;
  return [row, ...list];
}

export function adoptDeployment(row: Deployment | null, current: string | null): string | null {
  if (!row) return current;
  return row.id;
}

export function shouldReleaseHold(results: { status: string }[]): boolean {
  return !results.some((result) => result.status === "error");
}

export function hostsOf(list: Deployment[], id: string): DeployHost[] {
  const row = list.find((item) => item.id === id);
  return row ? row.hosts : [];
}

export function releaseAfterRetry(hosts: { status: string }[]): boolean {
  return hosts.length > 0 && shouldReleaseHold(hosts);
}

export function retryArchive(name: string, autoZip: boolean, zipName: string): { fileName: string; zip: boolean } {
  if (!autoZip || fileExtension(name) === ".zip") return { fileName: name, zip: false };
  return { fileName: archiveName([name], zipName), zip: true };
}

export function retrySpec(
  row: { modId: string; mod: string; note: { version: string; notes: string } },
  mods: { id: string; name: string; autoZip: boolean; zipName: string; version: string; changelog: string }[],
  fileName: string,
): { fileName: string; zip: boolean; version: string; changelog: string; autoZip: boolean; zipName: string } {
  const mod = mods.find((item) => item.id === row.modId) ?? mods.find((item) => item.name === row.mod);
  const autoZip = mod ? mod.autoZip : false;
  const zipName = mod ? mod.zipName : "";
  const archive = retryArchive(fileName, autoZip, zipName);
  return {
    fileName: archive.fileName,
    zip: archive.zip,
    version: row.note.version || (mod ? mod.version : ""),
    changelog: row.note.notes || (mod ? mod.changelog : ""),
    autoZip,
    zipName,
  };
}

export function canRetryHeld(
  rowId: string,
  activeId: string | null,
  held: { file: Blob | null; zip: Blob | null; sources: number } | null,
): boolean {
  if (rowId !== activeId) return false;
  if (!held) return false;
  if (held.file) return true;
  if (held.zip) return true;
  return held.sources > 0;
}
