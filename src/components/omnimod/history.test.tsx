import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeployTable, ROW_HEIGHT } from "./history";
import type { Deployment, HostRun } from "@/lib/omnimod/history";

afterEach(() => {
  cleanup();
});

function deploy(id: string, mod: string, failed: boolean, message = "no"): Deployment {
  return {
    id,
    modId: id,
    mod,
    when: failed ? "2026-03-04T12:30:00.000Z" : "2026-01-02T15:04:00.000Z",
    hosts: failed
      ? [
          { id: "nexus", name: "Nexus Mods", status: "error", message, url: "" },
          { id: "curseforge", name: "CurseForge", status: "error", message: "closed", url: "" },
        ]
      : [{ id: "modrinth", name: "Modrinth", status: "success", message: "ok", url: "https://modrinth.com" }],
    note: { name: mod, version: "1.0.0", notes: "Shipped.", links: [] },
  };
}

function Harness({ initial }: { initial: Deployment[] }) {
  const [rows, setRows] = useState(initial);
  const [notice, setNotice] = useState("");
  return (
    <>
      <button type="button" onClick={() => setRows((current) => current.filter((row) => row.id !== "a"))}>
        Drop a
      </button>
      <button type="button" onClick={() => setNotice("Choose the package again.")}>
        Warn
      </button>
      <DeployTable
        rows={rows}
        notice={notice}
        run={null}
        onDelete={(ids) => setRows((current) => current.filter((row) => !ids.includes(row.id)))}
        onRetry={(rowId, ids) => setNotice(`${rowId}:${ids.join(",")}`)}
        onCopy={() => undefined}
      />
    </>
  );
}

describe("DeployTable", () => {
  it("searches from one field, expands a row, and reruns the hosts that were picked", async () => {
    const user = userEvent.setup();
    const copy = vi.fn();
    const retry = vi.fn();
    const remove = vi.fn();
    const rows = [deploy("a", "Lanterns", true, ""), deploy("b", "Harbor", false), deploy("c", "Moths", false)];
    render(<DeployTable rows={rows} notice="" run={null} onDelete={remove} onRetry={retry} onCopy={copy} />);
    expect(screen.getByText("Lanterns")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("0").length).toBe(2);
    await user.click(screen.getByRole("button", { name: "Hosts", exact: true }));
    await user.type(screen.getByLabelText("Search deployments"), "curse");
    expect(screen.getByText("Lanterns")).toBeTruthy();
    expect(screen.queryByText("Harbor")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hosts", exact: true }));
    await user.clear(screen.getByLabelText("Search deployments"));
    await user.click(screen.getByRole("button", { name: "When", exact: true }));
    await user.type(screen.getByLabelText("Search deployments"), "2026-01");
    expect(screen.queryByText("Lanterns")).toBeNull();
    await user.clear(screen.getByLabelText("Search deployments"));
    await user.click(screen.getByRole("button", { name: "When", exact: true }));
    await user.type(screen.getByLabelText("Search deployments"), "missing");
    expect(screen.getByText("No deployments match.")).toBeTruthy();
    expect(screen.getByLabelText("Select all deployments")).toHaveProperty("disabled", true);
    await user.clear(screen.getByLabelText("Search deployments"));
    await user.click(screen.getByRole("button", { name: "Expand a" }));
    expect(screen.getByText("No detail")).toBeTruthy();
    expect(screen.getByText("closed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Rerun CurseForge" }));
    await user.click(screen.getByRole("button", { name: "Rerun CurseForge" }));
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Rerun CurseForge" }));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(retry).toHaveBeenCalledWith("a", ["curseforge"]);
    await user.click(screen.getByRole("button", { name: "Rerun Nexus Mods" }));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(retry).toHaveBeenCalledWith("a", ["nexus", "curseforge"]);
    await user.click(screen.getByRole("button", { name: "Copy release notes for a" }));
    expect(copy).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copy release notes for a" }).textContent).toContain("Copied");
    await user.click(screen.getByLabelText("Select a"));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(remove).toHaveBeenCalledWith(["a"]);
    await user.click(screen.getByRole("button", { name: "Collapse a" }));
    await user.click(screen.getByRole("button", { name: "Expand b" }));
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy release notes for b" }).textContent).toContain("Copy");
    await user.click(screen.getByRole("button", { name: "Sort When" }));
    await user.click(screen.getByRole("button", { name: "Sort Mod" }));
    expect(screen.getByRole("button", { name: "Sort Mod" }).textContent).toContain("↑");
    await user.click(screen.getByRole("button", { name: "Sort Mod" }));
    expect(screen.getByRole("button", { name: "Sort Mod" }).textContent).toContain("↓");
    await user.click(screen.getByRole("button", { name: "Sort Failed" }));
    await user.click(screen.getByRole("button", { name: "Sort When" }));
    await user.click(screen.getByLabelText("Select b"));
    await user.click(screen.getByLabelText("Select b"));
    await user.click(screen.getByLabelText("Select all deployments"));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(remove).toHaveBeenCalledWith(["b", "c", "a"]);
    await user.click(screen.getByLabelText("Select all deployments"));
    expect(screen.getByRole("button", { name: "Delete selected" })).toHaveProperty("disabled", true);
  });

  it("pauses the page and shows each upload while a rerun is in flight", () => {
    const run: HostRun[] = [
      { id: "nexus", name: "Nexus Mods", state: "queued" },
      { id: "curseforge", name: "CurseForge", state: "sending" },
      { id: "github", name: "GitHub Releases", state: "sent" },
      { id: "thunderstore", name: "Thunderstore", state: "failed" },
    ];
    render(<DeployTable rows={[deploy("a", "Lanterns", true)]} notice="" run={run} onDelete={() => undefined} onRetry={() => undefined} onCopy={() => undefined} />);
    const progress = screen.getByLabelText("Upload progress");
    expect(progress.textContent).toContain("Waiting");
    expect(progress.textContent).toContain("Sending");
    expect(progress.textContent).toContain("Sent");
    expect(progress.textContent).toContain("Failed");
    expect(progress.textContent).toContain("2 of 4");
    expect(screen.getByLabelText("Search deployments")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Delete selected" })).toHaveProperty("disabled", true);
  });

  it("virtualizes when the pane has a height and drops a selection that leaves", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[deploy("a", "Lanterns", true), deploy("b", "Harbor", false), deploy("c", "Moths", false)]} />);
    const pane = screen.getByTestId("deploy-scroll");
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: ROW_HEIGHT });
    fireEvent(window, new Event("resize"));
    expect(screen.queryByText("Moths")).toBeNull();
    pane.scrollTop = ROW_HEIGHT;
    fireEvent.scroll(pane);
    expect(screen.queryByText("Lanterns")).toBeNull();
    pane.scrollTop = 0;
    fireEvent.scroll(pane);
    await user.click(screen.getByRole("button", { name: "Expand a" }));
    await user.click(screen.getByRole("button", { name: "Rerun Nexus Mods" }));
    await user.click(screen.getByRole("button", { name: "Rerun CurseForge" }));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByText("a:nexus,curseforge")).toBeTruthy();
    await user.click(screen.getByLabelText("Select a"));
    await user.click(screen.getByLabelText("Select b"));
    await user.click(screen.getByRole("button", { name: "Warn" }));
    expect(screen.getByText("Choose the package again.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Drop a" }));
    expect(screen.queryByLabelText("Select a")).toBeNull();
    expect(screen.getByLabelText("Select b")).toHaveProperty("checked", true);
    expect(screen.getByText("Choose the package again.")).toBeTruthy();
  });
});
