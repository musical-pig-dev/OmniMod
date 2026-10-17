import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Search, Trash2 } from "lucide-react";
import type { PlatformId } from "@/lib/omnimod/catalog";
import {
  copyNote,
  failedHosts,
  runLabel,
  searchDeployments,
  sortDeployments,
  spanTops,
  whenLabel,
  windowSpans,
  panelHeight,
  type DeployNote,
  type DeploySortKey,
  type Deployment,
  type HostRun,
} from "@/lib/omnimod/history";

export const ROW_HEIGHT = 72;

const CHIPS: { key: DeploySortKey; label: string }[] = [
  { key: "mod", label: "Mod" },
  { key: "hosts", label: "Hosts" },
  { key: "when", label: "When" },
  { key: "failed", label: "Failed" },
];

const SORTS: { key: DeploySortKey; label: string }[] = [
  { key: "mod", label: "Mod" },
  { key: "when", label: "When" },
  { key: "failed", label: "Failed" },
];

const COLS =
  "grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_2.5rem] gap-x-3 sm:grid-cols-[2.75rem_minmax(0,1.5fr)_12rem_6.5rem_2.75rem] sm:gap-3";

export function DeployTable({
  rows,
  notice,
  run,
  onDelete,
  onRetry,
  onCopy,
}: {
  rows: Deployment[];
  notice: string;
  run: HostRun[] | null;
  onDelete: (ids: string[]) => void;
  onRetry: (rowId: string, ids: PlatformId[]) => void;
  onCopy: (note: DeployNote) => void;
}) {
  const [query, setQuery] = useState("");
  const [columns, setColumns] = useState<DeploySortKey[]>([]);
  const [sortKey, setSortKey] = useState<DeploySortKey>("when");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PlatformId[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = run !== null;
  const shown = useMemo(() => sortDeployments(searchDeployments(rows, query, columns), sortKey, dir), [rows, query, columns, sortKey, dir]);
  const heights = shown.map((row) =>
    ROW_HEIGHT + (openId === row.id ? panelHeight(row.hosts.length, failedHosts(row).length, window.innerWidth) : 0),
  );
  const frame = windowSpans(heights, scrollTop, viewHeight);
  const tops = spanTops(heights);
  const windowed = shown.slice(frame.start, frame.end);
  const allPicked = shown.length > 0 && shown.every((row) => picked.includes(row.id));
  const finished = run ? run.filter((host) => host.state === "sent" || host.state === "failed").length : 0;
  const scope = CHIPS.filter((chip) => columns.includes(chip.key))
    .map((chip) => chip.label)
    .join(", ");

  useEffect(() => {
    setPicked((current) => current.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  useEffect(() => {
    const node = scroller.current!;
    const measure = () => setViewHeight(node.clientHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function toggleSort(key: DeploySortKey) {
    if (sortKey === key) setDir((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("asc");
    }
  }

  function toggleOpen(id: string) {
    setChosen([]);
    setOpenId((current) => (current === id ? null : id));
  }

  function toggleChip(key: DeploySortKey) {
    setColumns((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function toggleHost(id: PlatformId) {
    setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <section className={`relative mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col self-center overflow-hidden rounded-[28px] border border-brass/40 bg-panel ${busy ? "pointer-events-none" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-4 sm:flex-nowrap sm:px-5">
        <h2 className="shrink-0 font-display text-3xl tracking-tight text-ivory">Deployments</h2>
        <div className="flex min-h-12 min-w-0 flex-1 basis-full flex-col gap-2 rounded-3xl border border-line bg-ink px-3 py-2 focus-within:border-brass sm:basis-auto sm:flex-row sm:items-center sm:gap-2 sm:rounded-full sm:py-0 sm:pr-1.5 sm:pl-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="size-4 shrink-0 text-mist" aria-hidden="true" />
            <input
              aria-label="Search deployments"
              value={query}
              disabled={busy}
              placeholder={scope ? `Search ${scope}` : "Search all columns"}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-ivory outline-none placeholder:text-mist disabled:text-mist"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {CHIPS.map((chip) => {
              const on = columns.includes(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggleChip(chip.key)}
                  className={`h-8 rounded-full px-3 text-sm font-medium ${on ? "bg-brass text-brass-ink" : "text-ivory hover:bg-raised"}`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          disabled={busy || picked.length === 0}
          onClick={() => onDelete(picked)}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full border border-line px-4 text-sm text-ivory disabled:cursor-not-allowed disabled:text-mist"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete selected
        </button>
      </div>
      {notice ? <p className="px-5 pt-3 text-sm text-brass">{notice}</p> : null}
      <div className={`grid items-center border-b border-line px-3 py-3 sm:px-5 ${COLS}`}>
        <label className="grid place-items-center">
          <input
            type="checkbox"
            aria-label="Select all deployments"
            checked={allPicked}
            disabled={busy || shown.length === 0}
            onChange={(event) => setPicked(event.target.checked ? shown.map((row) => row.id) : [])}
            className="size-5 rounded-md border-brass/80 bg-ink text-brass accent-brass"
          />
        </label>
        {SORTS.map((column) => (
          <button
            key={column.key}
            type="button"
            disabled={busy}
            aria-label={`Sort ${column.label}`}
            onClick={() => toggleSort(column.key)}
            className={`${column.key === "when" ? "hidden sm:block" : ""} w-full text-sm font-medium sm:text-base ${column.key === "failed" ? "text-center" : "text-left"} ${sortKey === column.key ? "text-brass" : "text-ivory"}`}
          >
            {column.label}
            {sortKey === column.key ? (dir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
        <span className="sr-only">Details</span>
      </div>
      <div
        ref={scroller}
        data-testid="deploy-scroll"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-ivory">No deployments match.</p>
        ) : (
          <div className="relative" style={{ height: frame.total }}>
            {windowed.map((row, index) => {
              const failed = failedHosts(row);
              const open = openId === row.id;
              const top = tops[frame.start + index] as number;
              return (
                <div key={row.id} className="absolute inset-x-0 border-b border-line" style={{ top, height: heights[frame.start + index] }}>
                  <div className={`grid h-[72px] items-center px-3 sm:px-5 ${COLS}`}>
                    <label className="grid place-items-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.id}`}
                        checked={picked.includes(row.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setPicked((current) => (event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)))
                        }
                        className="size-5 rounded-md border-brass/80 bg-ink text-brass accent-brass"
                      />
                    </label>
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-ivory">{row.mod}</p>
                      <p className="truncate text-sm tabular-nums text-mist sm:hidden">{whenLabel(row.when)}</p>
                    </div>
                    <p className="hidden truncate text-base tabular-nums text-ivory sm:block">{whenLabel(row.when)}</p>
                    <p className={`text-center text-lg font-medium tabular-nums ${failed.length ? "text-bad" : "text-ok"}`}>{failed.length}</p>
                    <button
                      type="button"
                      disabled={busy}
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${row.id}`}
                      onClick={() => toggleOpen(row.id)}
                      className="grid size-11 place-items-center rounded-full text-ivory hover:bg-ink"
                    >
                      <ChevronDown className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                  </div>
                  {open ? (
                    <div className="overflow-hidden px-4 pb-5 pt-3" style={{ height: (heights[frame.start + index] as number) - ROW_HEIGHT }}>
                      <p className="text-sm font-medium text-ivory">Hosts</p>
                      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-ink">
                        {row.hosts.map((host) => {
                          const on = chosen.includes(host.id);
                          return (
                            <li key={host.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                              {host.status === "error" ? (
                                <button
                                  type="button"
                                  aria-pressed={on}
                                  aria-label={`Rerun ${host.name}`}
                                  onClick={() => toggleHost(host.id)}
                                  className={`grid size-5 shrink-0 place-items-center rounded-md border ${on ? "border-brass bg-brass text-brass-ink" : "border-line text-ivory"}`}
                                >
                                  {on ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                                </button>
                              ) : (
                                <span className="size-5 shrink-0" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-ivory">{host.name}</span>
                              <span className={`shrink-0 font-medium ${host.status === "error" ? "text-bad" : "text-ok"}`}>
                                {host.status === "error" ? "Failed" : "Sent"}
                              </span>
                              {host.status === "error" ? (
                                <span className="max-w-[45%] truncate text-mist">{host.message || "No detail"}</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {failed.length > 0 ? (
                          <button
                            type="button"
                            disabled={chosen.length === 0}
                            onClick={() => onRetry(row.id, failed.filter((host) => chosen.includes(host.id)).map((host) => host.id))}
                            className="h-9 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-mist"
                          >
                            Run
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Copy release notes for ${row.id}`}
                          onClick={() => {
                            void copyNote(row.note);
                            onCopy(row.note);
                            setCopied(row.id);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3 text-sm text-ivory"
                        >
                          {copied === row.id ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                          {copied === row.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {run ? (
        <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-ink/80 px-6 backdrop-blur-sm" aria-label="Upload progress">
          <div className="w-full max-w-md rounded-[28px] border border-brass/50 bg-panel p-6 shadow-[0_0_48px_rgba(212,160,84,0.18)]">
            <p className="font-display text-3xl tracking-tight text-ivory">Sending</p>
            <p className="mt-1 text-sm text-ivory">
              {finished} of {run.length}
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brass" style={{ width: `${(finished / run.length) * 100}%` }} />
            </div>
            <ul className="mt-4 grid gap-2">
              {run.map((host) => (
                <li key={host.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-ink px-3 py-2.5">
                  <span className="text-sm text-ivory">{host.name}</span>
                  <span className={`text-sm font-medium ${host.state === "sent" ? "text-ok" : host.state === "failed" ? "text-bad" : "text-brass"}`}>
                    {runLabel(host.state)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
