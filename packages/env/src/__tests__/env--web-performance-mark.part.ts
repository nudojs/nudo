import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkWeb, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 15 · BUG-149 — web env 把 `performance.mark` 的返回类型**写死成
 * `undefined`**（宿主返回 `PerformanceMark`）⇒ `m.name` 读在 undefined 上
 * ⇒ 判「确定抛 TypeError」⇒ L2 假红；node env 同一 API 对 ⇒ 两 env 互斥。
 *
 * 反向钉：把 `mark` 的返回改回 `undef()` ⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 149 — performance.mark/measure return PerformanceEntry values", () => {
  it("host oracle: mark returns PerformanceMark with .name", () => {
    const out = host(`
      const m = performance.mark("start");
      console.log(JSON.stringify({ ctor: m.constructor.name, name: m.name }));
    `);
    expect(JSON.parse(out)).toEqual({ ctor: "PerformanceMark", name: "start" });
  });

  it("mark().name folds to string (was definite TypeError)", () => {
    const out = checkWeb(`export function markName(){ const m = performance.mark("start"); return m.name; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
    expect(out.signatures[0]!.display).toBe("string");
  });

  it("mark() is declared as a PerformanceMark brand, not undefined", () => {
    const mark = slotOf("performance", "mark");
    expect(mark?.shape.k).toBe("fn");
    const ret = (mark!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
    expect(ret?.shape.k).toBe("brand");
    expect(ret?.shape.name).toBe("PerformanceMark");
  });

  it("measure() returns a PerformanceMeasure with .name / .duration", () => {
    const out = checkWeb(`export function f(){ const m = performance.measure("x"); return [m.name, m.duration]; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toContain("string");
    expect(out.signatures[0]!.display).toContain("number");
  });
});
