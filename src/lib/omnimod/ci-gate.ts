export type DevelopTestConclusion = "success" | "failure" | "pending" | "none";

export type MainDecision = "build-extension" | "run-tests";

export function testConclusion(value: string | null | undefined): DevelopTestConclusion {
  const text = (value ?? "").trim();
  if (text === "success") return "success";
  if (text === "failure" || text === "cancelled" || text === "timed_out" || text === "startup_failure") {
    return "failure";
  }
  if (!text || text === "none" || text === "null") return "none";
  return "pending";
}

export function decideMainBuild(args: {
  mainTree: string;
  developTree: string;
  developTests: DevelopTestConclusion;
}): MainDecision {
  const mainTree = args.mainTree.trim();
  const developTree = args.developTree.trim();
  if (mainTree.length > 0 && mainTree === developTree && args.developTests === "success") {
    return "build-extension";
  }
  return "run-tests";
}
