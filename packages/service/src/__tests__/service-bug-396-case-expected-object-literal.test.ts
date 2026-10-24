/**
 * Bug 396：`@nudo:case` 期望里的**对象槽字面量**永不被执法 ⇒ 假绿。
 *
 * 根因（core `packages/core/src/algebra/leq.ts:223-234`）：`leqAbs` 的
 * 「同 prim 字面量视为可赋」捷径在**对象槽**位上连字面量相等性都不比 ——
 * `shape({ a: lit(2) })` 与实际 `{ a: 1 }` 判「满足」⇒ case 期望恒 `[ok]`、
 * `nudo:case-expected` 零诊断。而同一份契约在手写侧车面走**逐字段约束树**
 * 能抓到 ⇒ 两面自相矛盾。
 *
 * 修法（**消费侧**，core 那一行不许改 —— gold 的 `assign-compatible` /
 * `wider` 依赖该口径）：`caseExpectedSatisfied` 补一道「期望槽里的字面量
 * 按值比较」，**只**作用于期望判定，`leqAbs` 的既有语义一字不动。
 *
 * 钉：
 * - 对象槽字面量不符 ⇒ 报 `nudo:case-expected`（改前恒 0 条）；
 * - 嵌套对象槽字面量不符 ⇒ 同样报（改前恒 0 条）；
 * - 负控制：期望槽是**类型**（`number()`）⇒ 口径不变（不报）；
 * - 负控制：顶层字面量 / 数组元素字面量 ⇒ 口径不变（本来就报）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCaseArgExpr } from "@nudojs/parser";
import { abs, numLit, strLit } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { caseExpectedSatisfied } from "../analyzer-orchestrate-uncached-cases.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

/** 找出 nudo:case-expected 诊断（期望不满足）。 */
function caseExpectedIssues(result: { diagnostics: readonly { code?: string }[] }): number {
  return result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

/** 跑一个 `@nudo:case` 文件，返回 case-expected 诊断条数。 */
function caseExpectedCount(src: string): number {
  return withTmpProject("nudo-b396-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    const result = analyzeFile(file, readFileSync(file, "utf-8"));
    return caseExpectedIssues(result);
  });
}

describe("Bug 396：期望里的对象槽字面量按值执法（不再恒 [ok]）", () => {
  it("对象槽字面量不符（期望 { a: 2 }，实际 { a: 1 }）→ 报 nudo:case-expected", () => {
    const src = `/**
 * @nudo:case "t" ({ a: 1 }) => shape({ a: lit(2) })
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("对象槽字面量类型不同（期望 { a: \"y\" }，实际 { a: \"x\" }）→ 报", () => {
    const src = `/**
 * @nudo:case "t" ({ a: "x" }) => shape({ a: lit("y") })
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("嵌套对象槽字面量不符（期望 { a: { b: 2 } }，实际 { a: { b: 1 } }）→ 报", () => {
    const src = `/**
 * @nudo:case "t" ({ a: { b: 1 } }) => shape({ a: shape({ b: lit(2) }) })
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("负控制：期望槽是**类型**（number()）→ 口径不变（不报）", () => {
    const src = `/**
 * @nudo:case "t" ({ a: 1 }) => shape({ a: number() })
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(0);
  });

  it("负控制：顶层字面量不符（期望 2，实际 1）→ 口径不变（报）", () => {
    const src = `/**
 * @nudo:case "t" (1) => 2
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("负控制：数组元素字面量不符（期望 [\"y\"]，实际 [\"x\"]）→ 口径不变（报）", () => {
    const src = `/**
 * @nudo:case "t" (["x"]) => array(lit("y"))
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });
});

describe("Bug 396：caseExpectedSatisfied 的严格变体（消费侧单测）", () => {
  const objA1 = abs({ k: "obj", slots: { a: { value: numLit(1) } } }, undefined, undefined, "exact");
  const objX = abs({ k: "obj", slots: { a: { value: strLit("x") } } }, undefined, undefined, "exact");
  const nested = abs(
    {
      k: "obj",
      slots: {
        a: {
          value: abs({ k: "obj", slots: { b: { value: numLit(1) } } }, undefined, undefined, "exact"),
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );

  it("对象槽字面量不符 → 不满足", () => {
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: lit(2) })", 0))).toBe(false);
    expect(caseExpectedSatisfied(objX, parseCaseArgExpr("shape({ a: lit('y') })", 0))).toBe(false);
    expect(
      caseExpectedSatisfied(nested, parseCaseArgExpr("shape({ a: shape({ b: lit(2) }) })", 0)),
    ).toBe(false);
  });

  it("对象槽字面量相符 → 满足", () => {
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: lit(1) })", 0))).toBe(true);
  });

  it("负控制：期望槽是类型（number()）→ 满足（口径不变）", () => {
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: number() })", 0))).toBe(true);
  });
});
