/**
 * Bug 1116 —— Bug 370 把**确定违规**降为 warning ⇒ `nudo check` 门禁**假绿**。
 *
 * 根因（core/algebra/postcondition.ts 的 `isBoundedEvidenceMissing`）：
 * Bug 370 把「证据面」的判据从「`ret.pred` 存在」换成「证据面（Φ ∧ ret.pred）
 * 含**界原子**（gt/ge/lt/le）」⇒ `typeof` 级证据（`@nudo:contract x num` 的
 * **声明域参数**）被当成「无证据」⇒ 返回义务降级成 `nudo:unproven-return`
 * （**warning**）。
 *
 * 后果（假绿）：
 *   `if (x === -1 || x === -2) return x; return 1;` + `return positive`
 *   ⇒ 该分支**只会返回 -1 或 -2**（确定违规）⇒ 却只报 1 条 warning、**无
 *   error** ⇒ `nudo check` 的 `ok` 判据是 `errors === 0`
 *   （packages/nudojs/src/commands/check-report.ts:408-412）⇒ **exit 0** ⇒
 *   CI 门禁空转。
 *
 * 修法：判据回到「**值域已知**」——
 * - 返回项是**声明域参数**（term = var）：其值域 = 该绑定的声明域 ⇒ 返回
 *   义务**可判定**：「不蕴含契约」= 「契约不成立」（返回契约是对**所有**输入
 *   成立的后置 ⇒ 值域 ⊄ 契约域 ⇒ 存在违约输入）⇒ 判 `disproved`（**error**）。
 * - `unprovable` 收窄到「**无 term / 派生项**」（`return x + 1` /
 *   `return Math.abs(x)`：值域未被跟踪 ⇒ 证不出也反证不了）。
 *
 * 口径依据：docs/design/cli-semantics.md §5.5 —— 「`any` / unknown（推断
 * 失败）返回对有界契约报 `nudo:unproven-return` warning」⇒ warning 只针对
 * any/unknown；声明域参数**不是** any/unknown ⇒ 不得降级成 warning。
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
function retDiags(body: string, cname: string, file = "/t/bug1116.js"): string[] {
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

describe("Bug 1116：声明域参数 / 字面量分支的返回义务判 error（不得降级成 warning）", () => {
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

  it("字面量分支（eq/or 路径事实把值钉在违规字面量上）⇒ error", () => {
    // 该分支**只会返回 -1 或 -2** ⇒ 对 `positive` 是**确定违规**。
    expect(retDiags("  if (x === -1 || x === -2) return x;\n  return 1;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  });

  it("声明域参数的裸返回（x: num vs positive）⇒ error", () => {
    // `x` 的声明域是 `number()`（含 NaN）⇒ 存在违约输入（x=0）⇒ 契约不成立。
    expect(retDiags("  return x;", "positive")).toEqual(["error:nudo:constraint-violated"]);
  });

  it("补集臂 NaN 面（三元写法，else 臂含 NaN ⊭ nonNeg）⇒ error", () => {
    // `x < 0 ? 0 : x`：x=NaN ⇒ else 臂 ⇒ 返回 NaN ⇒ 违反 nonNeg。
    expect(retDiags("  return x < 0 ? 0 : x;", "nonNeg")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  });

  it("负控制：派生项（值域未被跟踪）⇒ 证不出（warning），不得当违约", () => {
    expect(retDiags("  return x + 1;", "positive")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  });

  it("负控制：无 term 的派生项 ⇒ 证不出（warning）", () => {
    expect(retDiags("  return Math.abs(x);", "positive")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  });

  it("负控制：有界证据（守卫 x >= 0 vs positive）⇒ 仍是 error", () => {
    expect(retDiags("  if (x >= 0) return x;\n  return 1;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  });

  it("负控制：字面量返回按域隶属判违约（0 ⊭ positive）⇒ error", () => {
    expect(retDiags("  if (x > 0) { return x; }\n  return 0;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  });

  it("负控制：可证合规的函数不得被误判（守卫 x >= 0 + nonNeg ⇒ 0 诊断）", () => {
    expect(retDiags("  if (x >= 0) return x;\n  return 0;", "nonNeg")).toHaveLength(0);
  });
});
