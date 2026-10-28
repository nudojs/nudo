/**
 * BUG-107 —— 「解构 + 默认值」的形参被**必填化** ⇒ 产出的 `.d.ts` 让 TS 报
 * **TS2554**（合法调用 `f()` 被拒）。
 *
 * 根因：`declaredParams` 的 `case "pattern"` 硬编码 `hasDefault: false`，
 * 而解析器已经如实给出 `FormalParam.optional`（`{ a } = {}` ⇒ true）。
 * 修法：读该标记；解构位**未绑定展开**（渲染名是求值占位 `_p0`）时可省性
 * 可以表达 ⇒ `f(_p0?: any)`。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../emit/dts-generator.ts";

describe("BUG-107 —— 解构形参的默认值 ⇒ 可省", () => {
  it("`{ x = 1, y = x + 1 } = {}` ⇒ 形参可省（不是必填）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug107.js", `export function f({ x = 1, y = x + 1 } = {}) { return y; }\n`),
    );
    expect(dts).toMatch(/export declare function f\(_p0\?: /);
  });

  it("对照组：无默认值的解构形参仍必填", () => {
    const dts = generateDts(
      analyzeFile("/test/bug107b.js", `export function g({ x = 1 } = undefined) { return x; }\n`),
    );
    // `= undefined` 也是默认值形态 ⇒ 可省
    expect(dts).toMatch(/export declare function g\(_p0\?: /);

    const required = generateDts(
      analyzeFile("/test/bug107c.js", `export function r({ x }) { return x; }\n`),
    );
    expect(required).toMatch(/export declare function r\(_p0: /);
  });
});
