import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  addNoteLink,
  adoptDeployment,
  canRetryHeld,
  copyNote,
  deploymentFrom,
  failedLine,
  filterDeployments,
  hostLine,
  hostsOf,
  markHost,
  markRun,
  noteText,
  readDeployment,
  readDeploymentList,
  releaseAfterRetry,
  rememberDeployment,
  retryArchive,
  retrySpec,
  runLabel,
  searchDeployments,
  shouldReleaseHold,
  sortDeployments,
  spanTops,
  whenLabel,
  windowRows,
  windowSpans,
  panelHeight,
  type Deployment,
} from "./history.ts";

function row(partial: Partial<Deployment> & Pick<Deployment, "id" | "mod">): Deployment {
  return {
    modId: partial.modId ?? "",
    when: partial.when ?? "2026-01-02T15:04:00.000Z",
    hosts: partial.hosts ?? [{ id: "nexus", name: "Nexus Mods", status: "success", message: "ok", url: "" }],
    note: partial.note ?? { name: partial.mod, version: "1.0.0", notes: "note", links: [] },
    ...partial,
  };
}

describe("history", () => {
  it("labels times in UTC and keeps bad stamps", () => {
    assert.equal(whenLabel("2026-01-02T15:04:00.000Z"), "2026-01-02 15:04");
    assert.equal(whenLabel("nope"), "nope");
    assert.equal(whenLabel("  "), "—");
  });

  it("reads a deployment and drops rows that cannot be shown", () => {
    assert.equal(readDeployment(null), null);
    assert.equal(readDeployment("no"), null);
    assert.equal(readDeployment({ id: " ", mod: "A", hosts: [{ id: "nexus", status: "success" }] }), null);
    assert.equal(readDeployment({ id: "a", mod: 1, hosts: [] }), null);
    assert.equal(readDeployment({ id: "a", mod: "A", hosts: "no" }), null);
    assert.equal(readDeployment({ id: "a", mod: "A", hosts: [null, "x", { id: "nope", status: "success" }, { id: "nexus", status: "skipped" }] }), null);
    const bare = readDeployment({
      id: "a",
      mod: "Lanterns",
      hosts: [{ id: "nexus", status: "success", name: "  ", message: 4, url: 4 }, { id: "modrinth", status: "error", name: "Modrinth" }],
    });
    assert.equal(bare?.hosts[0]?.name, "Nexus Mods");
    assert.equal(bare?.hosts[0]?.message, "");
    assert.equal(bare?.hosts[0]?.url, "");
    assert.equal(bare?.modId, "");
    assert.equal(bare?.when, "");
    assert.equal(bare?.note.name, "Lanterns");
    assert.equal(bare?.note.version, "");
    assert.equal(bare?.note.notes, "");
    assert.deepEqual(bare?.note.links, []);
    const full = readDeployment({
      id: "b",
      modId: "m",
      mod: "Lanterns",
      when: "2026-01-02T15:04:00.000Z",
      hosts: [{ id: "nexus", status: "success", name: "Nexus", message: "ok", url: "https://mods.example" }],
      note: { name: "Lanterns", version: "1", notes: "n", links: [null, { host: 1 }, { host: "Nexus", url: 4 }, { host: "Nexus", url: "https://mods.example" }] },
    });
    assert.equal(full?.note.links.length, 2);
    assert.equal(full?.note.links[0]?.url, "");
    assert.equal(hostLine(full!), "Nexus");
    assert.equal(failedLine(full!), "None");
    assert.equal(failedLine({ ...full!, hosts: [...full!.hosts, { id: "curseforge", name: "CurseForge", status: "error", message: "", url: "" }] }), "CurseForge");
    assert.deepEqual(readDeploymentList(null), []);
    assert.deepEqual(readDeploymentList({ kind: "omnimod-library" }), []);
    assert.deepEqual(readDeploymentList({ deployments: "no" }), []);
    assert.equal(readDeploymentList([null, full]).length, 1);
    assert.equal(readDeploymentList({ deployments: [full, { id: "no" }] }).length, 1);
  });

  it("builds a deployment from host results", () => {
    assert.equal(deploymentFrom({ id: "a", modId: "m", mod: "A", version: "1", notes: "", when: "now", results: [{ id: "nexus", status: "skipped", message: "off" }] }), null);
    const mixed = deploymentFrom({
      id: "a",
      modId: "m",
      mod: "A",
      version: "1",
      notes: "n",
      when: "now",
      results: [
        { id: "nexus", status: "success", message: "ok", url: " https://mods.example " },
        { id: "curseforge", status: "error", message: "no" },
        { id: "modrinth", status: "skipped", message: "off" },
      ],
    });
    assert.equal(mixed?.hosts.length, 2);
    assert.equal(mixed?.hosts[0]?.url, "https://mods.example");
    assert.equal(mixed?.note.links.length, 1);
    const plain = deploymentFrom({
      id: "b",
      modId: "m",
      mod: "B",
      version: "",
      notes: "",
      when: "",
      results: [{ id: "github", status: "success", message: "ok" }],
    });
    assert.equal(plain?.hosts[0]?.url, "");
  });

  it("filters and sorts the table", () => {
    const lanterns = row({ id: "1", mod: "Lanterns", when: "2026-01-02T15:04:00.000Z", hosts: [{ id: "nexus", name: "Nexus Mods", status: "success", message: "", url: "" }] });
    const moths = row({
      id: "2",
      mod: "Glass Moths",
      when: "not-a-date",
      hosts: [
        { id: "curseforge", name: "CurseForge", status: "error", message: "", url: "" },
        { id: "github", name: "GitHub Releases", status: "error", message: "", url: "" },
      ],
    });
    const harbor = row({ id: "3", mod: "Harbor", when: "2026-01-02T15:04:00.000Z" });
    const rows = [lanterns, moths, harbor];
    assert.deepEqual(filterDeployments(rows, {}).map((item) => item.id), ["1", "2", "3"]);
    assert.deepEqual(filterDeployments(rows, { mod: "glass" }).map((item) => item.id), ["2"]);
    assert.deepEqual(filterDeployments(rows, { mod: "missing" }), []);
    assert.deepEqual(filterDeployments(rows, { hosts: "curse" }).map((item) => item.id), ["2"]);
    assert.deepEqual(filterDeployments(rows, { hosts: "steam" }), []);
    assert.deepEqual(filterDeployments(rows, { when: "15:04" }).map((item) => item.id), ["1", "3"]);
    assert.deepEqual(filterDeployments(rows, { when: "not-a" }).map((item) => item.id), ["2"]);
    assert.deepEqual(filterDeployments(rows, { when: "T15" }).map((item) => item.id), ["1", "3"]);
    assert.deepEqual(filterDeployments(rows, { when: "yesterday" }), []);
    assert.deepEqual(filterDeployments(rows, { failed: "curse" }).map((item) => item.id), ["2"]);
    assert.deepEqual(filterDeployments(rows, { failed: "none" }).map((item) => item.id), ["1", "3"]);
    assert.deepEqual(filterDeployments(rows, { failed: "thunder" }), []);
    assert.deepEqual(sortDeployments(rows, "failed", "asc").map((item) => item.id), ["3", "1", "2"]);
    assert.deepEqual(sortDeployments(rows, "failed", "desc").map((item) => item.id), ["2", "3", "1"]);
    assert.deepEqual(sortDeployments(rows, "when", "asc").map((item) => item.id)[0], "2");
    assert.equal(sortDeployments([lanterns, harbor], "when", "asc")[0]?.mod, "Harbor");
    assert.equal(sortDeployments([lanterns, harbor], "when", "desc")[0]?.mod, "Harbor");
    assert.deepEqual(sortDeployments([moths, row({ id: "4", mod: "Amber", when: "also-bad" })], "when", "asc").map((item) => item.mod), ["Amber", "Glass Moths"]);
    assert.deepEqual(sortDeployments(rows, "hosts", "asc").map((item) => item.id)[0], "2");
    assert.deepEqual(sortDeployments(rows, "hosts", "desc").map((item) => item.id)[0], "1");
    assert.deepEqual(sortDeployments(rows, "mod", "asc").map((item) => item.mod), ["Glass Moths", "Harbor", "Lanterns"]);
    assert.deepEqual(sortDeployments(rows, "mod", "desc").map((item) => item.mod), ["Lanterns", "Harbor", "Glass Moths"]);
  });

  it("windows rows and edits notes", async () => {
    const rows = ["a", "b", "c", "d"];
    assert.deepEqual(windowRows(rows, 0, 0, 40).items, rows);
    assert.deepEqual(windowRows(rows, 0, 80, 0).items, rows);
    assert.deepEqual(windowRows(rows, -10, 40, 40), { start: 0, end: 2, items: ["a", "b"] });
    assert.deepEqual(windowRows(rows, 80, 40, 40).items, ["c", "d"]);
    const note = { name: "Lanterns", version: "", notes: "", links: [{ host: "Nexus Mods", url: "" }] };
    assert.equal(addNoteLink(note, "Nexus Mods", "https://mods.example"), note);
    assert.equal(addNoteLink(note, "CurseForge", "https://cf.example").links.length, 2);
    assert.equal(noteText({ name: " ", version: "", notes: "", links: [{ host: "", url: "" }, { host: "Nexus", url: "" }] }), "Untitled mod\n\nNexus");
    assert.equal(noteText({ name: "Lanterns", version: "1.2.0", notes: "Warmer.", links: [{ host: "Nexus", url: "https://mods.example" }] }), "Lanterns\n\nVersion 1.2.0\n\nWarmer.\n\nNexus\nhttps://mods.example");
    const clip = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await copyNote({ name: "Lanterns", version: "", notes: "", links: [] });
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });
    await copyNote({ name: "Lanterns", version: "1", notes: "", links: [] });
    assert.match(copied, /Lanterns/);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clip });
    const base = row({ id: "1", mod: "Lanterns" });
    const marked = markHost(base, "nexus", { status: "success", message: "sent", url: "https://mods.example" });
    assert.equal(marked.hosts[0]?.url, "https://mods.example");
    assert.equal(marked.note.links[0]?.host, "Nexus Mods");
    assert.equal(markHost(marked, "nexus", { status: "success", message: "sent", url: "https://mods.example" }).note, marked.note);
    assert.equal(markHost(base, "github", { status: "success", message: "sent", url: "" }).note, base.note);
    assert.equal(rememberDeployment([base], null).length, 1);
    assert.equal(rememberDeployment([base], row({ id: "2", mod: "Other" }))[0]?.id, "2");
    assert.equal(adoptDeployment(null, "keep"), "keep");
    assert.equal(adoptDeployment(base, null), "1");
    assert.equal(shouldReleaseHold([{ status: "success" }, { status: "skipped" }]), true);
    assert.equal(shouldReleaseHold([{ status: "error" }]), false);
    assert.deepEqual(hostsOf([base], "missing"), []);
    assert.equal(hostsOf([base], "1").length, 1);
    assert.equal(releaseAfterRetry([]), false);
    assert.equal(releaseAfterRetry([{ status: "error" }]), false);
    assert.equal(releaseAfterRetry([{ status: "success" }]), true);
    assert.equal(canRetryHeld("a", "b", { file: new Blob(), zip: null, sources: 0 }), false);
    assert.equal(canRetryHeld("a", "a", null), false);
    assert.equal(canRetryHeld("a", "a", { file: new Blob(["a"]), zip: null, sources: 0 }), true);
    assert.equal(canRetryHeld("a", "a", { file: null, zip: new Blob(["z"]), sources: 0 }), true);
    assert.equal(canRetryHeld("a", "a", { file: null, zip: null, sources: 2 }), true);
    assert.equal(canRetryHeld("a", "a", { file: null, zip: null, sources: 0 }), false);
    assert.deepEqual(retryArchive("bells.jar", false, ""), { fileName: "bells.jar", zip: false });
    assert.deepEqual(retryArchive("bells.zip", true, ""), { fileName: "bells.zip", zip: false });
    assert.deepEqual(retryArchive("bells.jar", true, "harbor"), { fileName: "harbor.zip", zip: true });
    assert.deepEqual(retryArchive("bells.jar", true, ""), { fileName: "bells.zip", zip: true });
    const linked = { id: "m", name: "Lanterns", autoZip: false, zipName: "", version: "2.0.0", changelog: "from mod" };
    assert.deepEqual(retrySpec({ modId: "m", mod: "Lanterns", note: { version: "1.0.0", notes: "Earlier." } }, [linked], "bells.zip"), {
      fileName: "bells.zip",
      zip: false,
      version: "1.0.0",
      changelog: "Earlier.",
      autoZip: false,
      zipName: "",
    });
    const named = { id: "other", name: "Lanterns", autoZip: true, zipName: "harbor", version: "3.0.0", changelog: "mod notes" };
    assert.deepEqual(retrySpec({ modId: "missing", mod: "Lanterns", note: { version: "", notes: "" } }, [named], "bells.jar"), {
      fileName: "harbor.zip",
      zip: true,
      version: "3.0.0",
      changelog: "mod notes",
      autoZip: true,
      zipName: "harbor",
    });
    assert.equal(retrySpec({ modId: "missing", mod: "Gone", note: { version: "", notes: "" } }, [linked], "bells.zip").version, "");
  });

  it("searches every column or only the chosen chips and windows uneven rows", () => {
    const lanterns = row({ id: "1", mod: "Lanterns", when: "2026-03-04T12:30:00.000Z", hosts: [{ id: "nexus", name: "Nexus Mods", status: "success", message: "", url: "" }] });
    const moths = row({
      id: "2",
      mod: "Glass Moths",
      when: "not-a-date",
      hosts: [
        { id: "curseforge", name: "CurseForge", status: "error", message: "", url: "" },
        { id: "github", name: "GitHub Releases", status: "error", message: "", url: "" },
      ],
    });
    const rows = [lanterns, moths];
    assert.deepEqual(searchDeployments(rows, "  ", ["mod"]).map((item) => item.id), ["1", "2"]);
    assert.deepEqual(searchDeployments(rows, "curse", []).map((item) => item.id), ["2"]);
    assert.deepEqual(searchDeployments(rows, "glass", ["mod"]).map((item) => item.id), ["2"]);
    assert.deepEqual(searchDeployments(rows, "curse", ["mod"]), []);
    assert.deepEqual(searchDeployments(rows, "12:30", ["when"]).map((item) => item.id), ["1"]);
    assert.deepEqual(searchDeployments(rows, "2", ["failed"]).map((item) => item.id), ["2"]);
    assert.deepEqual(searchDeployments(rows, "nexus", ["hosts"]).map((item) => item.id), ["1"]);
    assert.deepEqual(spanTops([]), []);
    assert.deepEqual(spanTops([10, 20]), [0, 10]);
    assert.deepEqual(windowSpans([], 0, 40), { start: 0, end: 0, total: 0 });
    assert.deepEqual(windowSpans([10, 10, 10], 0, 0), { start: 0, end: 3, total: 30 });
    assert.deepEqual(windowSpans([10, 10, 10], 0, 10), { start: 0, end: 2, total: 30 });
    assert.deepEqual(windowSpans([10, 10, 10], 0, 100), { start: 0, end: 3, total: 30 });
    assert.deepEqual(windowSpans([10, 10, 10], 10, 10), { start: 1, end: 3, total: 30 });
    assert.deepEqual(windowSpans([10, 20], 100, 10), { start: 2, end: 2, total: 30 });
    assert.equal(panelHeight(2, 2, 840), 216);
    assert.equal(panelHeight(1, 0, 840), 168);
    assert.equal(panelHeight(2, 2, 839), 224);
    assert.equal(panelHeight(1, 0, 839), 176);
    const runs = markRun(
      [
        { id: "nexus", name: "Nexus Mods", state: "queued" },
        { id: "curseforge", name: "CurseForge", state: "queued" },
      ],
      "nexus",
      "sending",
    );
    assert.equal(runs[0]?.state, "sending");
    assert.equal(runs[1]?.state, "queued");
    assert.equal(runLabel("queued"), "Waiting");
    assert.equal(runLabel("sending"), "Sending");
    assert.equal(runLabel("sent"), "Sent");
    assert.equal(runLabel("failed"), "Failed");
  });
});
