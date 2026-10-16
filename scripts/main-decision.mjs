import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";

function sh(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function testConclusion(value) {
  const text = (value ?? "").trim();
  if (text === "success") return "success";
  if (text === "failure" || text === "cancelled" || text === "timed_out" || text === "startup_failure") {
    return "failure";
  }
  if (!text || text === "none" || text === "null") return "none";
  return "pending";
}

function decideMainBuild({ mainTree, developTree, developTests }) {
  if (mainTree.trim() && mainTree.trim() === developTree.trim() && developTests === "success") {
    return "build-extension";
  }
  return "run-tests";
}

const mainTree = sh("git rev-parse HEAD^{tree}");
let developTree = "";
let developTests = "none";

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