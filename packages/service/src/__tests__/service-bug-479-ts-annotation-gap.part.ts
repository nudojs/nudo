/**
 * Bug 479 —— `.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。
 *
 * 报告定位（`tmp/bugs/14-service-eval.md` Bug 479）：「`analyzer-ast.ts:45-64`
 * 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。
 *
 * ── 根因更正（本轮实测，报告的文件定位有误）────────────────────────────
 * **不是** service 侧「只取名字」，而是**解析层就把注解删掉了**：
 *   - Babel（`@babel/parser` + TypeScript 插件）**确实**解析出注解——
 *     `parseSource(src, { keepTs: true })` 的 AST 上有
 *     `param.typeAnnotation` / `fn.returnType`（探针：
 *     `tmp/probe/fix-r24-e/b479-parse.ts`）；
 *   - 但**分析面走的默认路径会剥除**：`packages/core/src/algebra/parse-source.ts:42`
 *     → `stripTypes(ast)` → `packages/core/src/strip-types.ts:173,175`
 *     **delete 掉 `typeAnnotation` / `returnType`**。
 *   ⇒ service（`packages/service/src/analyzer-orchestrate-uncached.ts:132`
 *     `parse(source)`）与 core check 面拿到的 AST **本来就没有注解**——
 *     `extractParamNames` 即便想读也读不到。
 *
 * ── 修法边界（**已闭合**，2026-10-21 接线片）──────────────────────────────
 * 注解要进推断，至少要动四处：
 *   1. `packages/core/src/algebra/parse-source.ts` / `strip-types.ts`
 *      —— 分析面保留**类型注解文本**（旁路 `nudoTypeText` / `nudoReturnTypeText`）
 *      ✅ 已由 core 侧完成；
 *   2. `packages/service/src/analyzer-orchestrate-uncached-cases.ts`
 *      —— 入口实参按声明类型构造 Abs ✅ **本接线片完成**
 *      （`tsAnnotationArgAbs(f.tsType)`；不可映射的类型仍回落 any）；
 *   3. `packages/service/src/emit/dts-generator.ts` —— dts 面优先用注解
 *      ✅ **本接线片完成**（声明位优先级：手写契约 > TS 注解 > case 观测值）；
 *   4. `packages/core/src/algebra/generalize.ts`（check 面的入口形参类型）
 *      ✅ 已由 core 侧完成（`absShapeForTsTypeText`）。
 *
 * 本文件的三条 todo 已随缺口闭合转为**实断言**；负控制（`.js` 同形源行为
 * 不变）保留。**更完整的回归钉**（entry@ 实参 / dts 形参 / 契约优先级）见
 * `service-bug-479-ts-annotation-entry-and-dts.test.ts`。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, formatShape, pTrue } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { generateDts } from "../emit/dts-generator.ts";
import { l2Count } from "./check-helpers.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

const TS_SOURCE = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_SOURCE = `export function upper(a) {
  return a.toUpperCase();
}
`;

describe("Bug 479：.ts 形参类型注解进入推断（缺口已闭合）", () => {
  it("原生：upper(a: string) 的 a 按 string 推断（形参注解进入推断）", () => {
    const result = analyzeFile("/test/bug479.ts", TS_SOURCE);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(formatShape(entry!.argAbs[0]!)).toBe("string");
  });

  it("原生：.ts 的合法代码不再触发 nudo:entry-may-throw 假红（a 是 string，toUpperCase 不会抛）", () => {
    const report = checkSource("/test/bug479.ts", TS_SOURCE, pTrue, {});
    expect(l2Count(report, "upper")).toBe(0);
  });

  it("原生：dts 面保留源里的类型注解（export declare function upper(a: string)）", () => {
    const dts = generateDts(analyzeFile("/test/bug479.ts", TS_SOURCE));
    expect(dts).toContain("export declare function upper(a: string)");
  });

  it("负控制：.ts 源仍被正常分析（函数可见、body 仍求值）", () => {
    const result = analyzeFile("/test/bug479.ts", TS_SOURCE);
    expect(result.functions.map((f) => f.name)).toEqual(["upper"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
  });

  it("负控制：同形 .js 源的形参仍是无约束 any（无注解可读，行为不变）", () => {
    const result = analyzeFile("/test/bug479.js", JS_SOURCE);
    const entry = result.functions.find((f) => f.name === "upper")?.cases.find((c) =>
      c.name.startsWith("entry@"),
    );
    expect(entry).toBeDefined();
    expect(formatShape(entry!.argAbs[0]!)).toBe("any");
  });

  it("负控制：.js 源的 any 接收者成员访问仍报 may-throw（假红只对 .ts 成立）", () => {
    const result = analyzeFile("/test/bug479-throws.js", JS_SOURCE);
    const entry = result.functions.find((f) => f.name === "upper")?.cases.find((c) =>
      c.name.startsWith("entry@"),
    );
    expect(entry).toBeDefined();
    expect(formatShape(entry!.throwsAbs)).toContain("TypeError");
  });
});
