/**
 * strict 端点 IEEE 舍入 unsound（Bug A）+ NaN 端点进界（Bug B）回归。
 *
 * Bug A 背景：ieeeBound 旧实现只挡非有限端点，不检查端点算术的舍入
 * 方向——strict 端点在 fl(端点运算) 舍入越过真实 inf/sup 时产生假
 * strict 界。反例（scout 已验证）：`if (x >= 1 && y > 1e-16) return x + y;`
 * → loSum = fl(1 + 1e-16) = 1（向下舍入恰撞端点）→ 挂 gt(sum, 1)；
 * 实际 x=1、y=2^-53（> 1e-16 的最小可行邻域）时 IEEE 和 === 1，不 > 1。
 *
 * 修法：float 离散性见证——x > a ⟺ x ≥ nextUp(a)。strict 操作数替换为
 * next-step 见证值重算端点运算 w：w > E 保留；w === E 端点外推一步
 * （gt(nextDown(E)) ⟺ ge(E)，strict 语义不变）；消费点 = addsub
 * （add/sub 的 lo/hi）、muldiv（mul ×k / div ÷k，含负 k 侧翻）、
 * pred.ts linInterval（fl 累计端点 + proveLinOp0 的 strict 判定）。
 * 非严格端点不改（fl 单调 ⇒ ge/le 永真）。
 *
 * Bug B：noteBoundFromRel 曾把 gt(x, lit(NaN)) 收成 lo={NaN, strict}——
 * NaN 无序（exclusionLitOf 明确跳过），分支实际不可达，NaN 端点却先到
 * 先得占位并向区间合成传播；修法对齐口径：NaN 直接 return。
 */
import { describe, it, expect } from "vitest";
import { nextUp, nextDown, gt, ge, lt, le, and, implies, pTrue } from "../pred.ts";
import { add, sub, mul, div, numericBounds } from "../arithmetic.ts";
import { abs, num, numLit, numVar } from "../abs.ts";
import { v, lit, app } from "../term.ts";
import { checkSource } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const MIN = Number.MIN_VALUE;
const MAX = Number.MAX_VALUE;

describe("nextUp / nextDown：IEEE 位级步进边界", () => {
  it("±0 与最小次正规数", () => {
    expect(nextUp(0)).toBe(MIN);
    expect(nextUp(-0)).toBe(MIN);
    expect(nextDown(0)).toBe(-MIN);
    expect(nextDown(-0)).toBe(-MIN);
    expect(nextUp(MIN)).toBe(2 * MIN);
    expect(nextDown(MIN)).toBe(0);
    // 位级结果是 -0（幅值递减借位清 mantissa，符号位保留）；数值上 -0 === 0
    expect(Object.is(nextUp(-MIN), -0)).toBe(true);
    // 负数 nextDown 远离零（幅值递增）
    expect(nextDown(-2 * MIN)).toBe(-3 * MIN);
  });

  it("最大有限数与 ±Infinity", () => {
    expect(nextUp(MAX)).toBe(Infinity);
    expect(nextDown(-MAX)).toBe(-Infinity);
    expect(nextDown(MAX)).toBeLessThan(MAX);
    expect(nextDown(MAX)).toBeGreaterThan(0);
    expect(nextUp(-Infinity)).toBe(-MAX);
    expect(nextDown(Infinity)).toBe(MAX);
    // 直通：无下一位可去
    expect(nextUp(Infinity)).toBe(Infinity);
    expect(nextDown(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(nextUp(NaN))).toBe(true);
    expect(Number.isNaN(nextDown(NaN))).toBe(true);
  });

  it("正规数步长 = 1 ulp", () => {
    expect(nextUp(1)).toBe(1 + 2 ** -52);
    expect(nextDown(1)).toBe(1 - 2 ** -53);
    expect(nextUp(-1)).toBe(-(1 - 2 ** -53));
    expect(nextDown(1) + 2 ** -53).toBe(1);
  });

  it("可逆性与单调性（采样点全覆盖）", () => {
    const samples = [
      MIN,
      2 * MIN,
      1e-300,
      1e-16,
      0.1,
      1,
      Math.PI,
      1e16,
      MAX,
      -MAX,
      -1e16,
      -Math.PI,
      -1,
      -0.1,
      -1e-16,
      -1e-300,
      -MIN,
    ];
    for (const s of samples) {
      expect(nextUp(nextDown(s))).toBe(s);
      expect(nextDown(nextUp(s))).toBe(s);
      expect(nextUp(s) > s).toBe(true);
      expect(nextDown(s) < s).toBe(true);
    }
  });
});

describe("Bug A：add/sub strict 端点舍入（反例回归）", () => {
  it("反例 1（add lo）：x>=1 ∧ y>1e-16 不再假证 gt(sum, 1)", () => {
    // 反例可达性：fl(1 + 2^-53) === 1 且 2^-53 > 1e-16
    expect(1 + 1e-16).toBe(1);
    expect(1 + 2 ** -53).toBe(1);
    expect(2 ** -53 > 1e-16).toBe(true);

    const x = numVar("x", ge(v("x"), lit(1)));
    const y = numVar("y", gt(v("y"), lit(1e-16)));
    const r = add(x, y);
    const b = numericBounds(r, pTrue);
    // 修复前：lo = {1, strict}（unsound——结果恰可为 1）
    expect(b?.lo).toEqual({ value: nextDown(1), strict: true });
    expect(b?.lo?.value).not.toBe(1);
  });

  it("反例镜像（add hi）：x<1 ∧ y<1e-16 的 lt 上界外推", () => {
    // x=nextDown(1)、y=nextDown(1e-16) 时 IEEE 和 === 1（吸收进位）
    expect(nextDown(1) + nextDown(1e-16)).toBe(1);
    const x = numVar("x", lt(v("x"), lit(1)));
    const y = numVar("y", lt(v("y"), lit(1e-16)));
    const r = add(x, y);
    const b = numericBounds(r, pTrue);
    // 修复前：hi = {1, strict}（unsound——结果恰可为 1）
    expect(b?.hi).toEqual({ value: nextUp(1), strict: true });
    expect(b?.hi?.value).not.toBe(1);
  });

  it("反例 2（sub lo）：x>=1 ∧ b<1e-16 的 gt 下界外推", () => {
    // E = fl(1 - 1e-16) = nextDown(1)，且可取到（x=1, b=nextDown(1e-16)）
    expect(1 - 1e-16).toBe(nextDown(1));
    expect(1 - nextDown(1e-16)).toBe(nextDown(1));
    const x = numVar("x", ge(v("x"), lit(1)));
    const bnd = numVar("b", lt(v("b"), lit(1e-16)));
    const r = sub(x, bnd);
    const b = numericBounds(r, pTrue);
    // 修复前：lo = {nextDown(1), strict}（unsound——x-b 恰可为 nextDown(1)）
    expect(b?.lo).toEqual({ value: nextDown(nextDown(1)), strict: true });
    expect(b?.lo?.value).not.toBe(nextDown(1));
  });

  it("正例保精度：x>1 ∧ y>1 仍证 gt(sum, 2)", () => {
    const x = numVar("x", gt(v("x"), lit(1)));
    const y = numVar("y", gt(v("y"), lit(1)));
    const r = add(x, y);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 2, strict: true });
  });

  it("非严格端点不受影响：x>=1 ∧ y>=1 仍证 ge(sum, 2)", () => {
    const x = numVar("x", ge(v("x"), lit(1)));
    const y = numVar("y", ge(v("y"), lit(1)));
    const r = add(x, y);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 2, strict: false });
  });
});

describe("Bug A：mul/div strict 端点舍入", () => {
  it("正例保精度：x>1 ×3 仍证 gt(3)；x>1 ÷2 仍证 gt(0.5)", () => {
    const x = numVar("x", gt(v("x"), lit(1)));
    expect(numericBounds(mul(x, numLit(3)), pTrue)?.lo).toEqual({ value: 3, strict: true });
    expect(numericBounds(div(x, numLit(2)), pTrue)?.lo).toEqual({ value: 0.5, strict: true });
    // k 为 2 的幂：乘除精确，strict 端点不退
    expect(numericBounds(mul(x, numLit(2)), pTrue)?.lo).toEqual({ value: 2, strict: true });
  });

  it("div 下溢（latent unsound）：x>0 ÷2 不再假证 gt(0)", () => {
    // fl(MIN_VALUE / 2) === 0：x=MIN_VALUE 满足 x>0，但 IEEE 商 === 0
    expect(nextUp(0) / 2).toBe(0);
    const x = numVar("x", gt(v("x"), lit(0)));
    const r = div(x, numLit(2));
    const b = numericBounds(r, pTrue);
    // 修复前：strictZeroOk(|k|<=1) 保留 gt(x/2, 0)——假证明
    expect(b?.lo).not.toEqual({ value: 0, strict: true });
    expect(b?.lo).toEqual({ value: -MIN, strict: true });
  });

  it("mul 下溢侧：x>0 ×0.5 的 strict 0 端点经见证外推（sound 事实保留）", () => {
    expect(nextUp(0) * 0.5).toBe(0); // 见证被下溢吸收
    const x = numVar("x", gt(v("x"), lit(0)));
    const b = numericBounds(mul(x, numLit(0.5)), pTrue);
    expect(b?.lo).toEqual({ value: -MIN, strict: true });
  });

  it("负 k 侧翻仍精确：x>1 ×(-2) 证 lt(-2)；x>1 ÷(-2) 证 lt(-0.5)", () => {
    const x = numVar("x", gt(v("x"), lit(1)));
    expect(numericBounds(mul(x, numLit(-2)), pTrue)?.hi).toEqual({ value: -2, strict: true });
    expect(numericBounds(div(x, numLit(-2)), pTrue)?.hi).toEqual({ value: -0.5, strict: true });
  });

  it("上界下溢镜像：x<0（hi 侧 strict）÷2 不再假证 lt(0)", () => {
    expect(nextDown(0) / 2 === 0).toBe(true); // fl(-MIN/2) = -0（ties-to-even）
    const x = numVar("x", lt(v("x"), lit(0)));
    const b = numericBounds(div(x, numLit(2)), pTrue);
    expect(b?.hi).not.toEqual({ value: 0, strict: true });
    expect(b?.hi).toEqual({ value: MIN, strict: true });
  });
});

describe("Bug A：pred.ts linInterval 见证校准", () => {
  it("吸收型累加：x>0 ∧ y>=1 ⊬ x+y > 1（strict 步进被 fl 累计吸收）", () => {
    // 线性式 lo = fl(fl(0 + 0) + 1) + (-1) = 0（strict）；见证
    // w = fl(fl(0 + MIN) + 1) - 1 = 0 === E（MIN 被 1 吸收）→ 端点外推，
    // gt(x+y, 1) 不再证出（IEEE 语义下 x=MIN、y=1 的和 === 1）
    expect(1 + MIN).toBe(1);
    const phi = and(gt(v("x"), lit(0)), ge(v("y"), lit(1)));
    expect(implies(phi, gt(app("+", [v("x"), v("y")]), lit(1)))).toBe(false);
  });

  it("双 strict 存活：x>0 ∧ y>0 ⊢ x+y > 0（两步见证不被吸收）", () => {
    const phi = and(gt(v("x"), lit(0)), gt(v("y"), lit(0)));
    expect(implies(phi, gt(app("+", [v("x"), v("y")]), lit(0)))).toBe(true);
  });

  it("经典精度不回退：x>1 ∧ y>1 ⊢ x+y > 2；x>1 ⊢ x*3 > 3", () => {
    const phi = and(gt(v("x"), lit(1)), gt(v("y"), lit(1)));
    expect(implies(phi, gt(app("+", [v("x"), v("y")]), lit(2)))).toBe(true);
    expect(implies(gt(v("x"), lit(1)), gt(app("*", [v("x"), lit(3)]), lit(3)))).toBe(true);
    // （÷k 的精度由代数层 div 消费点保证——pred 线性化不展开除法）
  });

  it("非严格线性判定不变：x>=1 ∧ y>=1 ⊢ x+y >= 2", () => {
    const phi = and(ge(v("x"), lit(1)), ge(v("y"), lit(1)));
    expect(implies(phi, ge(app("+", [v("x"), v("y")]), lit(2)))).toBe(true);
  });
});

describe("Bug B：NaN 端点不进界（noteBoundFromRel）", () => {
  it("gt(x, NaN) 单独出现：无数值界", () => {
    // if (x > 0/0) 形态——0/0 求值为 NaN 字面量，pred 恒假
    const x = abs(num().shape, v("x"), gt(v("x"), lit(NaN)), "path");
    expect(numericBounds(x, pTrue)).toBeUndefined();
  });

  it("gt(x, NaN) ∧ ge(x, 0)：NaN 不再先到先得占位（旧污染路径）", () => {
    // 修复前：tightenLo 先收 NaN={NaN,strict}，随后 ge 的 0 > NaN 恒
    // false 改不动它 → lo 停在 NaN，向区间合成传播
    const x = abs(num().shape, v("x"), and(gt(v("x"), lit(NaN)), ge(v("x"), lit(0))), "path");
    const b = numericBounds(x, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(Number.isNaN(b?.lo?.value ?? 0)).toBe(false);
    expect(Number.isNaN(b?.hi?.value ?? 0)).toBe(false);
  });

  it("lt(x, NaN) 上界同样跳过", () => {
    const x = abs(num().shape, v("x"), and(lt(v("x"), lit(NaN)), le(v("x"), lit(5))), "path");
    const b = numericBounds(x, pTrue);
    expect(b?.hi).toEqual({ value: 5, strict: false });
  });
});

describe("Bug A 端到端：@nudo:contract return 不再假证明", () => {
  const files = {
    "/t/ieee.nudo.js": `export const above1 = number().gt(1);
export const atLeast1 = number().ge(1);
export const tinyPos = number().gt(1e-16);
`,
  };
  const { loadModule } = makeFiles(files);
  const opts = { loadModule, fromFile: "/t/t.js" };

  it("反例：x>=1 ∧ y>1e-16 的 x+y ⊭ return > 1（修复前假证明通过）", () => {
    const r = checkSource(
      "/t/t.js",
      `/// @nudo:import { above1, atLeast1, tinyPos } from "./ieee.nudo.js"
/**
 * @nudo:contract x atLeast1, y tinyPos
 * @nudo:contract return above1
 */
function addTiny(x, y) {
  return x + y;
}
`,
      pTrue,
      opts,
    );
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && i.fn === "addTiny" && i.message.includes("return"),
      ),
    ).toBe(true);
    // 修复后的实际面：strict 下界退一步（修复前是 > 1 的假 strict 界且通过）
    const err = r.issues.find((i) => i.fn === "addTiny");
    expect(err?.actual).toContain("> 0.9999999999999999");
  });

  it("正例：x>1 ∧ y>1 的 x+y 仍证 return > 1", () => {
    const r = checkSource(
      "/t/t.js",
      `/// @nudo:import { above1 } from "./ieee.nudo.js"
/**
 * @nudo:contract x above1, y above1
 * @nudo:contract return above1
 */
function addPos(x, y) {
  return x + y;
}
`,
      pTrue,
      opts,
    );
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && i.fn === "addPos" && i.message.includes("return"),
      ),
    ).toBe(false);
  });
});
