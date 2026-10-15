import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { archiveName, makeZip } from "./zip.ts";

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
});
