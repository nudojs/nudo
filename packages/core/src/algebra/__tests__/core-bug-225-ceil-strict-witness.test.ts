/**
 * BUG-225 回归：内建取整通道（`roundingAbs`）丢掉 strict 端点的**见证步进**
 * ⇒ `Math.ceil(x)`（契约 `x > 0` ⇒ 恒 `≥ 1`）被 L1 返回契约判成违约
 * （error / exit 1），而同语义的 `Math.floor(x) + 1` 判 GREEN ⇒ 假红 +
 * 同一语义两种写法结论相反。
 *
 * 根因：`packages/core/src/algebra/builtins/math.ts` 的 `roundingAbs` 对端点
 * 直接取 `impl(b.lo.value)`：输入 `x > 0` ⇒ `Math.ceil(0) = 0` ⇒ 下界比真界
 * （`ceil(5e-324) = 1`）松整整一级；且 `strict` 被硬编码 false。
 *
 * 修法：strict 端点做见证步进（与 `synthEndpoint` 同口径）——
 * `impl(nextUp(lo))` / `impl(nextDown(hi))`，结果按「可达」记（非 strict）。
 * 对照组：`floor` / `trunc` / `round` 的真下界本就是 `≥ 0`（`floor(0.5)=0`）
 * ⇒ 对 `x > 0` 判红是**正确的**，不得被本条放松。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit } from "../abs.ts";
import { lit as termLit, v as termVar } from "../term.ts";
import { gt } from "../pred.ts";
import { number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";
import { formatAbs } from "../format.ts";
import { numericBounds } from "../arithmetic.ts";
import { evalMathMethod } from "../builtins/math.ts";
import { issuesOf } from "./nudo-constraints.ts";

function numBound(n: number) {
  const t = termVar("x");
  return abs({ k: "prim", type: "number" }, t, gt(t, termLit(n)), "path");
}

const violations = (r: ReturnType<typeof issuesOf>) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

function checkReturn(body: string) {
  return issuesOf(
    `/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function f(x) {
  return ${body};
}
`,
    "/t/bug225.js",
  );
}

describe("BUG-225: 取整内建的 strict 端点须做见证步进", () => {
  it.each([["Math.ceil(x)"], ["Math.ceil(Math.ceil(x))"], ["Math.floor(x) + 1"], ["Math.trunc(x) + 1"]])(
    "契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约",
    (body) => {
      expect(violations(checkReturn(body))).toEqual([]);
    },
  );

  it("对照（真红必须保留）：`Math.floor(x)` 在 x = 5e-324 处为 0 ⇒ 仍判违约", () => {
    const v = violations(checkReturn("Math.floor(x)"));
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  });

  it("单元面：Math.ceil(x>0) 的下界是 1（此前是 0）", () => {
    const ceilAbs = evalMathMethod("ceil", [numBound(0)])!;
    const b = numericBounds(ceilAbs);
    expect(b?.lo).toEqual({ value: 1, strict: false });
    expect(formatAbs(ceilAbs)).toContain("≥ 1");
    expect(assertImplies(ceilAbs, number().gt(0)).status).toBe("proved");
  });

  it("单元面：整数界触发（x > 5 ⇒ Math.ceil(x) ≥ 6），不依赖 denormal 推理", () => {
    const ceilAbs = evalMathMethod("ceil", [numBound(5)])!;
    expect(numericBounds(ceilAbs)?.lo).toEqual({ value: 6, strict: false });
    expect(assertImplies(ceilAbs, number().gt(5)).status).toBe("proved");
    // 对照：floor(x>5) 的真下界仍是 5（x=5.000000000000001 ⇒ 5）⇒ 判红是对的
    const floorAbs = evalMathMethod("floor", [numBound(5)])!;
    expect(numericBounds(floorAbs)?.lo).toEqual({ value: 5, strict: false });
    expect(assertImplies(floorAbs, number().gt(5)).status).toBe("disproved");
  });

  it("单元面：upper 侧同样做见证步进（x < 0 ⇒ Math.floor(x) ≤ -1）", () => {
    const t = termVar("x");
    const xLt0 = abs({ k: "prim", type: "number" }, t, { op: "lt", a: t, b: termLit(0) } as never, "path");
    const floorAbs = evalMathMethod("floor", [xLt0])!;
    expect(numericBounds(floorAbs)?.hi).toEqual({ value: -1, strict: false });
    // 常量折叠路径不受影响
    expect(evalMathMethod("ceil", [numLit(0)])).toEqual(
      expect.objectContaining({ shape: { k: "prim", type: "number" } }),
    );
  });
});
