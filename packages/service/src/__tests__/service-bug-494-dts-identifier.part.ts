/**
 * Bug 494：dts 投影不得产出非法 TS 标识符。
 *
 * 带 @nudo: 指令的类方法此前走**指令路径**，丢掉了顶层函数普查的
 * noDeclaration 分类 ⇒ dts 投影把作用域名 "C.m" 直接当函数名，产出
 * `export declare function C.m(x: number): unknown;`——tsc 报 TS1005 语法错，
 * 生成的 .d.ts 不可用（zod / standard / guard 三个面都清洗成 C_m*）。
 *
 * 本测试锁住：
 *   ① 指令路径继承 noDeclaration 分类（与非指令路径同口径）
 *   ② dts 投影出的函数名恒为合法 TS 标识符（双保险：非法名一律清洗）
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { projectFunctionDts } from "../emit/dts-generator.ts";
import type { FunctionAnalysis } from "../analyzer-types.ts";

const CLASS_METHOD_WITH_DIRECTIVE = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(x) { return x + 1; }
}
`;

describe("Bug 494 — dts identifier is always a legal TS identifier", () => {
  it("directive path inherits the noDeclaration classification", () => {
    const r = analyzeFile("/t/b494/class-method.js", CLASS_METHOD_WITH_DIRECTIVE);
    const fn = r.functions.find((f) => f.name === "C.m");
    expect(fn).toBeDefined();
    expect(fn!.noDeclaration).toBe(true);
  });

  it("dts projection never emits a dotted function name", () => {
    const r = analyzeFile("/t/b494/class-method-dts.js", CLASS_METHOD_WITH_DIRECTIVE);
    const fn = r.functions.find((f) => f.name === "C.m")!;
    const proj = projectFunctionDts(fn);
    expect(proj.lines.length).toBeGreaterThan(0);
    const decl = proj.lines.find((l) => l.includes("export declare function"));
    expect(decl).toBeDefined();
    expect(decl).toMatch(/export declare function C_m\b/);
    expect(proj.lines.join("\n")).not.toMatch(/C\.m/);
  });

  it("defensive gate: an illegal name is cleaned even without the noDeclaration flag", () => {
    const fn: FunctionAnalysis = {
      name: "C.m",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["x"],
      cases: [
        {
          name: "entry@L2",
          argAbs: [],
          abs: { shape: { k: "prim", type: "number" } } as never,
          throwsAbs: { shape: { k: "never" } } as never,
        },
      ],
    };
    const proj = projectFunctionDts(fn);
    expect(proj.lines.length).toBeGreaterThan(0);
    const decl = proj.lines.find((l) => l.includes("export declare function"));
    expect(decl).toBeDefined();
    expect(decl).toMatch(/export declare function C_m\b/);
  });
});
