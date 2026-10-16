import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { PLATFORMS } from "./catalog.ts";

describe("host keys", () => {
  it("only reads field names that the catalog declares", () => {
    const declared = new Set(PLATFORMS.flatMap((platform) => platform.fields.map((field) => field.key)));
    const root = path.resolve("src/lib/omnimod");
    const unknown: string[] = [];
    for (const file of ["live.ts", "publish.ts"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      for (const match of source.matchAll(/(?<![.\w])(?:fields|host|over)\.([A-Za-z][A-Za-z0-9]*)/g)) {
        const key = match[1] ?? "";
        if (!declared.has(key)) unknown.push(`${file} ${key}`);
      }
    }
    assert.deepEqual(unknown, []);
  });
});
