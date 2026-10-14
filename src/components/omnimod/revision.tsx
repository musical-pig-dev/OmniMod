import { revisionHref, revisionLabel } from "@/lib/omnimod/revision";

export function RevisionLink({
  sha = import.meta.env.VITE_GIT_SHA as string | undefined,
  repository = import.meta.env.VITE_GITHUB_REPOSITORY as string | undefined,
}: {
  sha?: string;
  repository?: string;
}) {
  const label = revisionLabel(sha);
  const href = revisionHref(sha, repository);
  const className =
    "fixed right-3 bottom-3 z-20 rounded-full border border-line bg-panel px-3 py-1 font-mono text-xs text-mist hover:text-ivory";
  if (!href) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" title={sha}>
      {label}
    </a>
  );
}
