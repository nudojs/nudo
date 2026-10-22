/**
 * Bug 441：**类方法**的侧车契约在任何调用点都不执法
 * （`c.m(-1)` 违反 `a > 0` 却零诊断 ⇒ 假绿）——而契约面 / 签名面都声称
 * 它生效（`C.m [handwritten] (a: number().gt(0))`）。
 *
 * 根因：调用图的被调名解析只认**对象字面量**成员（memberToFn 只收
 * `const api = { f }`），不认**本地类实例**（`const c = new C()`）⇒
 * `c.m` 解析不出源码函数名 ⇒ 整条调用被跳过（绑定面认 `C_m` ↔ `C.m`，
 * 执法面不认 ⇒ 两面名字空间不一致）。
 *
 * 钉住：
 * - memberToFn 收下本地类实例的成员（`c.m` ⇒ `C.m`）
 * - 调用点 `c.m(-1)` 报 nudo:constraint-violated
 * - 满足契约的实参（`c.m(1)`）不报（不放宽过头）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { collectCallResolvers } from "../scan-call-graph.ts";
import { listTopFunctions } from "../scan.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SRC = `
export function plain(a) { return a; }
export class C {
  m(a) { return a; }
}
plain(-1);
const c = new C();
c.m(-1);
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const plain = fn({ a: number().gt(0) }, number());
export const C_m = fn({ a: number().gt(0) }, number());
`;

describe("Bug 441 本地类实例的调用点执法", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("memberToFn 收下本地类实例成员（c.m ⇒ C.m）", () => {
    const known = listTopFunctions(SRC);
    expect(known).toContain("C.m");
    const resolve = collectCallResolvers(SRC, known);
    expect(resolve.memberToFn.get("c.m")).toBe("C.m");
  });

  it("c.m(-1) 违反类方法契约 ⇒ nudo:constraint-violated", () => {
    const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
    const r = checkSource("/t/lib.js", SRC, pTrue, { loadModule, fromFile: "/t/lib.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    // plain(-1) 与 c.m(-1) 两条都必须报（此前只有 plain 一条）
    expect(violated.length).toBe(2);
    expect(violated.some((i) => i.fn === "C.m")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("满足契约的实参不报（c.m(1) 放行）", () => {
    const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
    const src = `
export class C {
  m(a) { return a; }
}
const c = new C();
c.m(1);
`;
    const r = checkSource("/t/lib2.js", src, pTrue, { loadModule, fromFile: "/t/lib2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });
});
