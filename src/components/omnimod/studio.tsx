import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Gamepad2,
  KeyRound,
  Lock,
  LockOpen,
  Package,
  PackageCheck,
  PackageX,
  Upload,
} from "lucide-react";
import {
  PLATFORMS,
  acceptFiles,
  acceptLabel,
  curseForgeOnForm,
  defaultConfigs,
  fileExtension,
  hostLimitDetail,
  isConfigured,
  platformById,
  typeBlock,
  uploadHint,
  uploadRule,
  type Platform,
  type PlatformConfig,
  type PlatformId,
} from "@/lib/omnimod/catalog";
import {
  createMod,
  lastPublished,
  nameTaken,
  normalizeConfigs,
  recordPublish,
  versionUsed,
  type ModRecord,
} from "@/lib/omnimod/mods";
import { selectTransport } from "@/lib/omnimod/live";
import {
  ACTIVE_KEY,
  MODS_KEY,
  formatBytes,
  loadConfigs,
  loadLibrary,
} from "@/lib/omnimod/storage";
import { VAULT_KEY, importRecoveryKey, openVault, seal, type VaultPayload } from "@/lib/omnimod/vault";
import { RevisionLink } from "@/components/omnimod/revision";
import { ProtectKeys, UnlockKeys } from "@/components/omnimod/vault-lock";
import { archiveName, makeZip } from "@/lib/omnimod/zip";

import {
  findOpenTicket,
  readyCount,
  runPublish,
  ticketBody,
  ticketHref,
  ticketTitle,
  withCurseForgePage,
  type PublishInput,
  type SiteResult,
  type PublishProgress,
  type Transport,
} from "@/lib/omnimod/publish";

function Mark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-full border border-brass text-brass"
    >
      <Gamepad2 className="size-5" strokeWidth={1.75} />
    </span>
  );
}

function CredentialMark({ saved }: { saved: boolean }) {
  return (
    <span
      className={`inline-flex size-8 shrink-0 items-center justify-center ${saved ? "text-brass" : "text-brass/35"}`}
      title={saved ? "Credentials saved" : "Needs credentials"}
    >
      <KeyRound className="size-4" aria-hidden="true" />
      <span className="sr-only">{saved ? "Credentials saved" : "Needs credentials"}</span>
    </span>
  );
}

export function ResultSlip({ result, index }: { result: SiteResult; index: number }) {
  const platform = PLATFORMS.find((item) => item.id === result.id);
  const name = platform?.name ?? result.id;
  const sent = result.status === "success";
  const failed = result.status === "error";
  const label = sent ? "Sent" : failed ? "Failed" : "Skipped";
  const lane = platform?.lane ?? "api";
  const short =
    failed && lane === "bot" && result.step && result.reason ? `${result.step}: ${result.reason}` : result.message;
  const [open, setOpen] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const title = ticketTitle(name, result);

  function fieldLabel(key: string): string {
    if (!platform) return key;
    const match = platform.fields.find((field) => field.key === key);
    return match ? match.label : key;
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setChecking(true);
    setTicket(null);
    void findOpenTicket(title).then((url) => {
      setTicket(url);
      setChecking(false);
    });
  }

  function create() {
    window.open(ticketHref(title, ticketBody(result), result.id), "_blank", "noopener");
  }

  function download() {
    const blob = new Blob([ticketBody(result)], { type: "text/plain" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `omnimod-${result.id}-failure.txt`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <li
      className={`rounded-2xl border bg-ink px-4 py-3 ${
        sent ? "parcel-arrive border-ok/35" : failed ? "parcel-return border-bad/40" : "parcel-held border-dashed border-line"
      }`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative grid size-12 shrink-0 place-items-center rounded-xl border ${
            sent
              ? "border-brass/50 bg-brass/10 text-brass"
              : failed
                ? "border-bad/40 bg-bad/10 text-bad"
                : "border-dashed border-line bg-panel text-mist"
          }`}
          aria-hidden="true"
        >
          <Package className="size-5" />
          {sent ? (
            <span className="parcel-seal absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-ok text-ink">
              <Check className="size-3" />
            </span>
          ) : null}
          {failed ? <span className="absolute inset-x-2 top-1/2 border-t border-bad" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ivory">{name}</p>
          <p className="mt-1 text-sm leading-relaxed text-mist">{short}</p>
          {sent && result.url ? (
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-brass"
            >
              View upload
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <span
          className={`shrink-0 -rotate-6 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${
            sent ? "border-ok/50 text-ok" : failed ? "border-bad/50 text-bad" : "border-line text-mist"
          }`}
        >
          {label}
        </span>
      </div>
      {failed ? (
        <div className="mt-3 border-t border-line pt-3">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${name} failure`}
            onClick={toggle}
            className="inline-flex items-center gap-1 text-sm text-ivory"
          >
            {open ? "Hide details" : "Show details"}
            {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
          </button>
          {open ? (
            <div className="mt-3 grid gap-2 text-sm text-mist">
              {result.step ? <p>Step: {result.step}</p> : null}
              {result.reason ? <p>Reason: {result.reason}</p> : null}
              {result.filled?.length ? <p>Filled: {result.filled.join(", ")}</p> : null}
              {result.file ? <p>File: {result.file}</p> : null}
              {result.config
                ? Object.entries(result.config).map(([key, value]) => (
                    <p key={key}>
                      {fieldLabel(key)}: {value}
                    </p>
                  ))
                : null}
              {result.logs?.length ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-panel p-3 text-xs text-ivory">
                  {result.logs.join("\n")}
                </pre>
              ) : null}
              <button type="button" onClick={download} className="h-11 rounded-full border border-line px-4 text-ivory">
                Download log
              </button>
              {checking ? (
                <p>Checking for an open ticket</p>
              ) : ticket ? (
                <a href={ticket} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass">
                  View Ticket
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              ) : (
                <button type="button" onClick={create} className="h-11 rounded-full bg-brass px-4 text-ink">
                  Create Ticket
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function FancyCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ivory">
      <span className="relative grid size-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-5 appearance-none rounded-md border border-brass/80 bg-ink outline-none checked:border-brass checked:bg-brass focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        />
        <Check
          className="pointer-events-none absolute size-3.5 text-brass-ink opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
          aria-hidden="true"
        />
      </span>
      {label}
    </label>
  );
}

function FancySelect({
  label,
  value,
  choices,
  onChange,
  disabled = false,
  blank,
  pill = false,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  blank?: string;
  pill?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const match = choices.find((choice) => choice.value === value);
  const shown = match?.label ?? blank ?? "Choose";
  const item = (selected: boolean) =>
    `flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm ${
      selected ? "bg-brass/15 text-brass" : "text-ivory hover:bg-ink"
    }`;
  return (
    <div className={`relative ${pill ? "w-44 shrink-0" : ""}`}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-11 w-full items-center justify-between gap-2 border border-line bg-ink px-3 text-left text-sm outline-none hover:border-brass focus:border-brass disabled:cursor-not-allowed disabled:text-mist disabled:hover:border-line ${
          pill ? "rounded-full" : "rounded-xl"
        } ${disabled ? "text-mist" : "text-ivory"}`}
      >
        <span className="truncate">{shown}</span>
        <ChevronDown className={`size-4 shrink-0 text-mist transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label={label}
          className={`absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-[0_16px_40px_rgba(0,0,0,0.35)] ${
            pill ? "right-0" : ""
          }`}
        >
          {blank ? (
            <li>
              <button type="button" role="option" aria-selected={value === ""} onClick={() => { onChange(""); setOpen(false); }} className={item(value === "")}>
                <span className="min-w-0 flex-1 truncate">{blank}</span>
                {value === "" ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <span className="size-4 shrink-0" />}
              </button>
            </li>
          ) : null}
          {choices.map((choice) => {
            const selected = choice.value === value;
            return (
              <li key={choice.value}>
                <button type="button" role="option" aria-selected={selected} onClick={() => { onChange(choice.value); setOpen(false); }} className={item(selected)}>
                  <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  {selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : <span className="size-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function SiteCard({
  platform,
  config,
  open,
  onToggleOpen,
  onChange,
  blocked = null,
}: {
  platform: Platform;
  config: PlatformConfig;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: PlatformConfig) => void;
  blocked?: string | null;
}) {
  const fields = platform.fields;
  const locked = Boolean(platform.later || blocked);
  const saved = isConfigured(platform, config);
  const hasValue = fields.some((field) => (config.fields[field.key] ?? "").trim().length > 0);
  const panelId = useId();
  return (
    <article className={`rounded-card border border-line bg-panel ${blocked ? "opacity-80" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggleOpen}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ivory">{platform.name}</span>
              {platform.later ? (
                <span className="text-xs uppercase tracking-wide text-mist">Later</span>
              ) : platform.lane === "bot" ? (
                <span className="text-xs uppercase tracking-wide text-mist">Bot</span>
              ) : null}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-mist">{platform.summary}</span>
            <span className="mt-1 block text-sm text-mist">{hostLimitDetail(platform.id)}</span>
            <span className="mt-1 block text-sm text-mist">{acceptLabel(platform)}</span>
            {blocked ? <span className="mt-1 block text-sm text-bad">{blocked}</span> : null}
          </span>
          <CredentialMark saved={saved && !locked} />
          <ChevronDown
            className={`size-4 shrink-0 text-mist transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? (
        <div id={panelId} className="space-y-3 border-t border-line px-4 py-4">
          {fields.map((field) => {
            const stored = (config.fields[field.key] ?? "").trim();
            return (
              <div key={field.key}>
                <span className="mb-1.5 block text-sm text-mist">{field.label}</span>
                {field.choices ? (
                  <FancySelect
                    label={field.label}
                    value={stored || field.defaultValue || ""}
                    disabled={locked}
                    choices={field.choices}
                    onChange={(next) =>
                      onChange({
                        ...config,
                        fields: { ...config.fields, [field.key]: next },
                      })
                    }
                  />
                ) : (
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    aria-label={field.label}
                    value={config.fields[field.key] ?? ""}
                    placeholder={field.placeholder}
                    disabled={locked}
                    onChange={(event) =>
                      onChange({
                        ...config,
                        fields: { ...config.fields, [field.key]: event.target.value },
                      })
                    }
                    className="h-11 w-full rounded-xl border border-line bg-ink px-3 text-ivory outline-none placeholder:text-mist/70 focus:border-brass"
                  />
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={locked || !hasValue}
              onClick={() => onChange({ ...config, fields: {} })}
              className="min-h-11 rounded-full border border-line px-4 text-sm text-ivory hover:border-brass disabled:cursor-not-allowed disabled:text-mist"
            >
              Clear
            </button>
            {platform.tokenUrl ? (
              <a
                href={platform.tokenUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brass"
              >
                {platform.tokenLabel}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CurseForgeOverride({
  value,
  onEdit,
}: {
  value: Record<string, string>;
  onEdit: (next: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const fields = platformById("curseforge").fields.filter(
    (field) => field.key !== "projectId" && field.key !== "changelogType",
  );
  return (
    <div className="mt-3 rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm text-ivory"
      >
        CurseForge
        <ChevronDown className={`size-4 text-mist transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <p className="text-sm text-mist">Empty fields use the host key.</p>
          {fields.map((field) => (
            <div key={field.key}>
              <span className="mb-1.5 block text-sm text-mist">{field.label}</span>
              {field.choices ? (
                <FancySelect
                  label={field.label}
                  value={value[field.key] ?? ""}
                  blank="Host key"
                  choices={field.choices}
                  onChange={(next) => onEdit({ ...value, [field.key]: next })}
                />
              ) : (
                <input
                  aria-label={field.label}
                  value={value[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onEdit({ ...value, [field.key]: event.target.value })}
                  className="h-11 w-full rounded-xl border border-line bg-ink px-3 text-ivory outline-none placeholder:text-mist/70 focus:border-brass"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type ReleaseNote = {
  name: string;
  version: string;
  notes: string;
  links: { host: string; url: string }[];
};

export function releasePost(note: ReleaseNote): string {
  const name = note.name.trim() || "Untitled mod";
  const version = note.version.trim();
  const notes = note.notes.trim();
  const places = note.links
    .filter((link) => link.url.trim())
    .map((link) => `${link.host}\n${link.url.trim()}`);
  return [name, version ? `Version ${version}` : "", notes, ...places].filter(Boolean).join("\n\n");
}

export function Delivery({
  fileName,
  progress,
  failures = [],
}: {
  fileName: string;
  progress: PublishProgress;
  failures?: string[];
}) {
  const remaining = Math.max(progress.total - progress.completed, 0);
  const pct = progress.total === 0 ? 0 : progress.completed / progress.total;
  const current = progress.current ? platformById(progress.current).name : null;
  const failed = progress.failed ?? 0;
  const finished = remaining === 0 && progress.total > 0;
  const sent = Math.max(progress.completed - failed, 0);
  const failureLine = failures.length > 0 ? `${failures.join(", ")} failed` : `${failed} failed`;

  return (
    <div className="px-1 py-4">
      {fileName ? <p className="truncate text-center font-display text-3xl tracking-tight text-brass">{fileName}</p> : null}
      {finished ? (
        <>
          <div className="mt-8 flex justify-center text-brass">
            {sent === 0 ? (
              <PackageX className="size-16 text-bad" aria-hidden="true" />
            ) : (
              <PackageCheck className="size-16" aria-hidden="true" />
            )}
          </div>
          {sent === 0 ? <p className="mt-5 text-center font-display text-3xl tracking-tight">Not delivered</p> : null}
          <p className="mt-2 text-center text-sm text-mist">{failed > 0 ? failureLine : `${progress.completed} of ${progress.total}`}</p>
        </>
      ) : (
        <>
          <div className="relative mx-auto mt-10 h-16 max-w-sm">
            <div className="absolute top-1/2 right-2 left-2 h-px -translate-y-1/2 bg-line" />
            <div
              className="absolute top-1/2 left-2 h-px -translate-y-1/2 bg-brass transition-[width] duration-500"
              style={{ width: `calc((100% - 1rem) * ${pct})` }}
            />
            <span className="absolute top-1/2 right-0 size-2.5 -translate-y-1/2 rounded-full border border-brass" />
            <span
              className="absolute top-1/2 -translate-y-1/2 transition-[left] duration-500"
              style={{ left: `clamp(0px, calc(${pct * 100}% - 1.375rem), calc(100% - 2.75rem))` }}
            >
              <span className="parcel-bob grid size-11 place-items-center rounded-xl border border-brass bg-ink text-brass shadow-[0_0_28px_rgba(212,160,84,0.28)]">
                <Package className="size-5" aria-hidden="true" />
              </span>
            </span>
          </div>
          <p className="mt-8 text-center font-display text-4xl tracking-tight">{remaining} remaining</p>
          <p className="mt-2 text-center text-sm text-mist">
            <span>{current ? `On the way to ${current}` : "Packing"}</span>
            <Elapsed />
          </p>
        </>
      )}
    </div>
  );
}

export function ReleaseCard({ note, plain = false }: { note: ReleaseNote; plain?: boolean }) {
  const [copied, setCopied] = useState(false);
  const post = releasePost(note);

  async function copy() {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(post);
    setCopied(true);
  }

  const body = (
    <>
      <div className={plain ? "px-1 py-2" : "border-b border-brass/30 bg-brass/10 px-5 py-4"}>
        {plain ? null : <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-brass">Release note</p>}
        <h3 className="font-display text-3xl tracking-tight text-ivory">{note.name.trim() || "Untitled mod"}</h3>
        {note.version.trim() ? <p className="mt-1 text-sm text-brass">Version {note.version.trim()}</p> : null}
      </div>
      {note.notes.trim() ? (
        <p className="whitespace-pre-wrap px-1 py-4 text-sm leading-relaxed text-ivory">{note.notes.trim()}</p>
      ) : null}
      {note.links.length > 0 ? (
        <ul className="border-t border-line">
          {note.links.map((link) => (
            <li key={`${link.host}-${link.url}`} className="border-b border-line px-1 py-3 last:border-b-0">
              <p className="text-sm text-ivory">{link.host}</p>
              <a href={link.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brass">
                {link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pt-4">
        <button
          type="button"
          onClick={() => void copy()}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brass px-5 font-medium text-brass-ink shadow-[0_0_24px_rgba(212,160,84,0.28)]"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy release note"}
        </button>
      </div>
    </>
  );
  if (plain) return <div>{body}</div>;
  return (
    <article className="overflow-hidden rounded-card border border-brass/50 bg-panel text-left shadow-[0_0_48px_rgba(212,160,84,0.16)]">
      {body}
    </article>
  );
}

function FileFolder({
  tab,
  note,
  onTab,
  children,
}: {
  tab: "delivery" | "notes";
  note: ReleaseNote | null;
  onTab: (tab: "delivery" | "notes") => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-brass/40 bg-panel shadow-[0_0_40px_rgba(212,160,84,0.08)]">
      <div className="flex" role="tablist" aria-label="Delivery folder">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "delivery"}
          onClick={() => onTab("delivery")}
          className={`px-6 py-3 font-display text-2xl ${tab === "delivery" ? "bg-panel text-ivory" : "border-b border-brass/40 bg-ink text-mist"}`}
        >
          Delivery
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notes"}
          onClick={() => onTab("notes")}
          className={`px-6 py-3 font-display text-2xl ${tab === "notes" ? "bg-panel text-ivory" : "border-b border-brass/40 bg-ink text-mist"}`}
        >
          Notes
        </button>
        <div className="flex-1 border-b border-brass/40 bg-ink" />
      </div>
      <div className="px-5 pt-4 pb-5">
        {tab === "notes" ? (
          note ? (
            <ReleaseCard note={note} plain />
          ) : (
            <p className="px-1 py-8 text-center text-sm text-mist">The note is written when delivery finishes.</p>
          )
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="text-brass"> {seconds === 0 ? "starting" : `${seconds}s`}</span>;
}

const RESULT_PILES = [
  { status: "success", label: "Passed" },
  { status: "error", label: "Failed" },
  { status: "skipped", label: "Skipped" },
] as const;

function ResultPile({ label, results }: { label: string; results: SiteResult[] }) {
  const [open, setOpen] = useState(false);
  const over = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depth = Math.min(results.length - 1, 3);

  function clearTimer() {
    if (timer.current == null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }

  function schedule() {
    clearTimer();
    timer.current = setTimeout(() => {
      setOpen(false);
    }, 5000);
  }

  useEffect(() => clearTimer, []);

  return (
    <div
      onMouseEnter={() => {
        over.current = true;
        clearTimer();
      }}
      onMouseLeave={() => {
        over.current = false;
        if (open) schedule();
      }}
    >
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-mist">{label}</p>
      {open ? (
        <ol className="space-y-2">
          {results.map((result, index) => (
            <ResultSlip key={result.id} result={result} index={index} />
          ))}
        </ol>
      ) : (
        <button
          type="button"
          aria-label={`Show ${label}`}
          onClick={() => setOpen(true)}
          className="relative block w-full text-left"
          style={{ height: 112 + depth * 18 }}
        >
          {results.slice(0, 4).map((result, index) => {
            const sent = result.status === "success";
            const failed = result.status === "error";
            return (
              <span
                key={result.id}
                className={`absolute inset-x-0 block rounded-2xl border bg-ink px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.4)] ${
                  sent ? "border-ok/35" : failed ? "border-bad/40" : "border-dashed border-line"
                }`}
                style={{ top: index * 18, zIndex: 10 - index }}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`grid size-12 shrink-0 place-items-center rounded-xl border ${
                      sent
                        ? "border-brass/50 bg-brass/10 text-brass"
                        : failed
                          ? "border-bad/40 bg-bad/10 text-bad"
                          : "border-dashed border-line bg-panel text-mist"
                    }`}
                  >
                    <Package className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ivory">{platformById(result.id).name}</span>
                    <span className="mt-1 block truncate text-sm text-mist">{result.message}</span>
                  </span>
                  <span
                    className={`shrink-0 -rotate-6 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${
                      sent ? "border-ok/50 text-ok" : failed ? "border-bad/50 text-bad" : "border-line text-mist"
                    }`}
                  >
                    {sent ? "Sent" : failed ? "Failed" : "Skipped"}
                  </span>
                </span>
              </span>
            );
          })}
        </button>
      )}
    </div>
  );
}

export function ResultDeck({ results }: { results: SiteResult[] }) {
  const piles = RESULT_PILES.map((pile) => ({
    ...pile,
    items: results.filter((result) => result.status === pile.status),
  })).filter((pile) => pile.items.length > 0);
  if (piles.length === 0) return null;
  return (
    <div className="space-y-4">
      {piles.map((pile) => (
        <ResultPile key={pile.status} label={pile.label} results={pile.items} />
      ))}
    </div>
  );
}

export function Studio({ transport }: { transport?: Transport } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const packageFile = useRef<File | null>(null);
  const packageFiles = useRef<File[]>([]);
  const vaultKey = useRef<CryptoKey | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [vault, setVault] = useState<"off" | "locked" | "open">("off");
  const [arming, setArming] = useState(false);
  const [mods, setMods] = useState<ModRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<PlatformId | null>(null);
  const [hostsOpen, setHostsOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SiteResult[] | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [shippedName, setShippedName] = useState("");
  const [releaseNote, setReleaseNote] = useState<ReleaseNote | null>(null);
  const [folder, setFolder] = useState<"delivery" | "notes">("delivery");

  const active = mods.find((mod) => mod.id === activeId) ?? mods[0];
  const hostConfigs = active?.configs ?? defaultConfigs();
  const input: PublishInput = useMemo(
    () => ({
      fileName: active?.fileName ?? "",
      version: active?.version ?? "",
      changelog: active?.changelog ?? "",
      override: active?.curseforgeOverride,
      autoZip: active?.autoZip ?? false,
      zipName: active?.zipName ?? "",
    }),
    [active],
  );
  const ready = readyCount(hostConfigs, { ...input, fileName: input.fileName || "pending" });
  const detailsReady = input.version.trim().length > 0 && input.changelog.trim().length > 0;
  const repeatVersion = versionUsed(active?.publishedVersions, input.version);
  const canPublish =
    input.fileName.trim().length > 0 && detailsReady && ready > 0 && !running && !repeatVersion;

  useEffect(() => {
    const sealed = localStorage.getItem(VAULT_KEY);
    if (sealed) {
      setVault("locked");
      setHydrated(true);
      return;
    }
    const stored = loadConfigs();
    const library = loadLibrary(stored);
    setMods(library.mods);
    setActiveId(library.activeId);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || vault === "locked") return;
    const key = vaultKey.current;
    if (vault === "open" && key) {
      let cancel = false;
      const payload: VaultPayload = { mods, activeId };
      void seal(key, payload).then((sealed) => {
        if (cancel) return;
        localStorage.setItem(VAULT_KEY, sealed);
        localStorage.removeItem(MODS_KEY);
        localStorage.removeItem(ACTIVE_KEY);
      });
      return () => {
        cancel = true;
      };
    }
    localStorage.setItem(MODS_KEY, JSON.stringify(mods));
    localStorage.setItem(ACTIVE_KEY, activeId);
  }, [mods, activeId, hydrated, vault]);

  const visibleMods = mods.filter((mod) =>
    mods.length > 20 ? mod.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );
  const rule = uploadRule(hostConfigs, input.fileName, input.autoZip);

  function patchMod(id: string, partial: Partial<ModRecord>) {
    setMods((list) => list.map((mod) => (mod.id === id ? { ...mod, ...partial } : mod)));
  }

  function update(id: PlatformId, next: PlatformConfig) {
    const current = active!;
    const saved = { ...next, enabled: true };
    patchMod(current.id, { configs: { ...current.configs, [id]: saved } });
  }

  function onFile(list: FileList | File[] | undefined) {
    const files = list ? [...list] : [];
    if (!files.length) return;
    const accepted = acceptFiles(files, rule, active.version, active.autoZip);
    if (!accepted.ok) {
      setFileError(accepted.message);
      return;
    }
    setFileError(null);
    const names = accepted.fileName.split(", ");
    const chosen = files.filter((file) => names.includes(file.name));
    const picked = chosen.length > 0 ? chosen : files;
    packageFiles.current = picked;
    packageFile.current = picked[0];
    patchMod(active.id, { fileName: accepted.fileName, version: accepted.version });
    setFileSize(accepted.size);
    setResults(null);
  }

  async function publish() {
    const version = input.version.trim();
    const sources = packageFiles.current;
    let zip: File | null = null;
    let label = input.fileName;
    const first = sources[0];
    if (input.autoZip && first && (sources.length > 1 || fileExtension(first.name) !== ".zip")) {
      const entries = [];
      for (const file of sources) entries.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      label = archiveName(
        sources.map((file) => file.name),
        input.zipName || "",
      );
      zip = makeZip(entries, label);
    }
    setShippedName(label);
    setReleaseNote(null);
    setRunning(true);
    setFolder("delivery");
    setResults(null);
    setProgress({ completed: 0, total: ready, current: null });
    try {
      const next = await runPublish({
        input,
        file: packageFile.current,
        zip,
        sources: sources.map((file) => ({ name: file.name, blob: file })),
        configs: hostConfigs,
        transport: selectTransport(transport),
        onProgress: setProgress,
      });
      const shown = next.map((result) => withCurseForgePage(result, hostConfigs.curseforge.fields.projectId ?? ""));
      setResults(shown);
      const links = shown.flatMap((result) =>
        result.status === "success" && result.url ? [{ host: platformById(result.id).name, url: result.url }] : [],
      );
      setReleaseNote(links.length > 0 ? { name: active!.name, version, notes: input.changelog, links } : null);
      if (next.some((result) => result.status === "success")) {
        packageFile.current = null;
        packageFiles.current = [];
        const recorded = recordPublish(active!, version, true);
        patchMod(active!.id, {
          fileName: recorded.fileName,
          version: recorded.version,
          changelog: recorded.changelog,
          publishedVersions: recorded.publishedVersions,
          curseforgeOverride: recorded.curseforgeOverride,
        });
        setFileSize(null);
        setFileError(null);
      }
    } finally {
      setRunning(false);
    }
  }

  const sent = results?.filter((result) => result.status === "success").length ?? 0;
  const failed = results?.filter((result) => result.status === "error").length ?? 0;
  const formOn = Boolean(active) && !hostsOpen && !libraryOpen;
  const modsOn = !hostsOpen && (libraryOpen || !active);
  const tabFace = (on: boolean) =>
    `inline-flex h-10 items-center justify-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors ${
      on ? "bg-brass text-brass-ink" : "text-ivory hover:text-brass"
    }`;

  return (
    <div className="min-h-screen overflow-x-hidden bg-ink text-ivory">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
          <div className="flex min-w-0 items-center gap-3">
            <Mark />
            <p className="font-display text-3xl leading-none tracking-tight">OmniMod</p>
            <button
              type="button"
              aria-expanded={lineOpen}
              aria-label={lineOpen ? "Hide the line" : "Show the line"}
              onClick={() => setLineOpen((open) => !open)}
              className="inline-flex min-h-11 items-center text-brass"
            >
              <span
                className={`grid transition-[grid-template-columns,opacity] duration-500 ease-out ${
                  lineOpen ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"
                }`}
              >
                <span className="overflow-hidden">
                  <span className="block whitespace-nowrap pr-2 pl-3 text-sm text-mist">
                    One archive, published to every host that is ready.
                  </span>
                </span>
              </span>
              <ChevronRight
                className={`size-5 shrink-0 transition-transform duration-500 ${lineOpen ? "translate-x-0.5" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
          <div className="inline-flex items-center rounded-full border border-line bg-panel p-1">
            <button
              type="button"
              disabled={!active}
              onClick={() => {
                setHostsOpen(false);
                setLibraryOpen(false);
              }}
              className={`${tabFace(formOn)} disabled:cursor-not-allowed disabled:text-mist disabled:hover:text-mist`}
            >
              Form
            </button>
            {progress ? null : (
              <button
                type="button"
                aria-expanded={libraryOpen}
                onClick={() => {
                  if (hostsOpen) {
                    setHostsOpen(false);
                    setLibraryOpen(true);
                    return;
                  }
                  setLibraryOpen((open) => !open);
                }}
                className={tabFace(modsOn)}
              >
                <Package className="size-4" aria-hidden="true" />
                {mods.length}
              </button>
            )}
            <button
              type="button"
              aria-expanded={hostsOpen}
              onClick={() => setHostsOpen((open) => !open)}
              className={tabFace(hostsOpen)}
            >
              <KeyRound className={`size-4 ${hostsOpen ? "text-brass-ink" : ready > 0 ? "text-brass" : "text-brass/35"}`} aria-hidden="true" />
              Hosts
              <span className={hostsOpen ? "text-brass-ink/70" : "text-mist"}>{ready}</span>
            </button>
          </div>
        </header>

        {vault === "locked" ? (
          <UnlockKeys
            onUnlock={async (secret) => {
              const sealed = localStorage.getItem(VAULT_KEY);
              if (!sealed) return false;
              const opened = await openVault(secret, sealed);
              if (!opened) return false;
              vaultKey.current = opened.key;
              setMods(opened.payload.mods);
              setActiveId(opened.payload.activeId);
              setVault("open");
              return true;
            }}
          />
        ) : arming ? (
          <ProtectKeys
            onCancel={() => setArming(false)}
            onProtect={(secret) => {
              void importRecoveryKey(secret).then((key) => {
                if (!key) return;
                vaultKey.current = key;
                setArming(false);
                setVault("open");
              });
            }}
          />
        ) : null}

        {vault === "locked" || arming ? null : hostsOpen ? (
          <section key={active?.id ?? "no-mod"} className="mx-auto w-full min-w-0 max-w-3xl space-y-3">
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-sm text-mist">
                {active ? active.name : "No mod"} · {ready} ready
                {results ? ` · ${sent} sent${failed ? ` · ${failed} failed` : ""}` : ""}
              </p>
              {active ? (
                <FancySelect
                  pill
                  label="Mod"
                  value={active.id}
                  choices={mods.map((mod) => ({ value: mod.id, label: mod.name }))}
                  onChange={(id) => {
                    setActiveId(id);
                    setOpenId(null);
                    setNameEdit(null);
                    setFileSize(null);
                    setResults(null);
                  }}
                />
              ) : null}
            </div>
            <p className="px-1 text-sm text-mist">{uploadHint(rule)}</p>
            {active ? (
              <>
                <div className="space-y-2 px-1">
                  <FancyCheck
                    label="Auto-zip"
                    checked={active.autoZip}
                    onChange={(checked) => patchMod(active.id, { autoZip: checked })}
                  />
                  {active.autoZip ? (
                    <>
                      <input
                        aria-label="Zip name"
                        value={active.zipName}
                        placeholder="First file name"
                        onChange={(event) => patchMod(active.id, { zipName: event.target.value })}
                        className="h-11 w-full rounded-xl border border-line bg-ink px-3 text-sm outline-none placeholder:text-mist/70 focus:border-brass"
                      />
                      <p className="text-sm text-mist">
                        Files that are not a zip are packed into one zip for hosts that need it.
                      </p>
                    </>
                  ) : null}
                </div>
                {(["api", "bot"] as const).map((lane) => (
                  <fieldset key={lane} className="min-w-0 rounded-2xl border border-brass/80 px-3 pt-2 pb-3">
                    <legend className="bg-ink px-2">
                      <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-brass">
                        {lane === "api" ? "API" : "Bot"}
                      </h3>
                    </legend>
                    <div className="space-y-3">
                    {PLATFORMS.filter((platform) => platform.lane === lane).map((platform) => (
                      <SiteCard
                        key={`${active.id}-${platform.id}`}
                        platform={platform}
                        config={active.configs[platform.id]}
                        open={openId === platform.id}
                        blocked={typeBlock(platform, active.configs, active.fileName, active.autoZip)}
                        onToggleOpen={() =>
                          setOpenId((current) => (current === platform.id ? null : platform.id))
                        }
                        onChange={(next) => update(platform.id, next)}
                      />
                    ))}
                    </div>
                  </fieldset>
                ))}
                <fieldset className="min-w-0 rounded-2xl border border-dashed border-brass/80 px-3 pt-2 pb-3">
                  <legend className="bg-ink px-2">
                    <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-brass">Later</h3>
                  </legend>
                  <ul className="space-y-2">
                    {PLATFORMS.filter((platform) => platform.lane === "later").map((platform) => (
                      <li key={platform.id} className="rounded-2xl border border-line bg-panel px-4 py-3">
                        <p className="font-medium">{platform.name}</p>
                        <p className="mt-1 text-sm text-mist">{platform.summary}</p>
                        <a
                          href={platform.site}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex min-h-11 items-center text-sm text-brass"
                        >
                          {platform.site}
                        </a>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </>
            ) : (
              <p className="px-1 text-sm text-mist">Add a mod before saving host keys.</p>
            )}
          </section>
        ) : null}

        {hostsOpen || vault === "locked" || arming ? null : (
        <section key={active?.id ?? "none"} className="mx-auto w-full min-w-0 max-w-xl space-y-4">
            {progress ? (
              <FileFolder tab={folder} note={releaseNote} onTab={setFolder}>
                <Delivery
                  fileName={shippedName}
                  progress={progress}
                  failures={(results ?? []).filter((result) => result.status === "error").map((result) => platformById(result.id).name)}
                />
                {running ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      setProgress(null);
                      setResults(null);
                      setReleaseNote(null);
                      setFolder("delivery");
                    }}
                    className="mt-2 min-h-11 w-full text-sm text-brass"
                  >
                    Back to package
                  </button>
                )}
              </FileFolder>
            ) : (
            <div className="rounded-card border border-line bg-panel p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                {active ? (
                  <input
                    aria-label="Mod name"
                    value={nameEdit ?? active.name}
                    onChange={(event) => setNameEdit(event.target.value)}
                    onBlur={() => {
                      const next = (nameEdit ?? active.name).trim();
                      if (next && !nameTaken(mods, next, active.id)) patchMod(active.id, { name: next });
                      setNameEdit(null);
                    }}
                    className="min-w-0 flex-1 bg-transparent font-display text-2xl text-ivory outline-none"
                  />
                ) : (
                  <h2 className="min-w-0 flex-1 font-display text-2xl">Mods</h2>
                )}
              </div>
              {active && nameEdit !== null && nameTaken(mods, nameEdit, active.id) ? (
                <p className="-mt-2 mb-3 text-sm text-bad">Already used</p>
              ) : null}
              {libraryOpen || !active ? (
                <div className="space-y-3">
                  {mods.length > 20 ? (
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a mod"
                      aria-label="Find a mod"
                      className="h-11 w-full rounded-xl border border-line bg-ink px-3 outline-none placeholder:text-mist/70 focus:border-brass"
                    />
                  ) : null}
                  <ul className="max-h-80 space-y-1 overflow-y-auto">
                    {visibleMods.map((mod) => (
                      <li key={mod.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(mod.id);
                            setNameEdit(null);
                            setFileSize(null);
                            setOpenId(null);
                            setLibraryOpen(false);
                            setResults(null);
                          }}
                          className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 text-left ${
                            mod.id === active?.id ? "bg-ink text-brass" : "hover:bg-ink"
                          }`}
                        >
                          <span className="truncate font-medium">{mod.name}</span>
                          <span className="shrink-0 text-sm text-mist">{lastPublished(mod.publishedVersions) || "—"}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Duplicate ${mod.name}`}
                          onClick={() => {
                            setNaming(true);
                            setBaseId(mod.id);
                            setDraftName("");
                          }}
                          className="shrink-0 px-1 text-sm text-brass hover:text-ivory"
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${mod.name}`}
                          onClick={() => {
                            const next = mods.filter((item) => item.id !== mod.id);
                            setMods(next);
                            if (mod.id === active?.id) setActiveId(next[0]?.id ?? "");
                            if (next.length === 0) setLibraryOpen(true);
                          }}
                          className="shrink-0 px-1 text-sm text-mist hover:text-ivory"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {visibleMods.length === 0 ? <li className="px-3 py-4 text-sm text-mist">No mods match.</li> : null}
                  </ul>
                  {naming ? (
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = draftName.trim();
                        if (!name || nameTaken(mods, name)) return;
                        const mod = createMod(name);
                        const source = mods.find((item) => item.id === baseId);
                        if (source) mod.configs = normalizeConfigs(source.configs);
                        setMods((list) => [...list, mod]);
                        setActiveId(mod.id);
                        setQuery("");
                        setDraftName("");
                        setBaseId("");
                        setNaming(false);
                        setLibraryOpen(false);
                        setFileSize(null);
                        setResults(null);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label="New mod name"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="Mod name"
                        className="h-11 w-full rounded-xl border border-line bg-ink px-3 outline-none placeholder:text-mist/70 focus:border-brass"
                      />
                      {draftName.trim() && nameTaken(mods, draftName) ? (
                        <p className="text-sm text-bad">Already used</p>
                      ) : null}
                      {mods.length > 0 ? (
                        <label className="block">
                          <span className="mb-1.5 block text-sm text-mist">Base on</span>
                          <select
                            aria-label="Base on"
                            value={baseId}
                            onChange={(event) => setBaseId(event.target.value)}
                            className="h-11 w-full rounded-xl border border-line bg-ink px-3 text-ivory outline-none focus:border-brass"
                          >
                            <option value="">New keys</option>
                            {mods.map((mod) => (
                              <option key={mod.id} value={mod.id}>
                                {mod.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={!draftName.trim() || nameTaken(mods, draftName)}
                          className="min-h-11 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-mist"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNaming(false);
                            setDraftName("");
                            setBaseId("");
                          }}
                          className="min-h-11 px-2 text-sm text-mist"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNaming(true);
                        setDraftName("");
                        setBaseId("");
                      }}
                      className="min-h-11 text-sm text-brass"
                    >
                      Add a mod
                    </button>
                  )}
                </div>
              ) : (
              <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  onFile(event.dataTransfer.files);
                }}
                className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-ink px-4 py-6 text-center hover:border-brass"
              >
                <Upload className="size-5 text-brass" aria-hidden="true" />
                {active.fileName ? (
                  <>
                    <span className="font-medium">{active.fileName}</span>
                    <span className="text-sm text-mist">
                      {fileSize != null ? formatBytes(fileSize) : "Saved name"} · tap to replace
                    </span>
                  </>
                ) : (
                  <span className="font-medium">{active.autoZip || rule.multiple ? "Drop files, or choose them" : "Drop a zip, or choose a file"}</span>
                )}
                <span className="text-sm text-mist">{uploadHint(rule)}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={active.autoZip ? undefined : rule.extensions?.join(",") || ".zip,.7z,.rar,application/zip"}
                multiple={active.autoZip || rule.multiple}
                className="sr-only"
                onChange={(event) => onFile(event.target.files ?? undefined)}
              />
              {fileError ? <p className="mt-2 text-sm text-bad">{fileError}</p> : null}
              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm text-mist">
                  Version <span className="text-brass">*</span>
                </span>
                <input
                  value={active.version}
                  required
                  aria-required="true"
                  onChange={(event) => patchMod(active.id, { version: event.target.value })}
                  placeholder="1.4.2"
                  className="h-11 w-full rounded-xl border border-line bg-ink px-3 outline-none placeholder:text-mist/70 focus:border-brass"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-sm text-mist">
                  Changelog <span className="text-brass">*</span>
                </span>
                <textarea
                  value={active.changelog}
                  required
                  aria-required="true"
                  onChange={(event) => patchMod(active.id, { changelog: event.target.value })}
                  rows={4}
                  placeholder="What changed in this build."
                  className="w-full resize-y rounded-xl border border-line bg-ink px-3 py-3 leading-relaxed outline-none placeholder:text-mist/70 focus:border-brass"
                />
              </label>
              {curseForgeOnForm(hostConfigs, input.fileName, input.autoZip) ? (
                <CurseForgeOverride
                  value={active.curseforgeOverride}
                  onEdit={(curseforgeOverride) => patchMod(active.id, { curseforgeOverride })}
                />
              ) : null}
              <button
                type="button"
                disabled={!canPublish}
                onClick={publish}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brass px-5 font-medium text-brass-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-mist"
              >
                <Check className="size-4" aria-hidden="true" />
                {!active.fileName.trim()
                  ? "Add a package to publish"
                  : !detailsReady
                    ? "Version and changelog needed"
                    : repeatVersion
                      ? "Version already published"
                      : ready === 0
                        ? "Set up a host to publish"
                        : `Publish to ${ready} ${ready === 1 ? "host" : "hosts"}`}
              </button>
              </>
              )}
            </div>
            )}
            {results ? <ResultDeck results={results} /> : null}
          </section>
        )}
        {vault === "off" ? (
          <button
            type="button"
            onClick={() => {
              setHostsOpen(false);
              setArming(true);
            }}
            className="fixed bottom-3 left-3 z-20 inline-flex min-h-11 items-center gap-2 text-sm text-ivory"
          >
            <LockOpen className="size-5 text-brass/35" aria-hidden="true" />
            Encrypt Keys
          </button>
        ) : (
          <span
            aria-label="Keys encrypted"
            className="fixed bottom-3 left-3 z-20 inline-flex min-h-11 items-center text-brass"
          >
            <Lock className="size-5" aria-hidden="true" />
          </span>
        )}
        <RevisionLink />
        </div>
      </div>
  );
}
