const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  CRC_TABLE[index] = crc;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export function archiveName(names: string[], requested: string): string {
  const typed = requested.trim();
  if (typed) return typed.toLowerCase().endsWith(".zip") ? typed : `${typed}.zip`;
  const first = names[0]?.trim() ?? "";
  if (!first) return "package.zip";
  const dot = first.lastIndexOf(".");
  const base = dot > 0 ? first.slice(0, dot) : first;
  return `${base}.zip`;
}

export type ZipEntry = { name: string; bytes: Uint8Array };

/** Store the files at the root of one zip. No folders. */
export function makeZip(entries: ZipEntry[], name: string): File {
  const encoded = entries.map((entry) => ({
    name: new TextEncoder().encode(entry.name),
    bytes: entry.bytes,
    crc: crc32(entry.bytes),
  }));
  let size = 22;
  for (const entry of encoded) size += 30 + entry.name.length + entry.bytes.length + 46 + entry.name.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const locals: number[] = [];
  for (const entry of encoded) {
    locals.push(offset);
    u32(view, offset, 0x04034b50);
    u16(view, offset + 4, 20);
    u16(view, offset + 6, 0x0800);
    u16(view, offset + 8, 0);
    u16(view, offset + 10, 0);
    u16(view, offset + 12, 0);
    u32(view, offset + 14, entry.crc);
    u32(view, offset + 18, entry.bytes.length);
    u32(view, offset + 22, entry.bytes.length);
    u16(view, offset + 26, entry.name.length);
    u16(view, offset + 28, 0);
    bytes.set(entry.name, offset + 30);
    bytes.set(entry.bytes, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.bytes.length;
  }
  const central = offset;
  encoded.forEach((entry, index) => {
    u32(view, offset, 0x02014b50);
    u16(view, offset + 4, 20);
    u16(view, offset + 6, 20);
    u16(view, offset + 8, 0x0800);
    u16(view, offset + 10, 0);
    u16(view, offset + 12, 0);
    u16(view, offset + 14, 0);
    u32(view, offset + 16, entry.crc);
    u32(view, offset + 20, entry.bytes.length);
    u32(view, offset + 24, entry.bytes.length);
    u16(view, offset + 28, entry.name.length);
    u16(view, offset + 30, 0);
    u16(view, offset + 32, 0);
    u16(view, offset + 34, 0);
    u16(view, offset + 36, 0);
    u32(view, offset + 38, 0);
    u32(view, offset + 42, locals[index]);
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  u32(view, offset, 0x06054b50);
  u16(view, offset + 8, encoded.length);
  u16(view, offset + 10, encoded.length);
  u32(view, offset + 12, offset - central);
  u32(view, offset + 16, central);
  return new File([bytes], name, { type: "application/zip" });
}

export function readStoredZip(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) return entries;
    if (signature !== 0x04034b50) return null;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    if (method !== 0 || flags & 0x0008) return null;
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extra;
    if (start + size > bytes.length) return null;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    if (name && !name.endsWith("/")) entries.push({ name, bytes: bytes.slice(start, start + size) });
    offset = start + size;
  }
  return entries.length > 0 ? entries : null;
}

function packageTitle(fileName: string): string {
  const stem = fileName.replace(/\.zip$/i, "");
  const slash = Math.max(stem.lastIndexOf("/"), stem.lastIndexOf("\\"));
  const base = slash >= 0 ? stem.slice(slash + 1) : stem;
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, "");
  return cleaned || "Package";
}

function packageVersion(version: string): string {
  return version.trim().match(/\d+\.\d+\.\d+/)?.[0] ?? "1.0.0";
}

function packageDescription(changelog: string, title: string): string {
  const text = changelog.trim().replace(/\s+/g, " ").slice(0, 250);
  return text || title;
}

export const THUNDERSTORE_ICON = 256;
const ICON_BYTES = 512 * 1024;

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) return null;
  return { width, height };
}

/** A Thunderstore icon is a PNG no larger than 256×256, small enough to keep in an export. */
export function pngIconFits(bytes: Uint8Array): boolean {
  const size = pngSize(bytes);
  if (!size || bytes.length > ICON_BYTES) return false;
  return size.width <= THUNDERSTORE_ICON && size.height <= THUNDERSTORE_ICON;
}

const THUNDERSTORE_ROOT = ["icon.png", "README.md", "manifest.json"] as const;

/** Add the Thunderstore root files when this stored zip does not already have them. */
export function completeThunderstoreZip(
  bytes: Uint8Array,
  input: { fileName: string; version: string; changelog: string },
  icon: Uint8Array | null = null,
): File | null {
  const entries = readStoredZip(bytes);
  if (!entries) return null;
  const present = new Set(entries.map((entry) => entry.name));
  const missing = THUNDERSTORE_ROOT.filter((name) => !present.has(name));
  if (missing.length === 0) return null;
  const title = packageTitle(input.fileName);
  const version = packageVersion(input.version);
  const description = packageDescription(input.changelog, title);
  const next = [...entries];
  if (missing.includes("manifest.json")) {
    const manifest = {
      name: title,
      version_number: version,
      website_url: "",
      description,
      dependencies: [],
    };
    next.push({ name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  }
  if (missing.includes("README.md")) {
    const readme = input.changelog.trim() || title;
    next.push({ name: "README.md", bytes: new TextEncoder().encode(readme) });
  }
  if (missing.includes("icon.png") && icon && icon.length > 0) next.push({ name: "icon.png", bytes: icon });
  const label = input.fileName.trim() || "package.zip";
  return makeZip(next, label.toLowerCase().endsWith(".zip") ? label : `${label}.zip`);
}
