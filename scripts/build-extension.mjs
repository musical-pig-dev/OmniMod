import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const root = process.cwd();
const folder = path.join(root, "dist", "chrome");
const zip = path.join(root, "omnimod-chrome.zip");

execFileSync("npx", ["vite", "build", "--config", "vite.chrome.config.ts"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

function listed(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...listed(full));
    else found.push(full);
  }
  return found;
}

function stamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function pack(from, dest) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const full of listed(from)) {
    const rel = path.relative(from, full).split(path.sep).join("/");
    const data = readFileSync(full);
    const compressed = deflateRawSync(data);
    const name = Buffer.from(rel);
    const when = stamp(new Date());
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(when.time, 10);
    local.writeUInt16LE(when.day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.concat([local, name, compressed]);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(when.time, 12);
    head.writeUInt16LE(when.day, 14);
    head.writeUInt32LE(sum, 16);
    head.writeUInt32LE(compressed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([head, name]));
    parts.push(record);
    offset += record.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(dest, Buffer.concat([...parts, directory, end]));
}

rmSync(zip, { force: true });
pack(folder, zip);

console.log("");
console.log(`Load this folder in Chrome: ${folder}`);
console.log(`Or unzip this and load that folder: ${zip}`);
