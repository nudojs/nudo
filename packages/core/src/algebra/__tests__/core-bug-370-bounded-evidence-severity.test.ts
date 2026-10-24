/**
 * Bug 370 的判据已被 **Bug 1116 撤销**（返回契约的带界义务**不得**把「只有
 * `typeof` 证据」的**声明域参数**当成「不可判定」）。
 *
 * Bug 370 的口径：`isBoundedEvidenceMissing` 的判据 = 「证据面（Φ ∧ ret.pred）
 * **含界原子**（gt/ge/lt/le）」⇒ `typeof` 级证据（`@nudo:contract x num` 的
 * 声明域参数）被判成「无证据」⇒ 降级 `nudo:unproven-return`（**warning**）。
 *
 * Bug 1116 的口径（现行）：判据 = 「`ret.pred` 有事实」⇒ 声明域参数的值域
 * **已知**（`number()` ⇒ 任意 number，含 NaN）⇒ 返回契约是对**所有**输入成立
 * 的后置 ⇒ 值域 ⊄ 契约域（x=0 即违约）⇒ **契约不成立** ⇒ 判
 * `nudo:constraint-violated`（**error**）。warning 不改 exit code ⇒ 门禁空转
 * （docs/design/cli-semantics.md §5.5：warning 只针对 any/unknown）。
 *
 * ⇒ 「`return x` 与 `return x + 1` 同档」不再成立：**声明域参数**的值域已知
 * （⇒ 可判定 ⇒ error），**派生项**（`x + 1` / `Math.abs(x)`）的值域未被跟踪
 * （⇒ 证不出也反证不了 ⇒ warning）。二者之差是**引擎能力边界**（派生项的值域
 * 未被跟踪），不是判据不一致。
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
  it("声明域参数 ⇒ 值域已知 ⇒ 判「确定违约」（error）；派生项 ⇒ 判「证不出」（warning）", () => {
    const bare = retDiags(check("  return x;"));
    const arith = retDiags(check("  return x + 1;"));
    // Bug 1116：`return x` 的返回项是**声明域参数**（x: number()）⇒ 值域已知
    // ⇒ `positive` 不蕴含 ⇒ 契约不成立（x=0 即违约）⇒ error。
    expect(bare).toEqual(["error:nudo:constraint-violated"]);
    // 派生项的值域未被跟踪 ⇒ 既证不出也反证不了 ⇒ warning（fail-closed）。
    expect(arith).toEqual(["warning:nudo:unproven-return"]);
  });

  it("派生项（值域未跟踪）在带界义务下不得出现 nudo:constraint-violated", () => {
    for (const body of [
      "  return x + 1;",
      "  return x * 2;",
      "  return -x;",
      "  return x + 0;",
      "  return Math.abs(x);",
    ]) {
      const r = check(body);
      expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    }
    // 声明域参数（值域已知）**不在**本组：它判 error 是**正确**的（见上条）。
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
