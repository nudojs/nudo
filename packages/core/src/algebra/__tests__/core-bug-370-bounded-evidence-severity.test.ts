/**
 * Bug 370 —— 返回契约的**带界义务**把「只有 `typeof` 证据」当成「可证伪」
 * ⇒ 同一条义务在 `return x` 下判 **error**（`nudo:constraint-violated`）、在
 * `return x + 1` 下判 **warning**（`nudo:unproven-return`）——判据不一致 ⇒
 * **假红**（`x: number()` 是**无界** prim：`x` 既可能是 5（满足）也可能是
 * -1（不满足）⇒ 「既证不出、也反证不了」）。
 *
 * 修法（core/algebra/postcondition.ts）：`isBoundedEvidenceMissing` 的判据
 * 从「`ret.pred` 存在且 `op !== "true"`」换成「证据面（Φ ∧ ret.pred）**含界
 * 原子**（gt/ge/lt/le）」⇒ `typeof` / prim 值域类 pred 与 `true` 同等对待
 * ⇒ 带界义务在**无界证据**下判 unprovable（warning），与 `return x + 1` 同档。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

/** 带 return 契约（positive = number().gt(0)）的 check */
function check(body: string) {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
export function f(x) {${body}}
`);
  return checkSource("/t/bug370.js", src, pTrue, stdOpts);
}

/** 返回义务的诊断（code + severity） */
function retDiags(r: { issues: Array<{ code: string; severity: string }> }): string[] {
  return r.issues
    .filter((i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return")
    .map((i) => `${i.severity}:${i.code}`);
}

describe("Bug 370：带界义务的判据 = 有界证据（不是「有 pred」）", () => {
  it("return x 与 return x + 1 的返回义务严重级**必须一致**", () => {
    const bare = retDiags(check("  return x;"));
    const arith = retDiags(check("  return x + 1;"));
    expect(bare).toEqual(arith);
    // 无界证据 ⇒ 判「证不出」（warning），不是「确定违约」（error）
    expect(bare).toEqual(["warning:nudo:unproven-return"]);
    expect(arith).toEqual(["warning:nudo:unproven-return"]);
  });

  it("带界义务在**无界证据**下不得出现 nudo:constraint-violated", () => {
    for (const body of [
      "  return x;",
      "  return x + 1;",
      "  return x * 2;",
      "  return -x;",
      "  return x + 0;",
      "  return Math.abs(x);",
    ]) {
      const r = check(body);
      expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    }
  });

  it("**有界证据**时「不蕴含」仍是确定违约（error）——判据不得过宽", () => {
    // 守卫给 x >= 0（含界）⇒ 与 positive（x > 0）不蕴含 ⇒ 确定违约
    const r = check(`
  if (x >= 0) return x;
  return 1;
`);
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
      ),
    ).toBe(true);
  });

  it("字面量返回仍按域隶属判违约（error）", () => {
    const r = check(`
  if (x > 0) { return x; }
  return 0;
`);
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
      ),
    ).toBe(true);
  });
});
