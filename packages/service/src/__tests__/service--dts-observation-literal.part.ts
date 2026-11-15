/**
 * BUG-214 —— `export --format dts` 把**一次调用点观测到的字面量**当成函数的
 * TS 声明发布：返回位的**对象槽字面量不拓宽** ⇒ 消费端 `tsc --strict` 对
 * **合法代码**报 TS2367（把 `{ a: number }` 谎报成 `{ a: 1 }`）。
 *
 * 修法：纯 `call@` 观测（没有 `@nudo:case` 断言 / 入口泛化）的返回位，对象槽
 * 里的标量字面量剥到基类型。带断言的 case 与入口泛化维持「嵌套精度保留」。
 */
import { describe, it, expect } from "vitest";
import { generateDts } from "../emit/dts-generator.ts";
import { analyzeFile } from "@nudojs/service";

describe("BUG-214 —— dts 不发布调用点观测的字面量", () => {
  it("纯调用点观测：返回位对象槽字面量 → 基类型", () => {
    const dts = generateDts(
      analyzeFile(
        "/test/bug214.js",
        `export function mk(n) {\n  return { a: n, b: "s" };\n}\n\nmk(1);\n`,
      ),
    );
    // 观测点字面量不得直通进发布的**声明**（Case: 行是 JSDoc 见证，允许保留）
    const decl = dts.split("\n").find((l) => l.includes("export declare function mk")) ?? "";
    expect(decl).toBe("export declare function mk(n: number): { a: number; b: string };");
  });

  it("无调用点的入口泛化仍保留嵌套精度（对照组，Bug 565 口径）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug214b.js", `export function one() {\n  return { a: 1 };\n}\n`),
    );
    expect(dts).toContain("{ a: 1 }");
  });
});
