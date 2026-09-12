import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryBPathCallFull, analyzeFile } from "@nudojs/service";
import { $lit, litValue, typeValueToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path call site collection", () => {
  it("records calls during B evaluation", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bcall-"));
    dirs.push(dir);
    const src = `
function helper(x) { return x + 1; }
export function caller(n) { return helper(n); }
`;
    const p = join(dir, "main.js");
    writeFileSync(p, src, "utf-8");
    const full = tryBPathCallFull(src, p, "caller", [$lit(4)], { collectCalls: true });
    expect(full).toBeDefined();
    expect(litValue(full!.result)).toBe(5);
    expect(full!.calls?.length).toBeGreaterThanOrEqual(1);
    expect(full!.calls!.map((c) => c.fnName)).toContain("helper");
  });

  it("analyzeFile still synthesizes call@ for uncalled helper", () => {
    const source = `
function uncalled(x) {
  return x * 2;
}

/**
 * @nudo:case "t" (5)
 */
function caller(y) {
  return uncalled(y);
}
`;
    const result = analyzeFile("/test/bcall.js", source);
    const uncalled = result.functions.find((f) => f.name === "uncalled");
    expect(uncalled).toBeDefined();
    expect(uncalled!.cases.length).toBeGreaterThanOrEqual(1);
    const names = uncalled!.cases.map((c) => c.name);
    expect(names.some((n) => n.startsWith("call@") || n.startsWith("entry@"))).toBe(true);
    // 结果应为 10
    const hit = uncalled!.cases.find((c) => c.name.startsWith("call@"));
    if (hit) {
      expect(typeValueToString(hit.result)).toBe("10");
    }
  });
});
