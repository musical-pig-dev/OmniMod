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
