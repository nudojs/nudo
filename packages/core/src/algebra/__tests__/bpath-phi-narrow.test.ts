/**
 * Φ-native B（B 侧路径条件收窄）验收：
 * ①嵌套非字面量比较：Φ'（外层真臂的 x>y）证明内层同测试 → 剪枝（1|3 而非 1|2|3）
 * ②refine 契约经 Φ 种子：`if (x>0) return x` 在 Φ=x>0 下剪枝且结果保 term/pred
 * ③变更案例（健全性回归）：调用变更字段后重测——引用语义自失效（2|3 / {2}）
 * ④Φ 作用域隔离：外层 Φ 不泄漏到无关分支
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  withExecPhi,
  abs,
  num,
  litValue,
} from "@nudojs/core";
import { v, lit } from "../term.ts";
import { gt } from "../pred.ts";
import { formatAbs } from "../format.ts";

function call(src: string, fn: string, args: unknown[]) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fn, args as never[]).result;
}

const xa = abs(num().shape, v("x"), undefined, "path");
const ya = abs(num().shape, v("y"), undefined, "path");
const xgt0 = abs(num().shape, v("x"), gt(v("x"), lit(0)), "path");

describe("Φ-native B: branch narrowing", () => {
  it("nested identical non-literal test is proven by Φ (1|3, not 1|2|3)", () => {
    const src = `export function g(x, y) {
  if (x > y) {
    if (x > y) return 1;
    return 2;
  }
  return 3;
}`;
    expect(formatAbs(call(src, "g", [xa, ya]))).toBe("1 | 3  #exact");
  });

  it("refine-contract Φ prunes and keeps term/pred", () => {
    const src = `export function f(x){ if (x>0) return x; return 0; }`;
    const r = withExecPhi(gt(v("x"), lit(0)), () => call(src, "f", [xgt0]));
    const s = formatAbs(r);
    expect(s).toContain("= x");
    expect(s).toContain("> 0");
  });

  it("reassigned subject invalidates the stale Φ fact (soundness)", () => {
    const src = `export function g(x, y) {
  if (x > y) { y = x + 1; if (x > y) return 1; return 2; }
  return 3;
}`;
    // y 重赋值后 term 变化 → 旧事实 gt(x, y-old) 不匹配 → 保守双臂（sound）
    const s = formatAbs(call(src, "g", [xa, ya]));
    expect(s).toContain("2");
    expect(s).toContain("3");
  });
});

describe("Φ-native B: mutation soundness regression (调用变更字段)", () => {
  it("plain object field mutated by callee is re-read correctly", () => {
    const src = `function change(o) { o.n = -1; }
export function g(y) { const o = { n: y }; if (o.n > 0) { change(o); if (o.n > 0) return 1; return 2; } return 3; }`;
    expect(formatAbs(call(src, "g", [ya]))).toBe("2 | 3  #exact");
  });

  it("array length cleared by callee is re-read correctly", () => {
    const src = `function clear(a) { a.length = 0; }
export function g(y) { const a = [y]; if (a.length > 0) { clear(a); if (a.length > 0) return 1; return 2; } return 3; }`;
    expect(formatAbs(call(src, "g", [ya]))).toBe("2  #exact");
  });

  it("class instance field reset by method is re-read correctly", () => {
    const src = `class C { constructor(n) { this.n = n; } reset() { this.n = -1; } }
export function g(y) { const c = new C(y); if (c.n > 0) { c.reset(); if (c.n > 0) return 1; return 2; } return 3; }`;
    expect(formatAbs(call(src, "g", [ya]))).toBe("2 | 3  #exact");
  });
});

describe("Φ-native B: scope isolation", () => {
  it("Φ does not leak across sibling branches", () => {
    // 外层假臂（Φ'=¬(x>y)）内测试 x>y → Φ 蕴含否定 → 剪枝到 alt
    const src = `export function g(x, y) {
  if (x > y) { return 1; } else { if (x > y) return 2; return 4; }
}`;
    const s = formatAbs(call(src, "g", [xa, ya]));
    expect(s).toBe("1 | 4  #exact");
  });

  it("literal test still folds without Φ", () => {
    const src = `export function g() { if (1 > 2) return 1; return 2; }`;
    expect(litValue(call(src, "g", []))).toBe(2);
  });
});
