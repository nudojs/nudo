/**
 * Bug 182 回归（core 转译层 + 契约执法面）：**早返回形态**的后续路径上
 * 关系事实（补集界）必须建立。
 *
 * 修复前：`if (x <= 0) { return 1; } return x;` 的后续路径上，返回的 `x`
 * 从未被精化 ⇒ `@nudo:contract return number().gt(0)` 判**违约**
 * （L1 门禁假红）——而语义完全等价的 `if (x > 0) { return x; } else { return 1; }`
 * **通过**（同一语义、不同写法结论相反）。
 *
 * 修复后：事实臂以 return/throw 结束 ⇒ 该臂是**早退** ⇒ else 臂（尾句全
 * 终止时 `completeElseChains` 把它收进合成的 else）即**后续路径** ⇒ 后续
 * 路径上断言**否定关系界**（`x <= 0` 为假 ⇒ `x > 0`）。
 *
 * NaN 口径：JS 里 `¬(x <= 0)` 还含 `x` 为 NaN 的情形（NaN 与任何比较皆假）；
 * 严格说后续路径只能断定 `x > 0 ∨ x is NaN`。这里取**否定界**形态，NaN 的
 * 排除交给**契约谓词层**（`number().gt(0)` 本身排除 NaN）——否则「无法排除
 * NaN」会被误当成「不满足契约」。
 *
 * 负控制钉住：事实臂**不**终止的普通 if/else 不断言否定界；返回字面量的
 * 早退形态仍判违约；四种关系算子的补集方向各不相同。
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

describe("Bug 182: 早返回形态的后续路径建立补集关系事实", () => {
  it("早返回形态：后续路径的 x > 0 ⇒ return number().gt(0) 证得", () => {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  return x;
}`);
    // 修复前：1 error（return value ⊭ @nudo:contract return positive）
    expect(violations(r)).toBe(0);
  });

  it("语义等价的事实臂写法仍证得（结论一致）", () => {
    const r = check(`export function f(x) {
  if (x > 0) { return x; } else { return 1; }
}`);
    expect(violations(r)).toBe(0);
  });

  it("尾句非全终止的早退形态（早退提升路径）同样证得", () => {
    const r = check(`export function f(x) {
  if (x <= 0) { return 1; }
  console.log(x);
  return x;
}`);
    expect(violations(r)).toBe(0);
  });

  it("负控制：返回字面量的早退形态仍判违约（0 不满足 positive）", () => {
    const r = check(`export function f(x) {
  if (x > 0) { return x; }
  return 0;
}`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：事实臂不终止的普通 if/else 不断言否定界", () => {
    // 事实臂不终止 ⇒ else 臂**不**建立否定界（x ≤ 0 / NaN）⇒ 该臂的返回
    // 只有 typeof 级证据 ⇒ 无界证据下**不得**判「确定违约」（error，假红）。
    // Bug 370：判「证不出」（nudo:unproven-return，warning）——义务仍被报告，
    // 但不再冒充「确定违约」；若引擎真的断言了否定界，这里会回到 error。
    const r = check(`export function f(x) {
  if (x > 0) { console.log("pos"); } else { return x; }
  return 1;
}`);
    expect(violations(r)).toBe(0);
    expect(
      r.issues.filter((i) => i.code === "nudo:unproven-return").length,
    ).toBe(1);
  });

  it("负控制：四种关系算子的补集方向各不相同", () => {
    // x >= 0 的补集是 x < 0 ⇒ x > 0 不成立 ⇒ 违约
    expect(
      violations(
        check(`export function f(x) {
  if (x >= 0) { return 1; }
  return x;
}`),
      ),
    ).toBe(1);
    // x > 0 的补集是 x <= 0 ⇒ 违约
    expect(
      violations(
        check(`export function f(x) {
  if (x > 0) { return 1; }
  return x;
}`),
      ),
    ).toBe(1);
    // x < 0 的补集是 x >= 0 ⇒ x > 0 不成立 ⇒ 违约
    expect(
      violations(
        check(`export function f(x) {
  if (x < 0) { return 1; }
  return x;
}`),
      ),
    ).toBe(1);
    // x <= 0 的补集是 x > 0 ⇒ 证得
    expect(
      violations(
        check(`export function f(x) {
  if (x <= 0) { return 1; }
  return x;
}`),
      ),
    ).toBe(0);
  });
});
