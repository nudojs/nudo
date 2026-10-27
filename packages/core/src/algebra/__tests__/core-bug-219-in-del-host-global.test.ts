/**
 * Bug 219：`delete <宿主全局>.x` / `"x" in <宿主全局>` 把**宿主真对象**喂进
 * `$del` / `$delRes` / `$in` ⇒ 引擎**裸 TypeError 崩溃** ⇒ 回落 `internal`
 * ⇒ `nudo check` 对**合法代码**假红（exit 1，还把引擎内部报错原文吐给用户）。
 *
 * `globalThis` / `process` / `Math` … 是自由标识符 ⇒ 转译层原样当接收者发射，
 * 它们**不是 Abs**（没有 `.shape`）。`$get` / `$set` / `$len` / `$idx` /
 * `$idxSet` 都已有 DEC-006 非-Abs 守卫，唯独 `$in` / `$del` / `$delRes` 直接读
 * `o.shape.k` ⇒ `Cannot read properties of undefined (reading 'k')` ⇒ 一处崩
 * ⇒ **整模块**分析作废（导出退化 unknown）。同语义的读 / 写（`globalThis.x`、
 * `globalThis.x = 1`）却不崩——两条路结论互斥。
 *
 * 口径与 `$set` 同款：非 Abs 接收者 fail-closed——`$del` 返回原接收者
 * （写回通道的自赋值 no-op）、`$delRes` / `$in` 返回 `unknown`（键集不可判）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { type EvalFallback } from "../exec/run.ts";
import { setEvalFallbackCollector } from "../exec/run.ts";

/** 采集一次 runTranspiled 的回落事件（含 internal） */
function withFallbacks<T>(body: () => T): { out: T; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { out: body(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

describe("Bug 219：in / delete 的宿主全局接收者不得炸引擎", () => {
  it(`"FLAG" in globalThis ⇒ 模块正常求值（改前：裸 TypeError / internal 回落）`, () => {
    const src = `export function f(){ return "FLAG" in globalThis; }`;
    const { out, fallbacks } = withFallbacks(() => runTranspiled(src, { mode: "analyze" }));
    // 改前这里直接抛 `Cannot read properties of undefined (reading 'k')`
    expect(Object.keys(out)).toContain("f");
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    const r = callTranspiledExportFull(out, "f", []);
    // 键集不可判 ⇒ unknown（不得谎称 boolean，更不得谎称 throws TypeError）
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("delete globalThis.x ⇒ 模块正常求值，$del / $delRes 双通道都不崩", () => {
    const src = `export function f(){ return delete globalThis.__nudoProbe; }`;
    const { out, fallbacks } = withFallbacks(() => runTranspiled(src, { mode: "analyze" }));
    expect(Object.keys(out)).toContain("f");
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    const r = callTranspiledExportFull(out, "f", []);
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("负控：普通对象的 in / delete 口径不变（精确判定不被守卫吃掉）", () => {
    const { out } = withFallbacks(() =>
      runTranspiled(
        `export function f(){ const o = { a: 1 }; return "a" in o; }
export function g(){ const o = { a: 1 }; return delete o.a; }`,
        { mode: "analyze" },
      ),
    );
    expect(callTranspiledExportFull(out, "f", []).result.shape).toEqual({ k: "prim", type: "boolean" });
  });
});
