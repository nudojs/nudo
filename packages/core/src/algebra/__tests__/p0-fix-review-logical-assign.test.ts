import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, formatAbs, type Abs } from "@nudojs/core";

/** B 路径驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
function analyzeExport(src: string, fnName: string, args: Abs[]): Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args).result;
}

describe("P0 logical assignment on non-lit LHS", () => {
  it("||= keeps truthy abstract LHS via join (not RHS-only)", () => {
    const src = `
      export function f(a) {
        let x = a; // abstract
        x ||= 0;
        return x;
      }
    `;
    const r = analyzeExport(src, "f", []);
    const text = formatAbs(r as never);
    // join(a, 0) — 不得只剩 RHS 0
    expect(text).not.toBe("0");
  });

  it("??= keeps non-nullish abstract LHS via join", () => {
    const src = `
      export function f(a) {
        let x = { n: a };
        x ??= null;
        return x;
      }
    `;
    const r = analyzeExport(src, "f", []);
    const text = formatAbs(r as never);
    // 对象 shape 非 nullish → 应保留 x，不是只留 null
    expect(text).not.toBe("null");
  });

  it("concrete null ??= still assigns RHS", () => {
    const src = `
      export function f(a) {
        let x = null;
        x ??= a;
        return x;
      }
    `;
    const r = analyzeExport(src, "f", []);
    const text = formatAbs(r as never);
    expect(text).not.toBe("null");
  });
});
