import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, clearBPathCache, tryBPathCallFull } from "@nudojs/service";
import { $lit } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path method-missing diagnostics", () => {
  it("records no-method on number receiver via B execution", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-md-"));
    dirs.push(dir);
    const src = `
export function badNum(n) {
  return n.toUpperCase();
}
`;
    const p = join(dir, "m.js");
    writeFileSync(p, src, "utf-8");
    const full = tryBPathCallFull(src, p, "badNum", [$lit(42)]);
    expect(full).toBeDefined();
    expect(full!.memberDiags?.length).toBeGreaterThanOrEqual(1);
    expect(full!.memberDiags![0]!.name).toBe("toUpperCase");
    expect(full!.memberDiags![0]!.receiver).toBe("number");
  });

  it("analyzeFile still reports no-method for top-level call", () => {
    clearBPathCache();
    const source = `
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const result = analyzeFile("/test/badnum2.js", source);
    const diags = result.diagnostics.filter((d) => d.code === "nudo:no-method");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0]!.message).toContain("toUpperCase");
  });
});
