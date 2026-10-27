/**
 * BUG-224 回归：算术端点合成丢失「最紧可达值」⇒ `(x + x) / 2` / `x * 2 / 2`
 * 这类**恒 > 0** 的表达式被 L1 返回契约判成违约（error / exit 1），而同一语义
 * 的 `x` 判 GREEN ⇒ 假红 + 同一值的两种写法结论互斥。
 *
 * 根因：strict 端点的见证一律取 `nextUp(bound)`——`x + x` 的界是 `> 0`（正确），
 * 但它的**最紧可达值**是 `fl(5e-324 + 5e-324) = 1e-323`，不是 `nextUp(0)`。
 * 用不可达见证做下一步除法 ⇒ `fl(5e-324 / 2) = 0` 下溢回端点 ⇒
 * `ieeeStrictEndpoint` 退到 `nextDown(0)` ⇒ 界被放松整整一个 binade（`> -5e-324`）
 * ⇒ 不蕴含 `> 0` ⇒ 假红。
 *
 * 修法：端点模型携带 `attain`（`attainEndpoint`）——只对**可精确反解**的缩放
 * 形态（`t + t`、`t × 2^k`）填「可达下界」，`synthEndpoint` 见证优先用它。
 * 对照：`x / 2` 在 x = 5e-324 时**确实**为 0 ⇒ 仍必须判红（不得被本条放松）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit } from "../abs.ts";
import { lit as termLit, v as termVar } from "../term.ts";
import { gt } from "../pred.ts";
import { add } from "../arithmetic/addsub.ts";
import { div, mul } from "../arithmetic/muldiv.ts";
import { number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";
import { formatAbs } from "../format.ts";
import { issuesOf } from "./nudo-constraints.ts";

/** x: number, x > 0（与夹具 `std.nudo.js` 的 `positive` 同形） */
function positiveX() {
  const x = termVar("x");
  return abs({ k: "prim", type: "number" }, x, gt(x, termLit(0)), "path");
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
    "/t/bug224.js",
  );
}

describe("BUG-224: 先放大再折半不得被放松成假红", () => {
  it.each([["x"], ["x + x"], ["x * 2"], ["(x + x) / 2"], ["x * 2 / 2"], ["(x + x) * 0.5"]])(
    "契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约",
    (body) => {
      expect(violations(checkReturn(body))).toEqual([]);
    },
  );

  it("对照（真红必须保留）：`x / 2` 在 x = 5e-324 处为 0 ⇒ 仍判违约", () => {
    const v = violations(checkReturn("x / 2"));
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  });

  it("单元面：(x + x) / 2 的界是 > 0（不是被放松的 > -5e-324）", () => {
    const x = positiveX();
    const halved = div(add(x, x), numLit(2));
    expect(assertImplies(halved, number().gt(0)).status).toBe("proved");
    const printed = formatAbs(halved);
    expect(printed).toContain("> 0");
    expect(printed).not.toContain("-5e-324");
  });

  it("单元面：x * 2 / 2 与 (x + x) * 0.5 同结论（乘法路径同样补 attain）", () => {
    const x = positiveX();
    expect(assertImplies(div(mul(x, numLit(2)), numLit(2)), number().gt(0)).status).toBe("proved");
    expect(assertImplies(mul(add(x, x), numLit(0.5)), number().gt(0)).status).toBe("proved");
  });

  it("单元面：x / 2 与 x * 0.5 保持 disproved（真界 ≥ 0，不可放松）", () => {
    const x = positiveX();
    expect(assertImplies(div(x, numLit(2)), number().gt(0)).status).toBe("disproved");
    expect(assertImplies(mul(x, numLit(0.5)), number().gt(0)).status).toBe("disproved");
  });
});
