/**
 * 族 60 · core 代数层 5 条精度债的钉（片 W10）。
 *
 * 逐条对应（台账原文 → 本钉的落点）：
 * 1. **core `buildArgsFromAssume` 写死 `x > 0`** —— 被假设形参的入口 Abs 谓词
 *    必须是**用户写的界**，不是引擎发明的界（族 08 · Bug 976 已修；本钉**锁**）。
 * 2. **S11-534 core 字面量渲染** —— bigint 字面量必须与 number 字面量
 *    **可分**（`lit(10n)` vs `lit(10)`；族 06 · Bug 361 已修；本钉**锁**）。
 * 3. **S6-1008 观测层根因（core）** —— rest 形参的**元数信息**在 core 层可读
 *    （必选元数 + 变长标记；**本片新修**）。
 * 4. **复合测试不接关系守卫** —— `relGuardOf` 认**复合**（合取）关系式
 *    （**本片新修**；补集方向**不**接 ⇒ 不假绿）。
 * 5. **core 侧 `absShapeForTsTypeText` 未公共化** —— 正解必然新增公共导出 ⇒
 *    触及公共 API 冻结面 ⇒ **本片只报告不擅自新增**；本钉锁住「内部可用 /
 *    公共面缺席」的现状（**负控**）。
 *
 * 负控贯穿：非相关形态**逐字不变**（数字字面量渲染、单关系式守卫、非 rest
 * 形参、公共导出面）。
 */
import { describe, it, expect } from "vitest";
import { buildArgsFromAssume } from "../generalize.ts";
import { gtNum, predToString } from "../pred.ts";
import { v } from "../term.ts";
import { formatConstraint } from "../interface.ts";
import { litC, number as numberC } from "../constraint.ts";
import { formalParamsFromNodes } from "../param-surface.ts";
import { parseSource } from "../parse-source.ts";
import { relGuardOf } from "../exec/transpile/stmt-predicates.ts";
import { absShapeForTsTypeText } from "../ts-type-shape.ts";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

// ---------------------------------------------------------------------------
// 第 1 条：assume 的界落进形参自己的 pred（不是写死的 x > 0）
// ---------------------------------------------------------------------------

const ASSUME_SRC = `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`;

describe("族 60 · 第 1 条：assume 的用户界落进入口 Abs 谓词", () => {
  it("用户声明的界直接落进形参 pred（不是写死的 x > 0）", () => {
    const bounds = new Map([["x", gtNum(v("x"), -5)]]);
    const args = buildArgsFromAssume(ASSUME_SRC, "k", new Set(["x"]), bounds);
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeDefined();
    expect(predToString(args[0]!.pred!)).toBe("x > -5");
    // 负控：写死的 x > 0 不许出现（它比用户界更强 ⇒ 观察面说谎）
    expect(predToString(args[0]!.pred!)).not.toBe("x > 0");
  });

  it("负控：没有声明界 ⇒ 不写界（不替用户发明一个更强的默认界）", () => {
    const args = buildArgsFromAssume(ASSUME_SRC, "k", new Set(["x"]));
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 第 2 条：core 字面量渲染（bigint 与 number 可分）
// ---------------------------------------------------------------------------

describe("族 60 · 第 2 条：core 字面量渲染 bigint 可分", () => {
  it("bigint 字面量渲染成 lit(10n)（与 lit(10) 可分）", () => {
    expect(formatConstraint(litC(10n))).toBe("lit(10n)");
    expect(formatConstraint(litC(10n))).not.toBe(formatConstraint(litC(10)));
  });

  it("负控：数字字面量的渲染逐字不变（lit(10) / lit(-0) / number().gt(10)）", () => {
    expect(formatConstraint(litC(10))).toBe("lit(10)");
    expect(formatConstraint(litC(-0))).toBe("lit(-0)");
    expect(formatConstraint(litC("a"))).toBe('lit("a")');
    expect(formatConstraint(numberC().gt(10))).toBe("number().gt(10)");
  });
});

// ---------------------------------------------------------------------------
// 第 3 条：rest 形参的元数信息在 core 层可读
// ---------------------------------------------------------------------------

describe("族 60 · 第 3 条：rest 形参的元数信息", () => {
  it("rest 形参带 arity：必选元数 + 变长标记", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "Identifier", name: "b" },
      { type: "RestElement", argument: { type: "Identifier", name: "rest" } },
    ] as never);
    const rest = formals[2]!;
    expect(rest.kind).toBe("rest");
    if (rest.kind !== "rest") throw new Error("expected rest formal");
    expect(rest.arity).toEqual({ min: 2, variadic: true });
  });

  it("负控：默认形参不计入必选元数；非 rest 形参没有 arity 字段", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "rest" } },
    ] as never);
    const rest = formals[2]!;
    if (rest.kind !== "rest") throw new Error("expected rest formal");
    // b 有默认值 ⇒ 可省略 ⇒ 不计入必选元数
    expect(rest.arity).toEqual({ min: 1, variadic: true });
    // 非 rest 形参：**逐字不变**（没有 arity 字段）
    expect(formals[0]!).not.toHaveProperty("arity");
    expect(formals[1]!).not.toHaveProperty("arity");
  });
});

// ---------------------------------------------------------------------------
// 第 4 条：复合（合取）关系式接关系守卫
// ---------------------------------------------------------------------------

/** 取表达式 AST（测试用：把表达式包成 const 声明后取 initializer） */
function testNode(expr: string): unknown {
  const file = parseSource(`const _ = ${expr};`);
  const stmt = file.program.body[0] as unknown as {
    declarations?: Array<{ init?: unknown }>;
  };
  return stmt.declarations?.[0]?.init;
}

describe("族 60 · 第 4 条：复合关系式接关系守卫", () => {
  it("relGuardOf 认复合（合取）关系式，并带上其余合取项的界", () => {
    const guard = relGuardOf(testNode("x > 0 && x < 10"));
    expect(guard).toBeDefined();
    expect(guard!.name).toBe("x");
    expect(guard!.op).toBe("gt");
    expect(guard!.k).toBe(0);
    // 复合标记 ⇒ 补集方向必须跳过（消费方按此口径）
    expect(guard!.composite).toBe(true);
    // 其余合取项的界一并带上（事实臂同时持有两个界）
    expect(guard!.extra).toEqual([{ op: "lt", k: 10 }]);
  });

  it("负控：单一关系式的守卫逐字不变（无 composite / extra 标记）", () => {
    expect(relGuardOf(testNode("x > 0"))).toEqual({ name: "x", op: "gt", k: 0 });
    expect(relGuardOf(testNode("0 < x"))).toEqual({ name: "x", op: "gt", k: 0 });
    expect(relGuardOf(testNode("x >= 3"))).toEqual({ name: "x", op: "ge", k: 3 });
  });

  it("负控：析取（||）不接守卫（合取才蕴含；析取单项不被蕴含）", () => {
    expect(relGuardOf(testNode("x > 0 || x < 10"))).toBeUndefined();
  });

  it("端到端：复合关系式的 return 契约证得（改前判「证不出」）", () => {
    const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
export function f(x) {
  if (x > 0 && x < 10) { return x; }
  return 1;
}`);
    const r = checkSource("/t/bug60.js", src, pTrue, stdOpts);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return").length).toBe(0);
  });

  it("负控：补集方向不接（后续路径不断言否定界 ⇒ 不假绿）", () => {
    // `¬(x > 0 && x < 10)` = `x ≤ 0 ∨ x ≥ 10` —— 不是单一关系 ⇒
    // 后续路径上**不得**断言 `x ≤ 0`（否则假绿）。
    const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
export function f(x) {
  if (x > 0 && x < 10) { return 1; }
  return x;
}`);
    const r = checkSource("/t/bug60.js", src, pTrue, stdOpts);
    // 后续路径无界证据 ⇒ 判「证不出」（warning），**不**判「确定违约」（error）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 第 5 条：absShapeForTsTypeText 的公共化现状（只报告，不擅自新增导出）
// ---------------------------------------------------------------------------

describe("族 60 · 第 5 条：absShapeForTsTypeText 仍**未**进公共面（负控）", () => {
  it("core 内部可用（TS 声明类型文本 → Abs 形状）", () => {
    expect(absShapeForTsTypeText("number")).toEqual({ k: "prim", type: "number" });
    expect(absShapeForTsTypeText("string")).toEqual({ k: "prim", type: "string" });
    expect(absShapeForTsTypeText("Array<string>")).toBeUndefined();
  });

  it("负控：公共 API 冻结面零新增（该工具不在公共导出里）", async () => {
    const pub = (await import("@nudojs/core")) as unknown as Record<string, unknown>;
    expect(pub.absShapeForTsTypeText).toBeUndefined();
  });
});
