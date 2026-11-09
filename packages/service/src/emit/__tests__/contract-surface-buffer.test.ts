import { describe, it, expect } from "vitest";
import { contractSurface } from "../contract-surface.ts";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("E5 contractSurface buffer source", () => {
  it("prefers opts.source over disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-contract-buf-"));
    const file = join(dir, "greet.js");
    writeFileSync(file, `export function greet(n) { return n; }\n`);
    const buffer = `export function greet(n) { return "hi " + n; }\nexport function extra() { return 1; }\n`;
    const entries = await contractSurface(file, { source: buffer, autoBind: false });
    const names = entries.map((e) => e.fn);
    expect(names).toContain("greet");
    expect(names).toContain("extra");
  });
});
