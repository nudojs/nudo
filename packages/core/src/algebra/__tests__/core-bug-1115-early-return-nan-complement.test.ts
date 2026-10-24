/**
 * Bug 1115 —— 早返回形态的**关系补集**窄化默认「x 不是 NaN」⇒ 门禁**假绿**。
 *
 * 根因（core/algebra/exec/transpile/stmt/fn-body.ts + stmt/statement.ts）：
 * 「事实臂以 return/throw 提前退出 ⇒ else 臂 = **后续路径**（测试为假）」这条
 * 实现路径在后续路径上断言**否定关系界**（Bug 182 的
 * `narrowRelComplementArmThunk` / `REL_COMPLEMENT_OP`：`x <= k` 为假 ⇒ `x > k`）。
 * 但 JS 里 `¬(x <= k)` 还含 `x` 为 **NaN** 的情形（NaN 与任何比较皆假）⇒
 * 后续路径只能断定 `x > k ∨ x is NaN` ⇒ 断言 `x > k` **排除了 NaN**（不健全）。
 *
 * 后果（假绿）：
 *   `if (x < 0) return 0; return x;` + `@nudo:contract return nonNeg`
 *   ⇒ 后续路径断言 `x >= 0` ⇒ 契约被「证成」⇒ **0 诊断**（CI 绿灯）。
 *   而原生 x=NaN 时：`NaN < 0` 为**假** ⇒ 走到 `return x` ⇒ 返回 NaN ⇒
 *   违反 `nonNeg`（NaN 不满足 `>= 0`）⇒ **真违规**被放过。
 *
 * 同族形态（报告点名）：`if (x <= 0) return 1; return x;` + `positive`；
 * `if (x > 100) return 100; return x;` + `max100`；if/else 写法同理。
 *
 * 修法：后续路径**不断言否定界**（事实臂 `narrowRelArmThunk` 保留——那一侧
 * 「测试为真」⇒ NaN 不可达，断言健全）⇒ 后续路径与**三元写法**
 * （`return x < 0 ? 0 : x;`，else 臂本就无否定界窄化）**同口径**。
 *
 * 严重级由「返回义务」通道决定（Bug 1116：声明域参数的值域已知 ⇒ 不蕴含
 * 契约 = 契约不成立 ⇒ error）；本文件只钉「**不得静默**」与「两种等价写法
 * 结论一致」两条不变式。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

/** 返回义务诊断（违约 error + 证不出 warning）的 "severity:code" 列表 */
function retDiags(body: string, cname: string, file = "/t/bug1115.js"): string[] {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return ${cname}
 */
export function f(x) {${body}}
`);
  const r = checkSource(file, src, pTrue, stdOpts);
  return r.issues
    .filter(
      (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

/** 原生 oracle：跑真 JS，回报返回值（NaN 用 "NaN" 标记） */
function native(body: string, arg: unknown): string {
  const fn = new Function("x", body) as (x: unknown) => unknown;
  const v = fn(arg);
  return typeof v === "number" && Number.isNaN(v) ? "NaN" : String(v);
}

describe("Bug 1115：早返回的关系补集不再默认「x 不是 NaN」（不得假绿）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("原生 oracle：早返回形态在 x=NaN 时返回 NaN（违反 nonNeg）", () => {
    // 原生：`NaN < 0` 为假 ⇒ 走到 `return x` ⇒ 返回 NaN。
    expect(native("if (x < 0) return 0; return x;", Number.NaN)).toBe("NaN");
    // 对照：x=5 ⇒ 返回 5（满足 nonNeg）⇒ 该函数不是「恒违约」，而是
    // 「存在违约输入」⇒ 契约未被证明 ⇒ 必须被报告。
    expect(native("if (x < 0) return 0; return x;", 5)).toBe("5");
  });

  it("早返回形态不得静默（0 诊断 = 假绿）", () => {
    // 修前：后续路径断言 `x >= 0` ⇒ 契约被证成 ⇒ 0 诊断。
    expect(retDiags("  if (x < 0) return 0;\n  return x;", "nonNeg")).not.toHaveLength(0);
  });

  it("早返回形态与三元写法结论一致（同一契约 ⇒ 同一诊断）", () => {
    const early = retDiags("  if (x < 0) return 0;\n  return x;", "nonNeg");
    const ternary = retDiags("  return x < 0 ? 0 : x;", "nonNeg");
    expect(early).toEqual(ternary);
    expect(early).not.toHaveLength(0);
  });

  it("同族形态：`positive` 家族（x <= 0 ⇒ 返回 1）不得静默", () => {
    // 原生：x=NaN ⇒ `NaN <= 0` 为假 ⇒ 返回 NaN ⇒ 违反 positive。
    expect(native("if (x <= 0) return 1; return x;", Number.NaN)).toBe("NaN");
    expect(retDiags("  if (x <= 0) return 1;\n  return x;", "positive")).not.toHaveLength(0);
  });

  it("同族形态：`max100` 家族（x > 100 ⇒ 返回 100）不得静默", () => {
    expect(native("if (x > 100) return 100; return x;", Number.NaN)).toBe("NaN");
    expect(retDiags("  if (x > 100) return 100;\n  return x;", "max100")).not.toHaveLength(0);
  });

  it("同族形态：if/else 写法（else 臂 = 后续路径）不得静默", () => {
    expect(
      retDiags("  if (x < 0) { return 0; } else { return x; }", "nonNeg"),
    ).not.toHaveLength(0);
  });

  it("负控制：事实臂的关系窄化**保留**（x >= 0 ⇒ return x 满足 nonNeg ⇒ 0 诊断）", () => {
    // 事实臂（测试为真 ⇒ NaN 不可达）⇒ 断言 `x >= 0` 健全 ⇒ 契约可证。
    expect(retDiags("  if (x >= 0) return x;\n  return 0;", "nonNeg")).toHaveLength(0);
  });

  it("负控制：三元写法的结论不变（既有的 unproven-return / 违约面不得被削弱）", () => {
    expect(retDiags("  return x < 0 ? 0 : x;", "nonNeg")).not.toHaveLength(0);
  });
});
