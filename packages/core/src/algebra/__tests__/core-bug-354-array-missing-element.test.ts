/**
 * Bug 354 — `array()` **少传元素约束**：`asNestedConstraint(undefined, …)`
 * 静默变成 `lit(undefined)` ⇒ 契约变成「元素必须是 undefined」⇒ 任何
 * **合法**数组实参都被判违反（假红：`a[0] ∈ lit(undefined)`），且零诊断
 * 说明缺参。
 *
 * 修法：`array` 入口拒绝缺省元素 ⇒ Nudo 原生诊断；
 * 「元素可为 undefined」有显式写法：`array(lit(undefined))`。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { array, litC, number, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 354 · array 缺元素约束守卫", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("array() 抛 Nudo 原生诊断（点名构造器 + 给出写法）", () => {
    expect(() => array()).toThrow(/nudo array\(\)/);
    expect(() => array()).toThrow(/element constraint is required/);
  });

  it("array(undefined) 与 array() 同口径（不得静默变 lit(undefined)）", () => {
    expect(() => array(undefined)).toThrow(/element constraint is required/);
  });

  it("显式写法 array(lit(undefined)) 仍然合法（元素可为 undefined）", () => {
    expect(() => array(litC(undefined))).not.toThrow();
  });

  it("正常元素约束不受影响", () => {
    expect(() => array(number())).not.toThrow();
  });

  it("产品面：合法数组实参不再被判违反（改前 3 条假红）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, array, any } from "@nudojs/core";
export const f = fn({ a: array() }, any());`,
    });
    const src = `
export function f(a) {
  return a;
}
export function g() {
  return f([1, 2, 3]);
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo array()");
    // 改前：3 条 nudo:constraint-violated（合法实参 [1,2,3] 判违规 = 假红）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });

  it("对照组：显式元素契约仍然执法（array(number()) 抓非数字元素）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, array, number, any } from "@nudojs/core";
export const f = fn({ a: array(number()) }, any());`,
    });
    const src = `
export function f(a) {
  return a;
}
export function g() {
  return f(["x"]);
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  });
});
