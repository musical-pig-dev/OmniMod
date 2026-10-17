export const BUG_BOARD =
  "https://github.com/musical-pig-dev/OmniMod/issues?q=is%3Aissue+is%3Aopen+label%3Abug";

const BUG_QUERY = `https://api.github.com/search/issues?q=${encodeURIComponent("repo:musical-pig-dev/OmniMod is:issue is:open label:bug")}`;

type BugResponse = { ok: boolean; json: () => Promise<unknown> };

let cached: Promise<number> | null = null;

export function resetBugLookup(): void {
  cached = null;
}

function countFrom(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const total = (body as { total_count?: unknown }).total_count;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total);
}

export async function openBugs(
  fetchImpl?: (url: string, init?: { headers?: Record<string, string> }) => Promise<BugResponse>,
): Promise<number> {
  if (!fetchImpl) {
    cached ??= openBugs(globalThis.fetch.bind(globalThis));
    return cached;
  }
  try {
    const response = await fetchImpl(BUG_QUERY, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return 0;
    try {
      return countFrom(await response.json());
    } catch {
      return 0;
    }
  } catch {
    return 0;
  }
}
