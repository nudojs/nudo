import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTranspiled, callTranspiledExportFull, num } from "@nudojs/core";
import { runWithCollectorScope, setAbsTruncationCollector } from "@nudojs/core/internal";
import { analyzeFileAsync } from "@nudojs/service";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("collector scope across await", () => {
  it("scoped: interleaved analyses keep their own truncation collector across await", async () => {
    // 两个分析在 await 处交错：无作用域时模块级 fallback 会被后装者覆盖
    // （A 的截断落进 B 的 seen、B 醒来时 collector 已被 A 还原成 prev）。
    // runWithCollectorScope 各开各的 store：await 续在原 store，互不串台。
    const analysis = (fnName: string, delay: number) =>
      runWithCollectorScope(async () => {
        const seen: string[] = [];
        const prev = setAbsTruncationCollector((l) => seen.push(l));
        await new Promise<void>((r) => setTimeout(r, delay));
        const run = runTranspiled(
          `export function ${fnName}(n){ return n <= 0 ? 0 : ${fnName}(n-1); }`,
          { mode: "analyze" },
        );
        // num() 实参下递归每层同 shape → cycle/深度预算截断，label = 函数名
        callTranspiledExportFull(run, fnName, [num()]);
        setAbsTruncationCollector(prev);
        return seen;
      });
    const [seenA, seenB] = await Promise.all([analysis("recA", 5), analysis("recB", 20)]);
    expect(seenA.length).toBeGreaterThan(0);
    expect(seenA.every((l) => l === "recA")).toBe(true);
    expect(seenB.length).toBeGreaterThan(0);
    expect(seenB.every((l) => l === "recB")).toBe(true);
  });

  it("analyzeFileAsync x2 concurrent on same source stays correct", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-collector-scope-"));
    dirs.push(dir);
    const f = join(dir, "id.js");
    const src = "export function id(x){return x;}";
    const [a, b] = await Promise.all([analyzeFileAsync(f, src), analyzeFileAsync(f, src)]);
    expect(a.functions.length).toBeGreaterThan(0);
    expect(a.functions.length).toBe(b.functions.length);
    expect(a.functions[0]?.name).toBe("id");
    expect(b.functions[0]?.name).toBe("id");
  });
});
