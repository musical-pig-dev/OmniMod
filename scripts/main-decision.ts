import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { decideMainBuild, testConclusion, type DevelopTestConclusion } from "../src/lib/omnimod/ci-gate.ts";

function sh(command: string): string {
  return execSync(command, { encoding: "utf8" }).trim();
}

const mainTree = sh("git rev-parse HEAD^{tree}");
let developTree = "";
let developTests: DevelopTestConclusion = "none";

try {
  sh("git fetch origin develop");
  developTree = sh("git rev-parse origin/develop^{tree}");
  const sha = sh("git rev-parse origin/develop");
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    const conclusion = sh(
      `gh api "repos/${repo}/commits/${sha}/check-runs" --jq '[.check_runs[] | select(.name=="test")][0].conclusion // "none"'`,
    );
    developTests = testConclusion(conclusion);
  }
} catch {
  developTree = "";
  developTests = "none";
}

const decision = decideMainBuild({ mainTree, developTree, developTests });
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decision}\n`);
}
console.log(decision);
