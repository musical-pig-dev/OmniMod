import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { createRecoveryKey } from "@/lib/omnimod/vault";

export function ProtectKeys({
  onProtect,
  onCancel,
}: {
  onProtect: (secret: string) => void;
  onCancel: () => void;
}) {
  const [secret] = useState(createRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <section className="mx-auto w-full max-w-xl space-y-8 rounded-card border border-line bg-panel p-8">
      <div className="space-y-3">
        <h2 className="font-display text-2xl">Encrypt keys</h2>
        <p className="text-sm leading-relaxed text-mist">
          One recovery key locks every mod and every host key on this browser. It is not saved here. If you lose it, the
          keys cannot be read. This cannot be turned off. Reinstall the extension to erase it.
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-ink px-4 py-3">
        <p className="min-w-0 flex-1 break-all font-mono text-sm tracking-wide text-ivory">{secret}</p>
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy key"}
          onClick={() => void copy()}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-brass hover:border-brass"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="space-y-6">
        <label className="flex items-center gap-3 text-sm text-ivory">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          I saved this recovery key
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!saved}
            onClick={() => onProtect(secret)}
            className="min-h-11 rounded-full bg-brass px-4 text-sm font-medium text-brass-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-mist"
          >
            Protect
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 px-2 text-sm text-mist">
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

export function UnlockKeys({ onUnlock }: { onUnlock: (secret: string) => Promise<boolean> }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);

  async function submit(value: string) {
    const trimmed = value.trim();
    setSecret(trimmed);
    const opened = await onUnlock(trimmed);
    setError(!opened);
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 rounded-card border border-line bg-panel p-8">
      <h2 className="text-center font-display text-2xl">Keys are locked</h2>
      <label className="block">
        <span className="mb-2 block text-sm text-mist">Key</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Key"
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value);
            setError(false);
          }}
          className="h-12 w-full rounded-lg border border-line bg-ink px-3.5 font-mono text-sm text-ivory outline-none transition-colors focus:border-brass"
        />
      </label>
      {error ? <p className="text-sm text-bad">That recovery key does not open this vault.</p> : null}
      <button
        type="button"
        disabled={!secret.trim()}
        onClick={() => void submit(secret)}
        className="h-12 w-full rounded-full bg-brass text-sm font-medium text-brass-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-mist"
      >
        Unlock
      </button>
    </section>
  );
}