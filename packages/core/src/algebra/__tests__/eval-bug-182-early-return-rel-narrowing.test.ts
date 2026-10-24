/**
 * Bug 182 回归（core 转译层 + 契约执法面）——**判据已被 Bug 1115 / 1116
 * 修正**：早返回形态的**后续路径**上**不断言否定关系界**。
 *
 * Bug 182 的做法（已撤销）：事实臂以 return/throw 结束 ⇒ else 臂（尾句全终止
 * 时 `completeElseChains` 把它收进合成的 else）即**后续路径** ⇒ 后续路径上
 * 断言**否定关系界**（`x <= 0` 为假 ⇒ `x > 0`）。
 *
 * ⚠ 该做法**不健全**：JS 里 `¬(x <= 0)` 还含 `x` 为 NaN 的情形（NaN 与任何
 * 比较皆假）⇒ 后续路径只能断定 `x > 0 ∨ x is NaN` ⇒ 断言 `x > 0` **排除了
 * NaN** ⇒ 假绿：`if (x < 0) return 0; return x;` + `return nonNeg` 被判「证成」
 * （0 诊断），而原生 x=NaN ⇒ `NaN < 0` 为假 ⇒ `return x` ⇒ 返回 NaN ⇒ 违约。
 *
 * Bug 1115：后续路径**不断言否定界**（事实臂窄化保留——那一侧「测试为真」⇒
 * NaN 不可达）⇒ 与三元写法（`return x < 0 ? 0 : x;`，else 臂本就无否定界
 * 窄化）**同口径**。
 *
 * ⚠ 本文件原先的头注声称 `if (x <= 0) { return 1; } return x;` 与
 * `if (x > 0) { return x; } else { return 1; }`「语义完全等价」——**不成立**：
 * 二者只在 NaN 上分叉（前者对 NaN 返回 NaN，后者返回 1）。
 *
 * Bug 1116：后续路径的返回项是**声明域参数**（值域已知：任意 number）⇒ 契约
 * `positive` 不蕴含 ⇒ 契约不成立（存在违约输入：x=0 / x=NaN）⇒ 判
 * `nudo:constraint-violated`（error）。
 *
 * 负控制钉住：事实臂**不**终止的普通 if/else 同样不断言否定界；返回字面量的
 * 早退形态仍判违约；四种关系算子的后续路径**同口径**（都判违约——四种形态在
 * NaN 上都违约）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

/** 带 return 契约的 check（契约来自标准约束库：positive = number().gt(0)） */
function check(body: string) {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
${body}`);
  return checkSource("/t/bug182.js", src, pTrue, stdOpts);
}

/** 契约违例（error 级）条数 */
function violations(r: { issues: { code: string; severity: string }[] }): number {
  return r.issues.filter((i) => i.severity === "error" && i.code === "nudo:constraint-violated").length;
}

describe("Bug 182/1115/1116: 早返回形态的后续路径不断言否定界（与三元写法同口径）", () => {
  it("早返回形态：后续路径不排除 NaN ⇒ return number().gt(0) 不成立（error）", () => {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  return x;
}`);
    // 原生：x=NaN ⇒ `NaN <= 0` 为假 ⇒ `return x` ⇒ 返回 NaN ⇒ 违反 positive
    // ⇒ 真违规 ⇒ error。修前（否定界窄化）判 0 error = **假绿**。
    expect(violations(r)).toBe(1);
  });

  it("语义等价的事实臂写法仍证得（结论一致）", () => {
    const r = check(`export function f(x) {
  if (x > 0) { return x; } else { return 1; }
}`);
    expect(violations(r)).toBe(0);
  });

  it("尾句非全终止的早退形态（早退提升路径）同口径（error）", () => {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  console.log(x);
  return x;
}`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：返回字面量的早退形态仍判违约（0 不满足 positive）", () => {
    const r = check(`export function f(x) {
  if (x > 0) { return x; }
  return 0;
}`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：事实臂不终止的普通 if/else 同样不断言否定界（判违约的依据不是否定界）", () => {
    // 事实臂不终止 ⇒ else 臂**不**建立否定界（x ≤ 0 / NaN）⇒ 该臂的返回项
    // 值域 = 任意 number（**不是**「x ≤ 0」）⇒ Bug 1116：声明域参数的值域
    // 已知 ⇒ `positive` 不蕴含 ⇒ 契约不成立（x=0 即违约）⇒ error。
    // 判违约的**依据**是「值域 ⊄ 契约域」，不是「断言了否定界」⇒ 非假红。
    const r = check(`export function f(x) {
  if (x > 0) { console.log("pos"); } else { return x; }
  return 1;
}`);
    expect(violations(r)).toBe(1);
    expect(
      r.issues.filter((i) => i.code === "nudo:unproven-return").length,
    ).toBe(0);
  });

  it("负控制：四种关系算子的后续路径**同口径**（四种形态都在 NaN 上违约）", () => {
    // Bug 1115 之后：后续路径**不再**断言否定界 ⇒ 四种形态同口径。
    // 四者都在 NaN 上违约（`NaN` 与任何比较皆假 ⇒ 走 `return x` ⇒ 返回 NaN
    // ⇒ 违反 positive）⇒ 四个都是 error。
    for (const op of [">=", ">", "<", "<="]) {
      expect(
        violations(
          check(`export function f(x) {
  if (x ${op} 0) { return 1; }
  return x;
}`),
        ),
      ).toBe(1);
    }
  });
});
