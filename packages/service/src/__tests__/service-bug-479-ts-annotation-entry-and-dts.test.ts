/**
 * Bug 479（**service 侧**）回归钉：`.ts` 源的**形参类型注解**必须进
 * 推断面（entry@ 实参）与产物面（dts 形参类型）。
 *
 * 背景（`tmp/bugs/14-service-eval.md` Bug 479）：`.ts` 源里写好的
 * `a: string` 从未进入推断 —— 解析层把注解删了（core 侧已修：注解文本以
 * 旁路 `nudoTypeText` 留在 AST 上，经 `FormalParam.tsType` 带出），但
 * **service 侧还有两处没接线**（本文件钉的就是这两处）：
 *
 * 1. `analyzer-orchestrate-uncached-cases.ts` 的 entry@ 兜底评估：入口实参
 *    写死 `anyAbs` ⇒ `nudo test` 的 entry@ 实参显示 any，且合法 TypeScript
 *    拿到「参数无约束」的假红（`a.toUpperCase()` on any）。
 * 2. `emit/dts-generator.ts` 的声明位：形参类型从 case 观测值取，注解被丢掉
 *    ⇒ `.d.ts` 形参退化成 `unknown`（产物比它所生成的源更弱）。
 *
 * 口径（与既有约定对齐）：
 * - **推断面**：声明类型 → Abs 形状，只映射 JS 一等类型
 *   （string/number/boolean/bigint/symbol）；别名/泛型/对象类型**不映射**
 *   ⇒ 回落 any（不猜）。与 core `ts-type-shape.ts` 同表。
 * - **产物面声明位优先级**：手写契约（sidecar / @nudo:contract）>
 *   TS 声明注解 > case 观测值（既有口径「声明位取侧车契约」不被破坏；
 *   `Case:` 行仍是观测值）。
 * - **无注解 = 无变化**：`.js` 源 / 未标注形参 ⇒ 推断面仍 any、产物面仍走
 *   既有 case-widen。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { formatShape, numLit } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { generateDts, projectFunctionDts } from "../emit/dts-generator.ts";
import type { FunctionAnalysis } from "../analyzer-types.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

/** entry@ 兜底 case（合成路径的函数只有这一个见证） */
function entryCase(fn: FunctionAnalysis) {
  const c = fn.cases.find((x) => x.name.startsWith("entry@"));
  expect(c).toBeDefined();
  return c!;
}

/** dts 声明行 */
function declOf(source: string, file = "/test/bug479-service.ts"): string {
  return (
    generateDts(analyzeFile(file, source))
      .split("\n")
      .find((l) => l.startsWith("export declare function")) ?? ""
  );
}

const TS_UPPER = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_UPPER = `export function upper(a) {
  return a.toUpperCase();
}
`;

describe("Bug 479（service 侧）— 推断面：entry@ 实参按 TS 声明类型", () => {
  it("`.ts` 的 string 形参：entry@ 实参是 string（改前是 any）", () => {
    const result = analyzeFile("/test/bug479-entry.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("string");
  });

  it("`.ts` 的多个形参：各自按声明类型（number / number）", () => {
    const result = analyzeFile(
      "/test/bug479-entry2.ts",
      `export function add(x: number, y: number): number {\n  return x + y;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "add")!;
    expect(entryCase(fn).argAbs.map((a) => formatShape(a))).toEqual(["number", "number"]);
  });

  it("`.ts` 的 boolean 形参：entry@ 实参是 boolean", () => {
    const result = analyzeFile(
      "/test/bug479-entry3.ts",
      `export function flag(b: boolean): boolean {\n  return !b;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "flag")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("boolean");
  });

  it("合法 TypeScript 不再因「参数无约束」在 entry@ 抛 TypeError（改前抛）", () => {
    const result = analyzeFile("/test/bug479-entry4.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).throwsAbs)).toBe("never");
    // 推出来的返回值也跟着收窄（a 是 string ⇒ a.toUpperCase() 是 string）
    expect(formatShape(entryCase(fn).abs)).toBe("string");
  });

  it("不可映射的声明类型（string[]）：实参仍回落 any（不猜）", () => {
    const result = analyzeFile(
      "/test/bug479-entry5.ts",
      `export function len(a: string[]): number {\n  return a.length;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "len")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
  });
});

describe("Bug 479（service 侧）— 产物面：dts 形参保留 TS 注解", () => {
  it("dts 形参保留 string 注解（改前是 unknown）", () => {
    expect(declOf(TS_UPPER)).toContain("export declare function upper(a: string)");
    expect(declOf(TS_UPPER)).not.toContain("a: unknown");
  });

  it("dts 形参保留不可映射的 string[] 注解（产物不得比源更弱）", () => {
    const decl = declOf(
      `export function len(a: string[]): number {\n  return a.length;\n}\n`,
    );
    expect(decl).toContain("export declare function len(a: string[])");
  });

  it("dts 多个形参各自保留注解", () => {
    const decl = declOf(
      `export function add(x: number, y: number): number {\n  return x + y;\n}\n`,
    );
    expect(decl).toContain("export declare function add(x: number, y: number)");
  });

  it("dts rest 形参保留数组注解（...rest: string[]）", () => {
    const decl = declOf(
      `export function sum(...rest: number[]): number {\n  return rest.length;\n}\n`,
    );
    expect(decl).toContain("...rest: number[]");
  });

  it("dts 的 JSDoc @param 与声明位一致（string，不是 unknown）", () => {
    const dts = generateDts(analyzeFile("/test/bug479-jsdoc.ts", TS_UPPER));
    expect(dts).toContain("@param a - string");
    expect(dts).not.toContain("@param a - unknown");
  });
});

describe("Bug 479（service 侧）— 负控制：既有行为不得被波及", () => {
  it("同形 `.js` 源（无注解）：entry@ 实参仍是 any、仍抛 TypeError", () => {
    const result = analyzeFile("/test/bug479-ctrl.js", JS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
    expect(formatShape(entryCase(fn).throwsAbs)).toContain("TypeError");
  });

  it("同形 `.js` 源（无注解）：dts 形参仍是 unknown（既有投影面不变）", () => {
    expect(declOf(JS_UPPER, "/test/bug479-ctrl.js")).toContain(
      "export declare function upper(a: unknown)",
    );
  });

  it("`.ts` 源里未标注的形参：仍是 any（无注解 = 无约束）", () => {
    const result = analyzeFile(
      "/test/bug479-ctrl2.ts",
      `export function plain(a): any {\n  return a;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "plain")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
  });

  it("手写契约仍优先于 TS 注解（既有口径「声明位取侧车契约」）", () => {
    const result = analyzeFile("/test/bug479-contract.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    const proj = projectFunctionDts(fn, { params: [{ name: "a", abs: numLit(1) }] });
    const decl = proj.lines.find((l) => l.startsWith("export declare function"))!;
    expect(decl).toContain("a: number");
    expect(decl).not.toContain("a: string");
  });

  it("无契约时 TS 注解生效（同一函数，去掉契约面后是 string）", () => {
    const result = analyzeFile("/test/bug479-contract2.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    const proj = projectFunctionDts(fn);
    const decl = proj.lines.find((l) => l.startsWith("export declare function"))!;
    expect(decl).toContain("a: string");
  });
});
