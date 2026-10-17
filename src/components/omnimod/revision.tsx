import { useEffect, useState } from "react";
import { Bug } from "lucide-react";
import { BUG_BOARD, openBugs } from "@/lib/omnimod/bugs";
import { revisionHref, revisionLabel } from "@/lib/omnimod/revision";

export function RevisionLink({
  sha = import.meta.env.VITE_GIT_SHA as string | undefined,
  repository = import.meta.env.VITE_GITHUB_REPOSITORY as string | undefined,
  bugs,
}: {
  sha?: string;
  repository?: string;
  bugs?: number | null;
}) {
  const label = revisionLabel(sha);
  const href = revisionHref(sha, repository);
  const [count, setCount] = useState(typeof bugs === "number" ? bugs : 0);
  const className =
    "rounded-full border border-line bg-panel px-3 py-1 font-mono text-xs text-mist hover:text-ivory";
  const hash = href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer" title={sha}>
      {label}
    </a>
  ) : (
    <span className={className}>{label}</span>
  );

  useEffect(() => {
    if (typeof bugs === "number") {
      setCount(bugs);
      return;
    }
    let cancel = false;
    void openBugs().then((value) => {
      if (!cancel) setCount(value);
    });
    return () => {
      cancel = true;
    };
  }, [bugs]);

  const pill =
    count > 0 ? (
      <a
        href={BUG_BOARD}
        target="_blank"
        rel="noreferrer"
        aria-label={count === 1 ? "1 open bug" : `${count} open bugs`}
        className="inline-flex items-center gap-1 rounded-full border border-bad/40 bg-panel px-2 py-1 text-xs text-bad"
      >
        <Bug className="size-3.5" aria-hidden="true" />
        {count > 1 ? <span>{count}</span> : null}
      </a>
    ) : null;

  return (
    <div className="fixed right-3 bottom-3 z-40 flex items-center gap-3">
      <a
        href="https://www.musical-pig.com"
        target="_blank"
        rel="noreferrer"
        className="text-xs text-mist"
      >
        © 2026 Musical Pig LLC
      </a>
      {pill}
      {hash}
    </div>
  );
}
