import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteResult, Transport } from "@/lib/omnimod/publish";
import { ticketTitle } from "@/lib/omnimod/publish";
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
    expect(screen.getByText("© 2026 Musical Pig LLC")).toBeTruthy();
  });

  it("keeps the line behind the arrow until it is opened", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    const arrow = screen.getByRole("button", { name: "Show the line" });
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
    await user.click(arrow);
    expect(screen.getByRole("button", { name: "Hide the line" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("One archive, published to every host that is ready.")).toBeTruthy();
  });

  it("switches between the form, the mods, and the hosts", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    expect(screen.getByRole("button", { name: "Form" })).toHaveProperty("disabled", true);
    await addMod(user, "Lanterns");
    expect(screen.getByRole("button", { name: "Form" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByRole("heading", { name: "Later" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Form" }));
    expect(screen.getByRole("textbox", { name: "Mod name" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Later" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByRole("button", { name: "Add a mod" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Form" }));
    expect(screen.queryByRole("button", { name: "Add a mod" })).toBeNull();
  });

  it("publishes a package, clears the draft, and blocks the same version", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Nexus Mods/ }));
    await typeField(user, "API key", "secret");
    await typeField(user, "Game domain", "site");
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
    await typeField(user, "Game versions", "1.20.1");
    await typeField(user, "Loaders", "fabric");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, zip("notes.jar", 2048));
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

  it("keeps the next mod selected when the active one is removed", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Add a mod" }));
    await user.type(screen.getByRole("textbox", { name: "New mod name" }), "Clock");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Lanterns —" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Remove Lanterns" }));
    expect(screen.getByRole("button", { name: "Remove Clock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Lanterns" })).toBeNull();
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
    await typeField(user, "Game versions", "1.20.1");
    await typeField(user, "Loaders", "fabric");
    expect(screen.getByRole("heading", { name: "API" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bot" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Later" })).toBeTruthy();
    expect(screen.getByText("Accepts .zip, .rar, .7z. The ready hosts need .jar.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Nexus Mods/ }));
    expect(screen.getByLabelText("API key")).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByText("More than one file is allowed. Largest file 500 MiB.")).toBeTruthy();
    const huge = new File(["x"], "huge.jar");
    Object.defineProperty(huge, "size", { value: 500 * 1024 * 1024 + 1 });
    const zone = screen.getByRole("button", { name: /Drop files/ });
    fireEvent.drop(zone, { dataTransfer: { files: [huge] } });
    expect(screen.getByText("huge.jar is over the 500 MiB limit for the hosts on this mod.")).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { files: [zip("one.jar"), zip("two.jar")] } });
    expect(screen.getByText("one.jar, two.jar")).toBeTruthy();
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
    fireEvent.drop(zone, { dataTransfer: { files: [zip("a, b.zip")] } });
    expect(screen.getByText("a, b.zip")).toBeTruthy();
  });

  it("draws the delivery states", () => {
    const { rerender } = render(
      <Delivery fileName="pack.zip" progress={{ completed: 0, total: 2, current: null }} />,
    );
    expect(screen.getByText("2 remaining")).toBeTruthy();
    expect(screen.getByText("Packing")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    rerender(<Delivery fileName="pack.zip" progress={{ completed: 1, total: 2, current: "nexus" }} />);
    expect(screen.getByText("On the way to Nexus Mods")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    rerender(<Delivery fileName="pack.zip" progress={{ completed: 2, total: 2, current: null }} />);
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    rerender(<Delivery fileName="pack.zip" progress={{ completed: 1, total: 1, current: null, failed: 1 }} />);
    expect(screen.getByText("Not delivered")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    rerender(<Delivery fileName="" progress={{ completed: 0, total: 0, current: null }} />);
    expect(screen.getByText("0 remaining")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
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
    await typeField(user, "Game domain", "site");
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
    await user.click(screen.getByRole("combobox", { name: "Mod" }));
    await user.click(screen.getByRole("option", { name: "Second" }));
    expect(screen.getByText(/Second ·/)).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Mod" }));
    await user.click(screen.getByRole("option", { name: "Untitled mod" }));
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
    const platform = {
      ...platformById("steam"),
      tokenUrl: undefined,
      tokenLabel: undefined,
      fields: [
        ...platformById("steam").fields,
        { key: "mode", label: "Mode", placeholder: "", choices: [{ value: "a", label: "A" }] },
        {
          key: "tone",
          label: "Tone",
          placeholder: "",
          defaultValue: "low",
          choices: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        },
      ],
    };
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
    expect(screen.getByText("Later")).toBeTruthy();
    expect(screen.getByText(/Not available until a later date/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "App ID" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "Mode" }).textContent).toContain("Choose");
    expect(screen.getByRole("combobox", { name: "Tone" }).textContent).toContain("Low");
    expect(screen.getByText("One archive. No published size cap.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveProperty("disabled", true);
  });

  it("edits CurseForge release defaults from the host card", async () => {
    const user = userEvent.setup();
    const seen: { fields: Record<string, string> }[] = [];
    render(
      <SiteCard
        platform={platformById("curseforge")}
        config={{ enabled: true, fields: { projectId: "1744552", releaseType: "beta" } }}
        open
        onToggleOpen={() => {}}
        onChange={(next) => seen.push(next)}
      />,
    );
    expect(screen.getByText("Bot")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open CurseForge" }).getAttribute("href")).toBe("https://www.curseforge.com/");
    expect(screen.getByRole("combobox", { name: "Release type" }).textContent).toContain("Beta");
    expect(screen.getByRole("combobox", { name: "Publish when" }).textContent).toContain("When it is approved");
    const release = screen.getByRole("combobox", { name: "Release type" });
    await user.click(release);
    await user.click(release);
    await user.click(release);
    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(seen.at(-1)?.fields.releaseType).toBe("alpha");
  });

  it("shows the upload link only after a successful send", () => {
    render(
      <ResultSlip
        result={{
          id: "curseforge",
          status: "success",
          message: "CurseForge accepted 1.",
          url: "https://authors.curseforge.com/#/projects/2/files",
        }}
        index={1}
      />,
    );
    expect(screen.getByRole("link", { name: "View upload" }).getAttribute("href")).toBe(
      "https://authors.curseforge.com/#/projects/2/files",
    );
    cleanup();
    render(<ResultSlip result={{ id: "curseforge", status: "success", message: "CurseForge accepted 1." }} index={0} />);
    expect(screen.queryByRole("link", { name: "View upload" })).toBeNull();
    cleanup();
    render(
      <ResultSlip result={{ id: "curseforge", status: "error", message: "no", url: "https://example.com" }} index={0} />,
    );
    expect(screen.queryByRole("link", { name: "View upload" })).toBeNull();
  });

  it("opens a failed host and links the matching ticket", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const bot: SiteResult = {
      id: "curseforge",
      status: "error",
      message: "CurseForge changelog editor did not open. The tab was left open.",
      step: "changelog",
      reason: "both editors stayed empty",
      filled: ["file", "display name"],
      file: "README.md.zip",
      config: { projectId: "2", custom: "kept" },
      logs: ["file placed", "stop changelog: both editors stayed empty"],
      url: "https://example.com/should-not-show",
    };
    const title = ticketTitle("CurseForge", bot);
    let release: (value: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    render(<ResultSlip result={bot} index={0} />);
    expect(screen.getByText("changelog: both editors stayed empty")).toBeTruthy();
    expect(screen.queryByText("CurseForge changelog editor did not open. The tab was left open.")).toBeNull();
    expect(screen.queryByRole("link", { name: "View upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Ticket" })).toBeNull();
    expect(screen.queryByLabelText("Issue link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "CurseForge failure" }));
    expect(screen.getByRole("button", { name: "CurseForge failure" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Step: changelog")).toBeTruthy();
    expect(screen.getByText("Reason: both editors stayed empty")).toBeTruthy();
    expect(screen.getByText("Filled: file, display name")).toBeTruthy();
    expect(screen.getByText("File: README.md.zip")).toBeTruthy();
    expect(screen.getByText("Project ID: 2")).toBeTruthy();
    expect(screen.getByText("custom: kept")).toBeTruthy();
    expect(screen.getByText(/file placed/)).toBeTruthy();
    expect(screen.getByText("Checking for an open ticket")).toBeTruthy();
    release({
      ok: true,
      json: async () => ({ items: [{ title, html_url: "https://github.com/musical-pig-dev/OmniMod/issues/12" }] }),
    });
    expect((await screen.findByRole("link", { name: "View Ticket" })).getAttribute("href")).toBe(
      "https://github.com/musical-pig-dev/OmniMod/issues/12",
    );
    expect(screen.queryByRole("button", { name: "Create Ticket" })).toBeNull();
    const blobUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:omnimod-log");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Download log" }));
    expect(blobUrl).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:omnimod-log");
    await user.click(screen.getByRole("button", { name: "CurseForge failure" }));
    expect(screen.queryByText("Step: changelog")).toBeNull();
    blobUrl.mockRestore();
    revoke.mockRestore();
    cleanup();

    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    render(<ResultSlip result={bot} index={0} />);
    await user.click(screen.getByRole("button", { name: "CurseForge failure" }));
    await user.click(await screen.findByRole("button", { name: "Create Ticket" }));
    expect(String(open.mock.calls[0]?.[0])).toContain("https://github.com/musical-pig-dev/OmniMod/issues/new");
    expect(String(open.mock.calls[0]?.[0])).toContain("OmniMod");
    expect(open.mock.calls[0]?.[2]).toBe("noopener");
    const box = screen.getByLabelText("Issue link");
    await user.type(box, "   ");
    await user.click(screen.getByRole("button", { name: "Save issue link" }));
    expect(screen.queryByRole("link", { name: "View Ticket" })).toBeNull();
    await user.clear(box);
    await user.type(box, "  https://github.com/musical-pig-dev/OmniMod/issues/12  ");
    await user.click(screen.getByRole("button", { name: "Save issue link" }));
    expect(screen.getByRole("link", { name: "View Ticket" }).getAttribute("href")).toBe(
      "https://github.com/musical-pig-dev/OmniMod/issues/12",
    );
    expect(screen.queryByLabelText("Issue link")).toBeNull();
    open.mockRestore();
    cleanup();

    const api: SiteResult = {
      id: "modrinth",
      status: "error",
      message: "Modrinth refused.",
      step: "upload",
      reason: "nope",
    };
    render(<ResultSlip result={api} index={0} />);
    expect(screen.getByText("Modrinth refused.")).toBeTruthy();
    expect(screen.queryByText("upload: nope")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Modrinth failure" }));
    expect(screen.queryByText("Filled: file")).toBeNull();
    expect(screen.queryByText(/^File:/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Create Ticket" })).toBeTruthy();
    cleanup();

    const ghost = {
      id: "ghost",
      status: "error",
      message: "Unknown host failed.",
      config: { anything: "v" },
      filled: [],
    } as SiteResult;
    render(<ResultSlip result={ghost} index={2} />);
    await user.click(screen.getByRole("button", { name: "ghost failure" }));
    expect(screen.getByText("anything: v")).toBeTruthy();
    expect(screen.getByText("Unknown host failed.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Create Ticket" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("offers a CurseForge override only when that host is ready for the file", async () => {
    const user = userEvent.setup();
    render(<Studio transport={ok} />);
    await addMod(user, "Lanterns");
    expect(screen.queryByRole("button", { name: "CurseForge", exact: true })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /CurseForge/ }));
    await typeField(user, "Project ID", "1744552");
    await typeField(user, "Game versions", "17045");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    const override = screen.getByRole("button", { name: "CurseForge", exact: true });
    expect(override.getAttribute("aria-expanded")).toBe("false");
    await user.click(override);
    expect(screen.getByText("Empty fields use the host key.")).toBeTruthy();
    expect(screen.queryByLabelText("Project ID")).toBeNull();
    expect(screen.queryByLabelText("Changelog format")).toBeNull();
    await user.type(screen.getByLabelText("Display name"), "Sample");
    await user.type(screen.getByLabelText("Game versions"), "26.3");
    await user.type(screen.getByLabelText("Relations"), "jei:requiredDependency");
    await user.click(screen.getByLabelText("Release type"));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    await user.click(screen.getByLabelText("Release type"));
    await user.click(screen.getByRole("option", { name: "Host key" }));
    await user.click(screen.getByLabelText("Publish when"));
    await user.click(screen.getByRole("option", { name: "Keep it as a draft" }));
    await user.click(screen.getByRole("button", { name: "CurseForge", exact: true }));
    expect(screen.queryByText("Empty fields use the host key.")).toBeNull();
    const zone = screen.getByRole("button", { name: /Drop a zip/ });
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    expect(screen.queryByRole("button", { name: "CurseForge", exact: true })).toBeNull();
    fireEvent.drop(screen.getByRole("button", { name: /notes.txt/ }), { dataTransfer: { files: [zip("pack.zip")] } });
    await user.click(screen.getByRole("button", { name: "CurseForge", exact: true }));
    expect(screen.getByLabelText("Display name")).toHaveProperty("value", "Sample");
    expect(screen.getByLabelText("Publish when").textContent).toContain("Keep it as a draft");
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

  it("lists later hosts and packs files when auto-zip is on", async () => {
    const user = userEvent.setup();
    const seen: Blob[] = [];
    const transport: Transport = async (_id, input) => {
      if (input.file) seen.push(input.file);
      return { ok: true };
    };
    render(<Studio transport={transport} />);
    await addMod(user, "Lanterns");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    expect(screen.getByRole("button", { name: "1" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "App ID" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Zip name" })).toBeNull();
    for (const href of [
      "https://steamcommunity.com/workshop/",
      "https://basedmods.org",
      "https://ayakamods.com",
      "https://www.afkmods.com",
      "https://moddinghaven.com",
      "https://laxmods.su",
      "https://www.moddb.com",
    ]) {
      expect(screen.getByRole("link", { name: href }).getAttribute("href")).toBe(href);
    }
    await user.click(screen.getByRole("checkbox", { name: "Auto-zip" }));
    expect(screen.getByText("Files that are not a zip are packed into one zip for hosts that need it.")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Zip name" }), "Bundle");
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.queryByRole("heading", { name: "Later" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Lanterns" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByRole("button", { name: /Drop files/ })).toBeTruthy();
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.multiple).toBe(true);
    expect(picker.accept).toBe("");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.click(screen.getByRole("button", { name: /Thunderstore/ }));
    await typeField(user, "Service token", "secret");
    await typeField(user, "Team namespace", "Team");
    await typeField(user, "Community", "riskofrain2");
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), {
      dataTransfer: { files: [new File(["jar"], "mod.jar")] },
    });
    await user.clear(screen.getByRole("textbox", { name: "Version *" }));
    await user.type(screen.getByRole("textbox", { name: "Version *" }), "1.0.0");
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "Packed.");
    await user.click(screen.getByRole("button", { name: "Publish to 1 host" }));
    expect(screen.getByText("Bundle.zip")).toBeTruthy();
    const packed = new Uint8Array(await seen[0].arrayBuffer());
    expect(packed[0]).toBe(0x50);
    expect(new TextDecoder().decode(packed)).toContain("mod.jar");
    await user.click(screen.getByRole("button", { name: "Back to package" }));
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    await user.clear(screen.getByRole("textbox", { name: "Zip name" }));
    await user.click(screen.getByRole("button", { name: /Hosts/ }));
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), {
      dataTransfer: { files: [new File(["a"], "a.jar"), new File(["b"], "b.txt")] },
    });
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "Two.");
    await user.click(screen.getByRole("button", { name: "Publish to 1 host" }));
    expect(screen.getByText("a.zip")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to package" }));
    const alone = new File(["zip"], "pack.zip");
    fireEvent.drop(screen.getByRole("button", { name: /Drop files/ }), { dataTransfer: { files: [alone] } });
    await user.type(screen.getByRole("textbox", { name: "Changelog *" }), "Same.");
    await user.click(screen.getByRole("button", { name: "Publish to 1 host" }));
    expect(screen.getByText("pack.zip")).toBeTruthy();
    expect(seen[2]).toBe(alone);
  });

  it("publishes a saved name without a file when auto-zip is on", async () => {
    const seen: Array<Blob | null> = [];
    const transport: Transport = async (_id, input) => {
      seen.push(input.file ?? null);
      return { ok: true };
    };
    localStorage.setItem(
      MODS_KEY,
      JSON.stringify([
        {
          id: "saved",
          name: "Lanterns",
          fileName: "saved.jar",
          version: "1.0.0",
          changelog: "notes",
          autoZip: true,
          zipName: "",
          configs: {
            thunderstore: { enabled: true, fields: { token: "t", namespace: "Team", community: "riskofrain2" } },
          },
        },
      ]),
    );
    render(<Studio transport={transport} />);
    await userEvent.click(await screen.findByRole("button", { name: "Publish to 1 host" }));
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(seen).toEqual([null]);
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
