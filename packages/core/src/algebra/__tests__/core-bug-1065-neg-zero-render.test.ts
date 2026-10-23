/**
 * Bug 1065 —— 侧车约束的**组合式渲染**把 `lit(-0)` 渲成 `lit(0)`。
 *
 * 改前：`litToString`（`packages/core/src/algebra/interface.ts`）用
 * `String(v)` 序列化 number ⇒ `String(-0) === "0"` ⇒ 负号被抹掉：
 *
 *   - `nudo contract` 回显：`f  [handwritten]  (o: shape({ v: lit(0) })) → lit(0)`
 *     （侧车写的是 `lit(-0)` ⇒ 产品陈述的契约 ≠ 用户写的契约）；
 *   - `nudo check` 诊断：`expected: o.v ∈ lit(0)`（同一条诊断里「陈述的契约」
 *     与侧车里的契约不是同一个）；
 *   - 侧车 DSL 回写（`nudo contract --emit`）同样写 `lit(0)`。
 *
 * `-0` 与 `0` 身份不同（`Object.is` / `1/x` 可观察）——仓库自己已写明这一点
 * （`term.ts` 的 `litKeyString`、`format.ts` 的 `formatLitValue`）⇒ 本面是
 * 同一份「`-0` 保真」约定的**第三个漏点**。
 *
 * 改后：`litToString` 的 number 分支复用仓库既有的保真口径 `litKeyString`
 * （`./term.ts`：`Object.is(v, -0) ⇒ "-0"`）；`lengthBound` 的常数界渲染
 * （`.length(n)`）同款口径一并改。
 *
 * ⚠ 范围：只改 `interface.ts` 的 `litToString` + `lengthBound` 渲染点；
 * `term.ts` / `format.ts` 是**只读**参考（口径来源），未改动。
 */
import { describe, it, expect } from "vitest";
import { formatConstraint } from "../interface.ts";
import { fn, litC, shape, string as str } from "../constraint.ts";

describe("Bug 1065：`-0` 保真（侧车约束的组合式渲染不得抹掉负号）", () => {
  it("lit(-0) 渲染成 lit(-0)，不是 lit(0)", () => {
    expect(formatConstraint(litC(-0))).toBe("lit(-0)");
    expect(formatConstraint(litC(-0))).not.toBe("lit(0)");
  });

  it("字段位（shape）保真：侧车回显与字段契约同源", () => {
    expect(formatConstraint(shape({ v: litC(-0) }))).toBe("shape({ v: lit(-0) })");
  });

  it("函数契约整体保真（参数位 + 返回位）", () => {
    expect(formatConstraint(fn({ o: shape({ v: litC(-0) }) }, litC(-0)))).toBe(
      "fn({ o: shape({ v: lit(-0) }) }, lit(-0))",
    );
  });

  it("lengthBound 的常数界渲染同款口径（.length(-0)）", () => {
    expect(formatConstraint(str().length(-0))).toBe("string().length(-0)");
  });

  it("负控制：正零仍是 0（不得把 0 渲成 -0）", () => {
    expect(formatConstraint(litC(0))).toBe("lit(0)");
    expect(formatConstraint(shape({ v: litC(0) }))).toBe("shape({ v: lit(0) })");
    expect(formatConstraint(str().length(0))).toBe("string().length(0)");
  });

  it("负控制：其它字面量形态不受牵连（bigint 的 n 后缀 / 字符串 / 布尔）", () => {
    expect(formatConstraint(litC(10n))).toBe("lit(10n)");
    expect(formatConstraint(litC("x"))).toBe('lit("x")');
    expect(formatConstraint(litC(true))).toBe("lit(true)");
  });

  it("原生事实：-0 与 0 确实可观察不同（Object.is / 1/x）", () => {
    expect(Object.is(-0, 0)).toBe(false);
    expect(Object.is(-0, -0)).toBe(true);
    expect(1 / -0).toBe(-Infinity);
    // String() 抹掉符号 —— 这正是改前的漏点
    expect(String(-0)).toBe("0");
  });
});
