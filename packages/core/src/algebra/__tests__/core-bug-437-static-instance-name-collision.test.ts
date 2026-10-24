/**
 * Bug 437 —— **静态**类方法与**实例**方法**同名**（都叫 `C.m`）→ 静态方法的签名被
 * **报错成实例方法的**（native `"stat"` vs 引擎 `"inst"`）→ **错误类型声明**。
 *
 * 根因：类方法名由 `${cname}.${keyName}` 合成，**不区分 `static` 与实例** ⇒ 同一个
 * 类里 `m`（实例）与 `m`（静态）得到**同一个名字** ⇒ 按名字索引的签名表里两条记录
 * **互相顶替**（形参取自一个、返回值取自另一个 ⇒ 半真半假的签名）。
 *
 * 修法（`scan-top-functions.ts` 的 `collectClassMethods`）：同名时**只登记实例
 * 方法**。⚠ 不能给静态方法另起一个普查名 —— 方法体也按 `Class.method` 这个键
 * 登记（`generalize.ts` 的 `env.fns`），另起名字会查不到方法体 ⇒ 凭空造出 L2 入口
 * may-throw 假红。service 侧 `analyzer-ast.ts` 的 `collectClassMethods` 同口径。
 */
import { describe, it, expect } from "vitest";
import { listTopFunctions } from "../scan.ts";
import { issuesOf } from "./nudo-constraints.ts";

const SAME_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static m(y) {
    return "stat";
  }
}
`;

const DIFF_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static n(x) {
    return "stat";
  }
}
`;

describe("Bug 437 — 静态与实例同名：普查名不得重复", () => {
  it("同名 ⇒ 普查名只出现一次（静态方法不另起名）", () => {
    const names = listTopFunctions(SAME_NAME);
    expect(names).toEqual(["C.m"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("不同名 ⇒ 两个都在（静态方法仍是入口可见的）", () => {
    expect(listTopFunctions(DIFF_NAME)).toEqual(["C.m", "C.n"]);
  });

  it("同名 ⇒ check 签名面只有一条 C.m（不再两条互相顶替）", () => {
    const r = issuesOf(SAME_NAME, "/t/b437/k.js");
    const sigs = r.signatures.filter((s) => s.name === "C.m");
    expect(sigs.length).toBe(1);
  });

  it("同名 ⇒ 实例方法的返回值不被静态方法顶替（native \"inst\"）", () => {
    const r = issuesOf(SAME_NAME, "/t/b437/k.js");
    const sig = r.signatures.find((s) => s.name === "C.m");
    expect(sig?.display).toContain('"inst"');
  });

  it("不同名 ⇒ 两条签名都在（对照）", () => {
    const r = issuesOf(DIFF_NAME, "/t/b437/j.js");
    expect(r.signatures.filter((s) => s.name === "C.m").length).toBe(1);
    expect(r.signatures.filter((s) => s.name === "C.n").length).toBe(1);
  });
});
