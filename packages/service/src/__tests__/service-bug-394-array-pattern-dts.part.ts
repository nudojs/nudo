/**
 * Bug 394（**service 侧**，dts 产物面）：**数组解构**形参的字段级侧车契约
 * 被聚合成**对象形状** ⇒ 产物的输入面与真实形参形态**完全颠倒**。
 *
 * 症状（改前）：`export function f7([a, b])` + 侧车契约 `fn({ a: number() })`
 * ⇒ dts 给出 `export declare function f7(_p0: { a: number }): number;`
 * —— 声明面说「参数是个**对象** `{ a }`」，而真实形参是个**数组**
 * ⇒ 消费方按 `{ a: number }` 写调用 ⇒ 与真实调用对不上。
 *
 * 根因：`packages/service/src/emit/dts-generator.ts` 的 `lookupContractSlot`
 * 把解构位的字段级契约条目一律聚合成 `{ k: "obj", slots }` ⇒ 数组解构
 * （契约按**元素下标**寻址）也被摊成对象。
 *
 * 修法：`DeclaredParam` 带上**模式种类**与**绑定名 → 下标**表；数组解构的
 * 字段级契约聚合成**元组**（元素位按下标寻址，未契约的位置留 `any`——
 * 无约束，不是 unknown），声明名渲染成**数组形态** `[ a, b ]`。
 *
 * 钉：
 * - 部分覆盖（契约只写 `a`）⇒ 形参类型是**元组**（不是对象）；
 * - 全覆盖（契约写 `a` 与 `b`）⇒ 形参类型是元组 + 声明名是 `[ a, b ]`；
 * - 负控制：**对象解构**的字段级契约仍聚合成**对象**（既有口径不变）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { abs } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { projectFunctionDts } from "../emit/dts-generator.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

const num = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
const str = abs({ k: "prim", type: "string" }, undefined, undefined, "exact");

/** dts 声明行（形参类型）。 */
function declOf(source: string, contractParams?: { name: string; abs: unknown }[]): string {
  const result = analyzeFile("/test/bug394.ts", source);
  const fn = result.functions.find((f) => f.name === "f7")!;
  const proj = projectFunctionDts(
    fn,
    contractParams ? { params: contractParams as never } : undefined,
  );
  return proj.lines.find((l) => l.startsWith("export declare function")) ?? "";
}

const ARRAY_PATTERN = `export function f7([a, b]) { return a; }
f7([1, 2]);
`;

const OBJECT_PATTERN = `export function f7({ a, b }) { return a; }
f7({ a: 1, b: 2 });
`;

describe("Bug 394（service 侧）— dts 面：数组解构的输入面是元组，不是对象", () => {
  it("部分覆盖（契约只写 a）⇒ 形参类型是元组（改前是 { a: number }）", () => {
    const decl = declOf(ARRAY_PATTERN, [{ name: "a", abs: num }]);
    expect(decl).toContain("[number, any]");
    expect(decl).not.toContain("{ a: number }");
  });

  it("全覆盖（契约写 a 与 b）⇒ 形参类型是元组、声明名是数组形态", () => {
    const decl = declOf(ARRAY_PATTERN, [
      { name: "a", abs: num },
      { name: "b", abs: str },
    ]);
    expect(decl).toContain("[number, string]");
    expect(decl).toContain("[ a, b ]");
    expect(decl).not.toContain("{ a: number }");
  });

  it("负控制：对象解构的字段级契约仍聚合成对象（既有口径不变）", () => {
    const decl = declOf(OBJECT_PATTERN, [{ name: "a", abs: num }]);
    expect(decl).toContain("{ a: number }");
  });

  it("负控制：无契约时仍是观测面（number[]），不被本次改动波及", () => {
    const decl = declOf(ARRAY_PATTERN);
    expect(decl).toContain("number[]");
  });
});
