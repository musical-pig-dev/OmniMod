import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(path.resolve("package.json"));

function linuxSuffix() {
  if (process.platform !== "linux") return "";
  if (process.arch === "arm") return "gnueabihf";
  let text = "";
  try {
    text = execFileSync("ldd", ["--version"], { encoding: "utf8" });
  } catch (error) {
    text = `${error.stdout ?? ""} ${error.stderr ?? ""}`;
  }
  return text.toLowerCase().includes("musl") ? "musl" : "gnu";
}

function oxidePackage() {
  const version = require("@tailwindcss/oxide/package.json").version;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "arm" ? "arm" : "x64";
  if (process.platform === "linux") return `@tailwindcss/oxide-linux-${arch}-${linuxSuffix()}@${version}`;
  if (process.platform === "darwin") return `@tailwindcss/oxide-darwin-${arch}@${version}`;
  if (process.platform === "win32") return `@tailwindcss/oxide-win32-${arch}-msvc@${version}`;
  return `@tailwindcss/oxide-wasm32-wasi@${version}`;
}

function lightningPackage() {
  let version = "";
  try {
    version = require("@tailwindcss/node/node_modules/lightningcss/package.json").version;
  } catch {
    try {
      version = require("lightningcss/package.json").version;
    } catch {
      return null;
    }
  }
  const arch = process.arch;
  if (process.platform === "linux") return `lightningcss-linux-${arch}-${linuxSuffix()}@${version}`;
  if (process.platform === "darwin") return `lightningcss-darwin-${arch}@${version}`;
  if (process.platform === "win32") return `lightningcss-win32-${arch}-msvc@${version}`;
  return null;
}

function missing(load) {
  try {
    load();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("native binding") || message.includes("Cannot find module");
  }
}

function placePacked(spec) {
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const dir = mkdtempSync(path.join(tmpdir(), "omnimod-native-"));
  try {
    execFileSync("npm", ["pack", spec, "--silent"], { cwd: dir });
    const packed = readdirSync(dir).find((file) => file.endsWith(".tgz"));
    if (!packed) throw new Error(`Could not download ${spec}`);
    execFileSync("tar", ["-xzf", packed, "-C", dir], { cwd: dir });
    const dest = path.resolve("node_modules", name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync("mv", [path.join(dir, "package"), dest]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const specs = [];
if (missing(() => require("@tailwindcss/oxide"))) {
  const version = require("@tailwindcss/oxide/package.json").version;
  specs.push(oxidePackage(), `@tailwindcss/oxide-wasm32-wasi@${version}`);
}
if (missing(() => require("@tailwindcss/node/node_modules/lightningcss"))) {
  const spec = lightningPackage();
  if (spec) specs.push(spec);
}
for (const spec of specs) placePacked(spec);
