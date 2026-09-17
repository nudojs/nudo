import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryBPathCallFull, analyzeFile, resetAllAnalysisCaches } from "@nudojs/service";
import { $lit, litValue, typeValueToString, formatShape } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// 用例级缓存隔离：tryBPathCallFull / analyzeFile 背后的 bRunCache 及级联的
// analysisFileCache·fnAnalysisCache、absModuleCache、core memo 全部清空。
beforeEach(() => {
  resetAllAnalysisCaches();
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
      expect(formatShape(hit.abs)).toBe("10");
    }
  });

  it("directive case on one fn does not re-collect module-level calls into others", () => {
    // 回归：tryBPathCallFull 曾把 run.calls（模块级顶层调用）一并返回，
    // directive-case 分支把这些重复记录推回 callRecords——B 路径结果
    // （map 返回 [unknown, ...]）与 Abs 精确结果键不同，dedupe 无法合并，
    // 被调函数因此多出重复 call@L case 与一个 call@symbolic 聚合 case，
    // Combined 也被 unknown 形态污染。
    const source = [
      "function map2(arr, fn) { return arr.map(fn); }",
      "map2([1, 2, 3], (x) => x * 2);",
      "map2(['a', 'b'], (s) => s.toUpperCase());",
      "",
      "/**",
      ' * @nudo:case "unrelated" (T.number)',
      " */",
      "function unrelated(x) { return x + 1; }",
    ].join("\n");
    const result = analyzeFile("/test/bcall-pollute.js", source);
    const map2 = result.functions.find((f) => f.name === "map2");
    expect(map2).toBeDefined();
    const names = map2!.cases.map((c) => c.name);
    expect(names).toEqual(["call@L2", "call@L3"]);
    const results = map2!.cases.map((c) => formatShape(c.abs));
    expect(results).toEqual(["[2, 4, 6]", '["A", "B"]']);
    expect(formatShape(map2!.combinedAbs!)).toBe('[2, 4, 6] | ["A", "B"]');
  });
});
