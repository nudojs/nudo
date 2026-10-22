/**
 * 族 06 收口接线（2）—— **合取读侧看不穿嵌套 `and`** ⇒ 入口契约里的事实被静默丢弃。
 *
 * 触发链（族 06 Bug 333/335 引入 `typeof` 类型义务后才有嵌套）：
 * 1. 入口契约谓词逐条进 Φ，而每条谓词本身是合取（`and(typeof x, ge(x,0))`）；
 * 2. Φ 用裸 `{op:"and",args:[…]}` 合成 ⇒ Φ = `and(and(…), and(…))`；
 * 3. 合取读侧（`buildCtx` / `collectBoundsFromPhi` / `impliesNotTypeof` …）
 *    只扫**顶层** `and.args` ⇒ 内层原子（`ge(max,1)`）不可见；
 * 4. ⇒ `implies(Φ, ne(max,0))` 证不出 ⇒ `max === 0 ? 1 : …` 的**死臂**
 *    没被剪掉 ⇒ 签名退化成 `=> 1 | number`（多一个恒被契约排除的臂）。
 *
 * 修法（**读侧**修正，不动任何已构造谓词的形状 ⇒ 展示串 / 谓词相等判定 /
 * 缓存键零漂移）：
 * - 合取读侧递归展平（合取可结合：`and(and(A,B),C)` ≡ `and(A,B,C)`）；
 * - 入口 Φ 的合成改用 `and()`（展平一层）。
 *
 * 反向闸：本文件的「嵌套 Φ 仍看得见事实」一例在 HEAD 上**必须失败**
 * （HEAD 的 `buildCtx` 只扫顶层 ⇒ `implies` 证不出 `ne(max,0)`）。
 */
import { describe, it, expect } from "vitest";
import { and, checkSource, ge, implies, lit, ne, pTrue, ptypeof, v } from "../index.ts";
import { stdOpts } from "./nudo-constraints.ts";

/** 同名侧车：源文件 file.js ⇒ 侧车 file.nudo.js */
function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

/** 源文件：`max === 0` 的真臂在 `max ≥ 1` 下不可达 ⇒ 死臂应被剪掉 */
const SRC = `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) { return max === 0 ? 1 : 1 - d / max; }
`;

/** `max ≥ 1` ⇒ `max === 0` 不可达（死臂） */
const SIDE_DEAD = `
import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number());
`;

/** `max ≥ 0` ⇒ `max === 0` 可达（负控制：死臂必须留下） */
const SIDE_LIVE = `
import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(0) }, number());
`;

describe("族 06 接线：合取读侧看不穿嵌套 and", () => {
  it("implies 看得见嵌套 and 里的事实（HEAD 上证不出）", () => {
    // 嵌套 Φ：每条入口谓词本身是合取
    const nested = {
      op: "and" as const,
      args: [
        and(ptypeof(v("d"), "number"), ge(v("d"), lit(0))),
        and(ptypeof(v("max"), "number"), ge(v("max"), lit(1))),
      ],
    };
    // `max ≥ 1` ⇒ `max ≠ 0`（死臂剪枝的前提）
    expect(implies(nested, ne(v("max"), lit(0)))).toBe(true);
    // 展平后的同一 Φ 结论一致（合取可结合）
    const flat = and(
      and(ptypeof(v("d"), "number"), ge(v("d"), lit(0))),
      and(ptypeof(v("max"), "number"), ge(v("max"), lit(1))),
    );
    expect(implies(flat, ne(v("max"), lit(0)))).toBe(true);
  });

  it("嵌套 Φ 里的区间事实也参与界判定", () => {
    const nested = {
      op: "and" as const,
      args: [and(ptypeof(v("max"), "number"), ge(v("max"), lit(1)))],
    };
    expect(implies(nested, ge(v("max"), lit(1)))).toBe(true);
    expect(implies(nested, { op: "gt", a: v("max"), b: lit(0) })).toBe(true);
  });

  it("产品面：契约排除的死臂被剪掉（签名不是 1 | number）", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(SIDE_DEAD));
    const sig = r.signatures.find((s) => s.name === "sim");
    expect(sig).toBeDefined();
    // 返回位：单臂（prim number），不是 sum（1 | number）
    expect(sig!.abs.shape.k).toBe("prim");
    expect(sig!.display).not.toContain("1 |");
  });

  it("负控制：`max === 0` 可达时死臂必须留下", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(SIDE_LIVE));
    const sig = r.signatures.find((s) => s.name === "sim");
    expect(sig).toBeDefined();
    // `max ≥ 0` 不排除 `max === 0` ⇒ 两臂都在（剪掉就是假精确）
    expect(sig!.abs.shape.k).toBe("sum");
    expect(sig!.display).toContain("1 |");
  });
});
