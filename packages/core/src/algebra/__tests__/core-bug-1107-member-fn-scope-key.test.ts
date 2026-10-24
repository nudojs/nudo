/**
 * Bug 1107 —— `memberToFn`（成员调用绑定）按**变量名**做键 ⇒ 同名局部 / 参数
 * 互相串味 ⇒ 假红（P1）。
 *
 * 复现（ambient 侧车 `A_m=fn({x:number().gt(0)})` / `B_m=fn({x:string()})`）：
 * - `useA(){const c=new A(); return c.m(1)}` +
 *   `useB(){const c=new B(); return c.m("s")}` ⇒ 误报
 *   `B.m[x]: 1 !<= typeof x="string"`（`c.m` 的键被**后写覆盖**）；
 * - `const c=new A(); export function other(c){return c.m(-1)}` ⇒ 在**无关参数**
 *   上套用了 `A.m` 的契约（形参 `c` 遮蔽了顶层 `c`）；
 * - `let c=new C(); c={m:x=>x}; c.m(-1)` ⇒ 重新赋值后别名仍有效。
 *
 * 根因（`scan-call-graph.ts` 的 `memberToFn`，Bug 441 引入）：键只有
 * `变量名.属性名` ⇒ 与作用域无关；`walkStatements` 还会下探函数体 ⇒ 后写覆盖
 * 先写；别名也不会在重新赋值时失效。
 *
 * 修法：
 * - 成员绑定**按作用域分桶**（作用域帧）⇒ 同名局部 / 参数不再串味；
 * - 沿作用域链解析 `obj.prop`：本作用域有绑定就用；本作用域**声明**了 `obj`
 *   但没有该成员绑定 ⇒ **遮蔽** ⇒ 不回落外层；
 * - **重新赋值**使别名 / 成员绑定失效。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

const SIDECAR = `import { fn, number, string } from "@nudojs/core";
export const A_m = fn({ x: number().gt(0) });
export const B_m = fn({ x: string() });
export const C_m = fn({ x: number().gt(0) });
`;

/** ambient 侧车（同名 .nudo.js 文件）——类方法契约绑 `A_m` ↔ `A.m` */
function check(src: string, file = "/t/member-scope.js") {
  const { loadModule } = makeFiles({ "/t/member-scope.nudo.js": SIDECAR });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

/** 调用点前置条件违例 */
function violated(r: { issues: { code: string; fn?: string }[] }): unknown[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 1107 —— 成员调用绑定按作用域分桶", () => {
  it("两个函数里的同名局部（new A / new B）不再串味 ⇒ 零违例", () => {
    const r = check(`export class A { m(x) { return x; } }
export class B { m(x) { return x; } }
export function useA() { const c = new A(); return c.m(1); }
export function useB() { const c = new B(); return c.m("s"); }
`);
    expect(violated(r)).toEqual([]);
  });

  it("负控制：A.m 的契约仍执法（c.m(-1) 报违例）", () => {
    const r = check(`export class A { m(x) { return x; } }
export function useA() { const c = new A(); return c.m(-1); }
`);
    expect(violated(r).length).toBe(1);
  });

  it("负控制：B.m 的契约仍执法（c.m(1) 报违例）", () => {
    const r = check(`export class B { m(x) { return x; } }
export function useB() { const c = new B(); return c.m(1); }
`);
    expect(violated(r).length).toBe(1);
  });

  it("形参遮蔽顶层实例 ⇒ 不套用顶层实例的成员契约", () => {
    const r = check(`export class A { m(x) { return x; } }
const c = new A();
export function other(c) { return c.m(-1); }
`);
    expect(violated(r)).toEqual([]);
  });

  it("重新赋值使成员别名失效（c = {m:x=>x} 之后不再套 C.m 的契约）", () => {
    const r = check(`export class C { m(x) { return x; } }
export function use() { let c = new C(); c = { m: (x) => x }; return c.m(-1); }
`);
    expect(violated(r)).toEqual([]);
  });

  it("负控制：顶层实例的成员契约仍执法（未被遮蔽 / 未重新赋值）", () => {
    const r = check(`export class C { m(x) { return x; } }
const c = new C();
c.m(-1);
`);
    expect(violated(r).length).toBe(1);
  });
});
