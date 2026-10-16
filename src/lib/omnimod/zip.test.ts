import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { archiveName, completeThunderstoreZip, makeZip, pngIconFits, pngSize, readStoredZip } from "./zip.ts";

describe("zip", () => {
  it("names the archive from the field or the first file", () => {
    assert.equal(archiveName(["mod.jar"], "Bundle.zip"), "Bundle.zip");
    assert.equal(archiveName(["mod.jar"], "Bundle.ZIP"), "Bundle.ZIP");
    assert.equal(archiveName(["mod.jar"], "Bundle"), "Bundle.zip");
    assert.equal(archiveName(["mod.jar"], "  "), "mod.zip");
    assert.equal(archiveName([], ""), "package.zip");
    assert.equal(archiveName(["  "], ""), "package.zip");
    assert.equal(archiveName(["README"], ""), "README.zip");
    assert.equal(archiveName([".jar"], ""), ".jar.zip");
  });

  it("stores files at the root of a zip", async () => {
    const file = makeZip([{ name: "mod.jar", bytes: new Uint8Array([1, 2, 3]) }], "mod.zip");
    assert.equal(file.name, "mod.zip");
    assert.equal(file.type, "application/zip");
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);
    assert.match(new TextDecoder().decode(bytes), /mod\.jar/);
    const empty = makeZip([], "empty.zip");
    const end = new Uint8Array(await empty.arrayBuffer());
    assert.equal(end.length, 22);
    assert.equal(end[0], 0x50);
    assert.equal(end[2], 0x05);
    assert.equal(end[3], 0x06);
  });

  it("adds the thunderstore root files to a stored zip", async () => {
    const input = { fileName: "mods/My Project!.zip", version: "build 0.0.6", changelog: "First line.\nSecond." };
    const mark = new Uint8Array([137, 80, 78, 71]);
    const bare = makeZip([{ name: "mod.jar", bytes: new Uint8Array([9]) }], "MyProject.zip");
    const packed = completeThunderstoreZip(new Uint8Array(await bare.arrayBuffer()), input, mark);
    assert.ok(packed);
    const entries = readStoredZip(new Uint8Array(await packed.arrayBuffer()));
    assert.deepEqual(entries?.map((entry) => entry.name).sort(), ["README.md", "icon.png", "manifest.json", "mod.jar"]);
    const manifest = JSON.parse(new TextDecoder().decode(entries?.find((entry) => entry.name === "manifest.json")?.bytes));
    assert.equal(manifest.name, "MyProject");
    assert.equal(manifest.version_number, "0.0.6");
    assert.equal(manifest.description, "First line. Second.");
    assert.deepEqual(manifest.dependencies, []);
    const readme = new TextDecoder().decode(entries?.find((entry) => entry.name === "README.md")?.bytes);
    assert.equal(readme, "First line.\nSecond.");
    const icon = entries?.find((entry) => entry.name === "icon.png")?.bytes ?? new Uint8Array();
    assert.deepEqual(icon, mark);
    const skipped = completeThunderstoreZip(new Uint8Array(await bare.arrayBuffer()), input, new Uint8Array());
    assert.equal(readStoredZip(new Uint8Array(await skipped!.arrayBuffer()))?.some((entry) => entry.name === "icon.png"), false);
    const ready = makeZip(
      [
        { name: "icon.png", bytes: new Uint8Array([1]) },
        { name: "README.md", bytes: new Uint8Array([2]) },
        { name: "manifest.json", bytes: new Uint8Array([3]) },
      ],
      "ready.zip",
    );
    assert.equal(completeThunderstoreZip(new Uint8Array(await ready.arrayBuffer()), input), null);
    const named = makeZip([{ name: "mod.jar", bytes: new Uint8Array([1]) }], "plain.zip");
    const fallback = completeThunderstoreZip(new Uint8Array(await named.arrayBuffer()), {
      fileName: "!!!.zip",
      version: "soon",
      changelog: "   ",
    });
    const fallbackEntries = readStoredZip(new Uint8Array(await fallback!.arrayBuffer()));
    const fallbackManifest = JSON.parse(
      new TextDecoder().decode(fallbackEntries?.find((entry) => entry.name === "manifest.json")?.bytes),
    );
    assert.equal(fallbackManifest.name, "Package");
    assert.equal(fallbackManifest.version_number, "1.0.0");
    assert.equal(fallbackManifest.description, "Package");
    const unnamed = completeThunderstoreZip(new Uint8Array(await named.arrayBuffer()), {
      fileName: " ",
      version: "1.0.0",
      changelog: "Notes",
    });
    assert.equal(unnamed?.name, "package.zip");
    const hasIcon = makeZip([{ name: "icon.png", bytes: new Uint8Array([1]) }, { name: "mod.jar", bytes: new Uint8Array([2]) }], "mod.zip");
    const noted = completeThunderstoreZip(new Uint8Array(await hasIcon.arrayBuffer()), input);
    const notedNames = readStoredZip(new Uint8Array(await noted!.arrayBuffer()))?.map((entry) => entry.name);
    assert.ok(notedNames?.includes("README.md"));
    assert.equal(notedNames?.filter((name) => name === "icon.png").length, 1);
    const only = makeZip(
      [
        { name: "README.md", bytes: new TextEncoder().encode("keep") },
        { name: "manifest.json", bytes: new TextEncoder().encode("{}") },
        { name: "dir/", bytes: new Uint8Array() },
        { name: "", bytes: new Uint8Array() },
      ],
      "partial.zip",
    );
    const withIcon = completeThunderstoreZip(
      new Uint8Array(await only.arrayBuffer()),
      {
        fileName: "Partial",
        version: "1.2.3",
        changelog: "Kept.",
      },
      mark,
    );
    assert.equal(withIcon?.name, "Partial.zip");
    const kept = readStoredZip(new Uint8Array(await withIcon!.arrayBuffer()));
    assert.equal(new TextDecoder().decode(kept?.find((entry) => entry.name === "README.md")?.bytes), "keep");
    assert.ok(kept?.some((entry) => entry.name === "icon.png"));
    assert.equal(readStoredZip(new Uint8Array(4)), null);
    assert.equal(readStoredZip(new Uint8Array(24)), null);
    const stored = new Uint8Array(await bare.arrayBuffer());
    const method = stored.slice();
    method[8] = 8;
    assert.equal(readStoredZip(method), null);
    const flagged = stored.slice();
    flagged[6] = flagged[6] | 0x08;
    assert.equal(readStoredZip(flagged), null);
    const centralAt = stored.findIndex((_, index) => stored[index] === 0x50 && stored[index + 1] === 0x4b && stored[index + 2] === 0x01);
    assert.equal(readStoredZip(stored.slice(0, centralAt))?.[0]?.name, "mod.jar");
    assert.equal(readStoredZip(stored.slice(0, centralAt - 1)), null);
    const empty = new Uint8Array(30);
    empty.set(new Uint8Array(await makeZip([], "empty.zip").arrayBuffer()));
    const filled = completeThunderstoreZip(empty, input, mark);
    assert.equal(readStoredZip(new Uint8Array(await filled!.arrayBuffer()))?.length, 3);
    const picture = new Uint8Array(24);
    picture.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const iconView = new DataView(picture.buffer);
    iconView.setUint32(16, 256);
    iconView.setUint32(20, 256);
    assert.deepEqual(pngSize(picture), { width: 256, height: 256 });
    assert.equal(pngIconFits(picture), true);
    assert.equal(pngSize(picture.slice(0, 8)), null);
    const late = picture.slice();
    late[7] = 0;
    assert.equal(pngSize(late), null);
    assert.equal(pngSize(new Uint8Array(24)), null);
    const wrong = picture.slice();
    wrong[12] = 0;
    assert.equal(pngSize(wrong), null);
    iconView.setUint32(16, 0);
    assert.equal(pngSize(picture), null);
    iconView.setUint32(16, 16);
    iconView.setUint32(20, 0);
    assert.equal(pngSize(picture), null);
    iconView.setUint32(20, 300);
    assert.equal(pngIconFits(picture), false);
    iconView.setUint32(16, 300);
    iconView.setUint32(20, 16);
    assert.equal(pngIconFits(picture), false);
    const heavy = new Uint8Array(512 * 1024 + 1);
    heavy.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(heavy.buffer).setUint32(16, 16);
    new DataView(heavy.buffer).setUint32(20, 16);
    assert.equal(pngIconFits(heavy), false);
  });
});
