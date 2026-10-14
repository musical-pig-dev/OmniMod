export function revisionLabel(sha: string | undefined): string {
  const value = (sha ?? "").trim();
  if (!value || value === "local") return "local";
  return value.slice(0, 7);
}

export function revisionHref(sha: string | undefined, repository: string | undefined): string | null {
  const commit = (sha ?? "").trim();
  const repo = (repository ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!commit || commit === "local" || !repo || repo.includes(" ") || repo.split("/").length !== 2) return null;
  return `https://github.com/${repo}/commit/${commit}`;
}
