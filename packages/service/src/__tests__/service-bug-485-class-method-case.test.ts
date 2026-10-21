/**
 * Bug 485：**类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown`
 * → 任何期望都必假红（顶层函数同款 case 却通过）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当
 * **源码里的被调表达式**传给 `tryEvalCallFull`；类方法的名字是点号形式
 * （`C.m`）⇒ 源里不存在名为 `C.m` 的可调用表达式 ⇒ 求值失败 ⇒ 回落
 * unknown 兜底。
 *
 * 修法：点号名只作展示名；见证调用改走「类 Abs → $new → 原型方法槽
 * $invoke」链（静态方法走类 Abs 的静态槽）。
 *
 * 钉：类方法见证求值出确切值；顶层函数同款 case 口径不变（负控制）；
 * 类方法仍不可判时如实回落 unknown（负控制：方法体依赖未定义全局）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

describe("Bug 485：类方法上的 @nudo:case 见证被求值（不再恒 unknown）", () => {
  it("实例方法：见证求值出确切值 1（改前恒 unknown）", () =>
    withTmpProject("nudo-b485-", (dir) => {
      const src = `export class C {
  /**
   * @nudo:case "k" (1) => 1
   */
  m(x) { return 1; }
}
`;
      const file = writeTmpFile(dir, "d.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "C.m");
      expect(fn).toBeDefined();
      const c = fn!.cases.find((x) => x.name === "k");
      expect(c).toBeDefined();
      expect(c!.abs.term?.op).toBe("lit");
      expect(c!.abs.term?.value).toBe(1);
    }));

  it("实例方法：见证实参参与运算（(1) => 2）", () =>
    withTmpProject("nudo-b485b-", (dir) => {
      const src = `export class C {
  /**
   * @nudo:case "k" (1) => 2
   */
  m(x) { return x + 1; }
}
`;
      const file = writeTmpFile(dir, "d.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "C.m");
      const c = fn!.cases.find((x) => x.name === "k");
      expect(c!.abs.term?.value).toBe(2);
    }));

  it("负控制：顶层函数同款 case 口径不变（结果 1）", () =>
    withTmpProject("nudo-b485c-", (dir) => {
      const src = `/**
 * @nudo:case "k" (1) => 1
 */
export function f(x) { return 1; }
`;
      const file = writeTmpFile(dir, "e.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "f");
      const c = fn!.cases.find((x) => x.name === "k");
      expect(c!.abs.term?.value).toBe(1);
    }));

  it("负控制：判不出来时如实回落 unknown（不编造值）", () =>
    withTmpProject("nudo-b485d-", (dir) => {
      const src = `export class C {
  /**
   * @nudo:case "k" (1) => 1
   */
  m(x) { return globalThis.__nudo_missing__.x; }
}
`;
      const file = writeTmpFile(dir, "d.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "C.m");
      const c = fn!.cases.find((x) => x.name === "k");
      expect(c!.abs.shape.k).toBe("unknown");
    }));
});
