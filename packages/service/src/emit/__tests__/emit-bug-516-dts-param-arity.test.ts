/**
 * Bug 516 —— dts 参数表按 **case 实参个数**截断 → **契约声明的形参被静默
 * 丢弃**；同一次导出里 check / zod / standard 三面都保留 → **四方交叉矛盾**。
 *
 * 症状（旧口径）：契约声明 2 个形参、只有 1 个 case 实参 ⇒
 *   `export declare function addAll(a: number): number;`（`b` 被吞）
 * 而 check 签名面是 `addAll(a: number, b: number) => number`。
 *
 * 根因：dts 参数表的**长度**取自观测到的 case 实参个数（证据驱动），
 * 而不是契约/声明的形参表（义务驱动）⇒ 观测面污染了契约面。
 *
 * 修法：参数表长度取**声明形参表**（case 只贡献类型证据，不得裁剪契约
 * 义务）。
 */
import { describe, it, expect } from "vitest";
import { num, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts } from "../dts-generator.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";

const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;

/** 最小 fn 骨架：单条 case（argAbs 全 any、结果 any） */
function fnOf(
  name: string,
  paramNames: string[],
  cases: FunctionAnalysis["cases"],
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames,
    cases,
  } as FunctionAnalysis;
}

describe("Bug 516 —— dts 参数表来自声明形参表", () => {
  it("契约声明 2 个形参、只有 1 个 case 实参 ⇒ 形参不被丢弃", () => {
    const fn = fnOf("addAll", ["a", "b"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function addAll(a: number, b: number)",
    );
    expect(p.params.map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("声明形参比观测元数多 ⇒ 尾部形参保留（无契约时落观测 widen）", () => {
    const fn = fnOf("addAll", ["a", "b"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn);
    // 类型词（number / any / unknown）随类型渲染面口径变化（无断言 case 指令
    // 只是见证、不是域声明 ⇒ 产物面取推断域，Bug 511）——本钉只关心**两个形参
    // 都在产物里**（声明形参表的长度）。
    expect(p.lines.join("\n")).toMatch(
      /export declare function addAll\(a: \w+( \| \w+)?, b\?: (unknown|any)\)/,
    );
  });

  it("真分析面：声明 2 参 + 1 参 case ⇒ 两个形参都在产物里", () => {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function addAll(a, b) { return a + b; }
`;
    const result = analyzeFile("/test/s2-arity.js", source);
    const fn = result.functions.find((f) => f.name === "addAll")!;
    expect(fn).toBeTruthy();
    const p = projectFunctionDts(fn);
    // 类型词（number / any / unknown）随类型渲染面口径变化（无断言 case 指令
    // 只是见证、不是域声明 ⇒ 产物面取推断域，Bug 511）——本钉只关心**两个形参
    // 都在产物里**（声明形参表的长度）。
    expect(p.lines.join("\n")).toMatch(
      /export declare function addAll\(a: \w+( \| \w+)?, b\?: (unknown|any)\)/,
    );
  });

  it("负控制：契约里多出、形参表对不上的参数名仍不投影（不撒 arity 谎言）", () => {
    const fn = fnOf("one", ["a"], [
      { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
    ]);
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "ghost", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain("one(a: number)");
    expect(p.lines.join("\n")).not.toContain("ghost");
  });
});
