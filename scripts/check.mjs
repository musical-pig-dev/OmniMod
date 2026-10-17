import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function branchName() {
  try {
    const name = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (name && name !== "HEAD") return name;
  } catch {
    // Not a git checkout. The pass line stays unnamed.
  }
  return (process.env.GITHUB_HEAD_REF || "").trim();
}

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

function fail(result) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status || 1);
}

const lint = run([path.join(root, "node_modules", "eslint", "bin", "eslint.js"), ".", "--max-warnings", "0"]);
if (lint.status !== 0) fail(lint);

const coverage = run([
  path.join(root, "node_modules", "vitest", "vitest.mjs"),
  "run",
  "--coverage",
  "--reporter=dot",
  "--coverage.reporter=text-summary",
]);
if (coverage.status !== 0) fail(coverage);

const branch = branchName();
const line = branch ? `lint and coverage passed on ${branch}` : "lint and coverage passed";
const color = process.stdout.isTTY ? "\x1b[1;32m" : "";
const reset = color ? "\x1b[0m" : "";
process.stdout.write(`\n${color}${line}${reset}\n\n`);
