/**
 * Gate decision. Writes run_tests and build.
 *
 * - pull_request: run tests, do not build
 * - push to main: always build. Skip tests only when this tree is the
 *   develop tree and the develop test check already succeeded.
 * - anything else: run tests. Never leave both jobs skipped.
 */

import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  console.log(`decision: ${name}=${value}`);
}

function sh(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function conclusion(value) {
  const text = String(value || "").trim();
  if (text === "success") return "success";
  if (text === "failure" || text === "cancelled" || text === "timed_out" || text === "startup_failure") {
    return "failure";
  }
  if (!text || text === "none" || text === "null") return "none";
  return "pending";
}

const event = process.env.GITHUB_EVENT_NAME || "";
const ref = process.env.GITHUB_REF || "";

if (event === "pull_request") {
  setOutput("run_tests", "true");
  setOutput("build", "false");
} else if (event === "push" && ref === "refs/heads/main") {
  let sameTree = false;
  let developTests = "none";
  try {
    sh("git fetch origin develop");
    const mainTree = sh("git rev-parse HEAD^{tree}");
    const developTree = sh("git rev-parse origin/develop^{tree}");
    sameTree = mainTree.length > 0 && mainTree === developTree;
    const sha = sh("git rev-parse origin/develop");
    const repo = process.env.GITHUB_REPOSITORY;
    if (repo) {
      const result = sh(
        `gh api "repos/${repo}/commits/${sha}/check-runs" --jq '[.check_runs[] | select(.name=="test")][0].conclusion // "none"'`,
      );
      developTests = conclusion(result);
    }
  } catch (err) {
    console.log(`develop check failed, will run tests: ${err && err.message ? err.message : err}`);
  }
  setOutput("run_tests", sameTree && developTests === "success" ? "false" : "true");
  setOutput("build", "true");
} else {
  setOutput("run_tests", "true");
  setOutput("build", "false");
}
