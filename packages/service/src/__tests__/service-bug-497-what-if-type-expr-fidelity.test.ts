/**
 * Bug 497：what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报
 * 「Bindings applied: <用户原文>」——报告与实际注入不符。
 *
 * 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）：
 * `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` /
 * 裸名字**全是同一个 Abs** `{k:"unknown"}` ⇒ 洗成 `any()` 既不改变推断结果，
 * 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法
 * 连 `nudo:directive-syntax` 都不发）。
 *
 * 修法（service 侧 what-if）：
 * - 认不出的名字（`Date` / `notatype`）与 TS 类型引用（`T.*`）不再洗成 `any()`，
 *   而是按文档契约（agent.md「any other name becomes `unknown`」）落到
 *   `unknown`——`@nudo:as unknown` 是合法载荷。
 * - `applied` 回显如实反映**实际注入**：降级时明说降到了 `unknown`。
 *
 * 负控制：可表达的表达式（原始类型 / 联合 / 构建器 / 结构字面量）行为不变，
 * 回显仍是用户原文（与已发布文档 agent.md 的示例一致）。
 */
import { describe, it, expect } from "vitest";
import { injectBindings, typeExprToDirective } from "../what-if.ts";

const SRC = `const x = 1;\nconst y = x + 1;\n`;

describe("Bug 497 — what-if type expression fidelity", () => {
  it("does not launder an unrecognized name into any()", () => {
    expect(typeExprToDirective("Date")).not.toBe("any()");
    expect(typeExprToDirective("Date")).toBe("unknown");
    expect(typeExprToDirective("notatype")).toBe("unknown");
  });

  it("does not launder a TS type reference (T.*) into any()", () => {
    expect(typeExprToDirective("T.object({ port: T.number })")).not.toBe("any()");
    expect(typeExprToDirective("T.object({ port: T.number })")).toBe("unknown");
  });

  it("echoes the actual injection instead of the user text when degraded", () => {
    const { source, applied, unapplied } = injectBindings(SRC, [
      { name: "x", type: "Date" },
    ]);
    // 注入的是 unknown（不是 any()，也不是用户原文 Date）
    expect(source).toContain("// @nudo:as unknown");
    expect(source).not.toContain("@nudo:as any()");
    // 回显不再声称「按 Date 应用」
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain("unknown");
    expect(applied[0]).toContain("Date");
    expect(applied[0]).toContain("not expressible");
    expect(applied[0]).not.toBe("x: Date");
    expect(unapplied).toEqual([]);
  });

  it("degrades a union with one unrecognized member as a whole", () => {
    const { source, applied } = injectBindings(SRC, [
      { name: "x", type: "number|Date" },
    ]);
    // union(number(), unknown) 不是合法的约束构建器实参 → 整条降级
    expect(source).toContain("// @nudo:as unknown");
    expect(source).not.toContain("union(");
    expect(applied[0]).toContain("not expressible");
  });

  it("negative control: expressible expressions keep their mapping and echo", () => {
    expect(typeExprToDirective("number")).toBe("number()");
    expect(typeExprToDirective("string")).toBe("string()");
    expect(typeExprToDirective("number|string")).toBe("union(number(), string())");
    expect(typeExprToDirective("shape({ port: number() })")).toBe(
      "shape({ port: number() })",
    );
    expect(typeExprToDirective("{ port: number() }")).toBe("{ port: number() }");
    const { source, applied, unapplied } = injectBindings(SRC, [
      { name: "x", type: "number" },
    ]);
    expect(source).toContain("// @nudo:as number()");
    expect(applied).toEqual(["x: number"]);
    expect(unapplied).toEqual([]);
  });

  it("negative control: explicit unknown / any stay expressible (no degradation note)", () => {
    const { source, applied } = injectBindings(SRC, [{ name: "x", type: "unknown" }]);
    expect(source).toContain("// @nudo:as any()");
    expect(applied).toEqual(["x: unknown"]);
    const anyRes = injectBindings(SRC, [{ name: "x", type: "any" }]);
    expect(anyRes.source).toContain("// @nudo:as any()");
    expect(anyRes.applied).toEqual(["x: any"]);
  });

  it("negative control: bindings with no top-level declaration stay unapplied", () => {
    const { applied, unapplied } = injectBindings(`export function f() { return 1; }\n`, [
      { name: "nope", type: "number" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["nope"]);
  });
});
