import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteResult, Transport } from "@/lib/omnimod/publish";
import { Delivery, ResultSlip, SiteCard, Studio } from "./studio";
import { platformById } from "@/lib/omnimod/catalog";
import { emptyConfig } from "@/lib/omnimod/catalog";
import { createMod } from "@/lib/omnimod/mods";
import { MODS_KEY } from "@/lib/omnimod/storage";
import * as vault from "@/lib/omnimod/vault";

const ok: Transport = async () => ({ ok: true });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function zip(name: string, bytes = 12) {
  return new File([new Uint8Array(bytes)], name, { type: "application/zip" });
}

async function addMod(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Add a mod" }));
  await user.type(screen.getByRole("textbox", { name: "New mod name" }), name);
  await user.click(screen.getByRole("button", { name: "Add" }));
}

async function typeField(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.type(screen.getByLabelText(label), value);
}

describe("Studio", () => {
  it("shows a local revision until a pipeline hash is baked in", () => {
    render(<Studio transport={ok} />);
    expect(screen.getByText("local").tagName).toBe("SPAN");
  });

  it("publishes a package, clears the draft, and blocks the same version", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Nexus Mods/ }));
    await typeField(user, "API key", "secret");
    await typeField(user, "Mod ID", "1");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, zip("lanterns.zip"));
    expect(screen.getByText("12 B · tap to replace")).toBeTruthy();
    const version = screen.getByRole("textbox", { name: "Version *" });
    await user.clear(version);
    await user.type(version, "1.4.2");
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "Softer glass.");
    await user.click(screen.getByRole("button", { name: "Publish to 1 host" }));
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByText(/1 sent/)).toBeTruthy();
    expect(screen.queryByText(/failed/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: "Back to package" }));
    expect(screen.getByRole("button", { name: "Add a package to publish" })).toBeTruthy();
    expect(screen.getByDisplayValue("1.4.3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByText("1.4.2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, zip("next.zip"));
    const repeat = screen.getByRole("textbox", { name: "Version *" });
    await user.clear(repeat);
    await user.type(repeat, "1.4.2");
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "Again.");
    expect(screen.getByRole("button", { name: "Version already published" })).toHaveProperty("disabled", true);
  });

  it("keeps the draft when the host refuses the version", async () => {
    const user = userEvent.setup();
    const refuse: Transport = async () => ({ ok: false, message: "The host refused version 0.0.0." });
    render(<Studio transport={refuse} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Modrinth/ }));
    await typeField(user, "Personal access token", "secret");
    await typeField(user, "Project ID or slug", "lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, zip("notes.txt", 2048));
    const refused = screen.getByRole("textbox", { name: "Version *" });
    await user.clear(refused);
    await user.type(refused, "0.0.0");
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "nope");
    await user.click(screen.getByRole("button", { name: /Publish to/ }));
    expect(screen.getByText("Failed")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: "Back to package" }));
    expect(screen.getByDisplayValue("0.0.0")).toBeTruthy();
  });

  it("names mods, rejects duplicates, and can remove every mod", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Add a mod" }));
    await user.type(screen.getByRole("textbox", { name: "New mod name" }), "lanterns");
    expect(screen.getByText("Already used")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    await user.clear(screen.getByRole("textbox", { name: "New mod name" }));
    await user.type(screen.getByRole("textbox", { name: "New mod name" }), "Clock");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Remove Lanterns" }));
    await user.click(screen.getByRole("button", { name: "Remove Clock" }));
    expect(screen.getByRole("heading", { name: "Mods" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByText("Add a mod before saving host keys.")).toBeTruthy();
  });

  it("hides mod search until there are more than 20 mods", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Only");
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.queryByRole("textbox", { name: "Find a mod" })).toBeNull();
    cleanup();
    localStorage.setItem(MODS_KEY, JSON.stringify(Array.from({ length: 21 }, (_, index) => createMod(`Pack ${index}`))));
    render(<Studio transport={ok} />);
    await user.click(await screen.findByRole("button", { name: "21" }));
    const search = screen.getByRole("textbox", { name: "Find a mod" });
    await user.type(search, "missing");
    expect(screen.getByText("No mods match.")).toBeTruthy();
  });

  it("rejects a file the configured hosts will not take", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Modrinth/ }));
    await typeField(user, "Personal access token", "secret");
    await typeField(user, "Project ID or slug", "lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByText("More than one file is allowed. Largest file 500 MiB.")).toBeTruthy();
    const huge = new File(["x"], "huge.zip");
    Object.defineProperty(huge, "size", { value: 500 * 1024 * 1024 + 1 });
    const zone = screen.getByRole("button", { name: /Drop files/ });
    fireEvent.drop(zone, { dataTransfer: { files: [huge] } });
    expect(screen.getByText("huge.zip is over the 500 MiB limit for the hosts on this mod.")).toBeTruthy();
  });

  it("reads a version out of the file name and ignores an empty drop", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    const zone = screen.getByRole("button", { name: /Drop a zip/ });
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(screen.getByDisplayValue("0.0.1")).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { files: [zip("pack-2.0.1.zip", 2 * 1024 * 1024)] } });
    expect(screen.getByDisplayValue("0.0.1")).toBeTruthy();
    const version = screen.getByRole("textbox", { name: "Version *" });
    await user.clear(version);
    fireEvent.drop(zone, { dataTransfer: { files: [zip("pack-2.0.1.zip", 2 * 1024 * 1024)] } });
    expect(screen.getByDisplayValue("2.0.1")).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { files: [zip("pack-9.9.9.zip")] } });
    expect(screen.getByDisplayValue("2.0.1")).toBeTruthy();
    expect(screen.queryByDisplayValue("9.9.9")).toBeNull();
  });

  it("draws the delivery states", () => {
    const { rerender } = render(
      <Delivery fileName="pack.zip" progress={{ completed: 0, total: 2, current: null }} />,
    );
    expect(screen.getByText("2 remaining")).toBeTruthy();
    expect(screen.getByText("Packing")).toBeTruthy();
    rerender(<Delivery fileName="pack.zip" progress={{ completed: 1, total: 2, current: "nexus" }} />);
    expect(screen.getByText("On the way to Nexus Mods")).toBeTruthy();
    rerender(<Delivery fileName="" progress={{ completed: 0, total: 0, current: null }} />);
    expect(screen.getByText("0 remaining")).toBeTruthy();
  });

  it("walks the host editor, library switch, and blocked publish labels", async () => {
    const user = userEvent.setup();
    let release: (value: { ok: true }) => void = () => {};
    const held: Transport = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    render(<Studio transport={held} />);
    await addMod(user, "Untitled mod");
    fireEvent.click(screen.getByRole("button", { name: "Add a package to publish" }));
    await user.click(screen.getByRole("button", { name: /Drop a zip/ }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, zip("plain.zip"));
    expect(screen.getByRole("button", { name: "Version and changelog needed" })).toBeTruthy();
    const typed = screen.getByRole("textbox", { name: "Version *" });
    await user.clear(typed);
    await user.type(typed, "3.0.0");
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "notes");
    expect(screen.getByRole("button", { name: "Set up a host to publish" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Nexus Mods/ }));
    expect(screen.getByRole("button", { name: "Clear" })).toHaveProperty("disabled", true);
    await typeField(user, "API key", "secret");
    await typeField(user, "Mod ID", "1");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("API key")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Mod ID")).toHaveProperty("value", "");
    await typeField(user, "API key", "secret");
    await typeField(user, "Mod ID", "1");
    await user.click(screen.getByRole("button", { name: /GitHub Releases/ }));
    await user.click(screen.getByRole("button", { name: /GitHub Releases/ }));
    await user.click(screen.getByRole("button", { name: /GitHub Releases/ }));
    await typeField(user, "Personal access token", "secret");
    await typeField(user, "Repository", "studio/mod");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Add a mod" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Add a mod" }));
    const form = screen.getByRole("textbox", { name: "New mod name" }).closest("form");
    fireEvent.submit(form!);
    await user.type(screen.getByRole("textbox", { name: "New mod name" }), "Second");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    const untitled = screen
      .getAllByRole("button", { name: /Untitled mod/ })
      .find((button) => button.getAttribute("aria-label") !== "Remove Untitled mod");
    await user.click(untitled!);
    expect(screen.getByText(/Saved name/)).toBeTruthy();
    const title = screen.getByRole("textbox", { name: "Mod name" });
    await user.clear(title);
    await user.type(title, "Second");
    expect(screen.getByText("Already used")).toBeTruthy();
    fireEvent.blur(title);
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Mod" }), screen.getByRole("option", { name: "Second" }));
    expect(screen.getByText(/Second ·/)).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Mod" }), screen.getByRole("option", { name: "Untitled mod" }));
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    const publish = screen.getByRole("button", { name: /Publish to/ });
    await user.click(publish);
    expect(screen.queryByRole("button", { name: "Back to package" })).toBeNull();
    expect(screen.getByText(/remaining/)).toBeTruthy();
    release({ ok: true });
    expect(await screen.findByText("On the way to GitHub Releases")).toBeTruthy();
    release({ ok: true });
    expect(await screen.findByRole("button", { name: "Back to package" })).toBeTruthy();
  });

  it("renders a host card without a token link", () => {
    const platform = { ...platformById("steam"), tokenUrl: undefined, tokenLabel: undefined };
    render(
      <SiteCard
        platform={platform}
        config={emptyConfig()}
        open
        onToggleOpen={() => {}}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Steam Workshop")).toBeTruthy();
    expect(screen.getByText("One archive. No published size cap.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveProperty("disabled", true);
  });

  it("names an unknown host and ignores an empty file choice", async () => {
    const user = userEvent.setup();
    const ghost = { id: "ghost", status: "skipped", message: "Left." } as SiteResult;
    render(<ResultSlip result={ghost} index={0} />);
    expect(screen.getByText("ghost")).toBeTruthy();
    cleanup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: null } });
    expect(screen.getByDisplayValue("0.0.1")).toBeTruthy();
  });

  it("stays locked when the vault record disappears", async () => {
    const user = userEvent.setup();
    const secret = vault.createRecoveryKey();
    const key = await vault.importRecoveryKey(secret);
    localStorage.setItem(vault.VAULT_KEY, await vault.seal(key!, { mods: [], activeId: "" }));
    render(<Studio transport={ok} />);
    expect(await screen.findByRole("heading", { name: "Keys are locked" })).toBeTruthy();
    localStorage.removeItem(vault.VAULT_KEY);
    await user.type(screen.getByLabelText("Key"), secret);
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(screen.getByRole("heading", { name: "Keys are locked" })).toBeTruthy();
  });

  it("does not lock when the recovery key cannot be imported", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(vault, "importRecoveryKey").mockResolvedValueOnce(null);
    render(<Studio transport={ok} />);
    await user.click(screen.getByRole("button", { name: "Encrypt Keys" }));
    await user.click(screen.getByRole("checkbox", { name: "I saved this recovery key" }));
    await user.click(screen.getByRole("button", { name: "Protect" }));
    expect(await screen.findByRole("heading", { name: "Encrypt keys" })).toBeTruthy();
    spy.mockRestore();
  });

  it("drops a seal that finishes after the studio moves on", async () => {
    const user = userEvent.setup();
    let finish = (_value: string) => {};
    const spy = vi.spyOn(vault, "seal").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Studio transport={ok} />);
    await user.click(screen.getByRole("button", { name: "Encrypt Keys" }));
    await user.click(screen.getByRole("checkbox", { name: "I saved this recovery key" }));
    await user.click(screen.getByRole("button", { name: "Protect" }));
    expect(await screen.findByLabelText("Keys encrypted")).toBeTruthy();
    cleanup();
    finish("stale");
    await Promise.resolve();
    spy.mockRestore();
  });
});
