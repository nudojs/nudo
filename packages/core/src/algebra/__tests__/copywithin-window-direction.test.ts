/**
 * copyWithin 方向：ES 用**相对解析后**的 from/to 判 overlap
 * （from < to && from+count > to → 倒序）。此前比较原始 toIOI 的 s/t，
 * 负下标会翻方向：
 *   [0,1,2,3,4].copyWithin(1,-3)  原生 [0,2,3,4,4]，引擎 [0,4,4,4,4]
 *   [0,1,2,3,4].copyWithin(-3,1)  原生 [0,1,1,2,3]，引擎 [0,1,1,1,1]
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function json(src: string) {
  const exports = runTranspiled(`export function f() { return JSON.stringify(${src}); }`, {
    mode: "exec",
    maxLoopIters: 2000,
  });
  return litValue(callTranspiledExportFull(exports, "f", []).result);
}

describe("copyWithin direction uses resolved window indices", () => {
  it("copyWithin(1,-3) on [0..4] → [0,2,3,4,4] (forward, from=2>to=1)", () => {
    expect(json(`(()=>{ const a=[0,1,2,3,4]; a.copyWithin(1,-3); return a; })()`)).toBe("[0,2,3,4,4]");
  });

  it("copyWithin(-3,1) on [0..4] → [0,1,1,2,3] (backwards overlap)", () => {
    expect(json(`(()=>{ const a=[0,1,2,3,4]; a.copyWithin(-3,1); return a; })()`)).toBe("[0,1,1,2,3]");
  });

  it("copyWithin(0,2) forward non-overlap", () => {
    expect(json(`(()=>{ const a=[0,1,2,3,4]; a.copyWithin(0,2); return a; })()`)).toBe("[2,3,4,3,4]");
  });

  it("copyWithin(2,0,2) backwards overlap", () => {
    expect(json(`(()=>{ const a=[0,1,2,3,4]; a.copyWithin(2,0,2); return a; })()`)).toBe("[0,1,0,1,4]");
  });
});
