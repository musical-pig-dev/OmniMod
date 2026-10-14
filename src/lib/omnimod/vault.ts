import { defaultConfigs } from "./catalog.ts";
import { hydrateMod, type ModRecord } from "./mods.ts";

export const VAULT_KEY = "omnimod-vault-v2";

export type VaultPayload = { mods: ModRecord[]; activeId: string };

type Sealed = { v: 1; iv: string; data: string };

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function createRecoveryKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes);
}

export async function importRecoveryKey(secret: string): Promise<CryptoKey | null> {
  try {
    const raw = b64ToBytes(secret.trim());
    if (raw.length !== 32) return null;
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

export async function seal(key: CryptoKey, payload: VaultPayload): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const sealed: Sealed = { v: 1, iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(cipher)) };
  return JSON.stringify(sealed);
}

export function readPayload(value: unknown): VaultPayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { mods?: unknown; activeId?: unknown };
  if (!Array.isArray(raw.mods)) return null;
  const configs = defaultConfigs();
  const mods = raw.mods.map((mod) => hydrateMod(mod as ModRecord, configs));
  const activeId = typeof raw.activeId === "string" && mods.some((mod) => mod.id === raw.activeId) ? raw.activeId : (mods[0]?.id ?? "");
  return { mods, activeId };
}

export async function openVault(secret: string, sealed: string): Promise<{ key: CryptoKey; payload: VaultPayload } | null> {
  const key = await importRecoveryKey(secret);
  if (!key) return null;
  try {
    const parsed = JSON.parse(sealed) as Partial<Sealed>;
    if (parsed.v !== 1 || !parsed.iv || !parsed.data) return null;
    const iv = b64ToBytes(parsed.iv);
    const data = b64ToBytes(parsed.data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    const payload = readPayload(JSON.parse(new TextDecoder().decode(plain)));
    if (!payload) return null;
    return { key, payload };
  } catch {
    return null;
  }
}
