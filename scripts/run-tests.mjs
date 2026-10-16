import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function walk(dir, match, found = []) {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, match, found);
    else if (match(name)) found.push(full);
  }
  return found;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const scriptTests = walk("scripts", (name) => name.endsWith(".test.mjs")).filter((file) => path.basename(file) !== "run-tests.mjs");
if (scriptTests.length > 0) run(["--test", ...scriptTests]);

const nodeTests = [
  "src/lib/app-data/app-data.test.ts",
  "src/lib/app-data/readiness-schedule.test.ts",
  "src/lib/auth/gate-identity.test.ts",
  "src/lib/auth/sign-in-gate.test.ts",
  "src/lib/preview-path-prefix.test.ts",
].filter((file) => existsSync(file));
if (nodeTests.length > 0) run(["--experimental-strip-types", "--test", ...nodeTests]);

const vitest = path.join("node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitest)) {
  console.error("vitest is not installed. Run npm ci first.");
  process.exit(1);
}
run([vitest, "run", "--coverage"]);
