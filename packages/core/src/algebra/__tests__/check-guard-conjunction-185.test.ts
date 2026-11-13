/**
 * issue #185 —— 合取守卫（异名参数）的关系事实不累积：`x >= 1 && y >= 2`
 * 下 `x + y` 的和契约证不出，而嵌套 if 能证。
 *
 * 修复前根因（三处）：
 * 1. `matchRelIdentLitComposite` 对不同名合取项**只保留先到**的名字 ⇒
 *    事实臂只给一个参数挂界 ⇒ `x + y` 区间只折一侧；
 * 2. `&&` 右操作数（短路 cons 臂）不接 left 的关系事实 ⇒
 *    `x >= 1 && (y >= 2 ? x + y : 3)` 的右臂丢 x 的界；
 * 3. 早退后续路径 / else 臂 / 三元 alt 臂不接 `!(A ∧ …)` 的**否定事实**
 *    （`!` 是精确布尔取反：`!(A ∧ …)` 为假 ⇒ `A ∧ …` 为真，NaN 不可达）。
 *
 * 精度红线（issue 要求的另一半**不得**实现）：顺序早退
 * `if (x < 1) return 3; … return x + y;` 与 De Morgan
 * `if (x < 1 || y < 2) return 3; …` 的后续路径不能断言 `x >= 1`/`y >= 2`——
 * `¬(x < k)` 只蕴含 `x ≥ k ∨ x is NaN`（Bug 1115），而 `number()` 含 NaN：
 * 原生 `add6(NaN, 5) = NaN ⊭ ge(3)`，证明即假绿。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { call } from "./eval-helpers.ts";
import { numVar } from "../abs.ts";
import { numericBounds } from "../arithmetic.ts";

const SIDECAR = `
export const num = number();
export const ge3 = number().ge(3);
export const ge2 = number().ge(2);
export const nonNeg = number().ge(0);
`;

const FILE = "/t/issue185.js";
const opts = sidecarOpts("issue185.nudo", SIDECAR, FILE);

/** 返回义务诊断（证不出 warning + 违约 error）的 "severity:code" 列表 */
function retDiags(body: string, ret = "ge3"): string[] {
  const src = `/// @nudo:import { num, ge2, ge3, nonNeg } from "./issue185.nudo.js"
/**
 * @nudo:contract x num
 * @nudo:contract y num
 * @nudo:contract return ${ret}
 */
function f(x, y) {${body}}
`;
  return checkSource(FILE, src, pTrue, opts).issues
    .filter(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

/** 单参形态（x only） */
function retDiags1(body: string, ret = "ge2"): string[] {
  const src = `/// @nudo:import { num, ge2, ge3, nonNeg } from "./issue185.nudo.js"
/**
 * @nudo:contract x num
 * @nudo:contract return ${ret}
 */
function g(x) {${body}}
`;
  return checkSource(FILE, src, pTrue, opts).issues
    .filter(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

describe("issue #185：异名合取守卫的事实累积（可健全证明的形态）", () => {
  it("三元正合取：x >= 1 && y >= 2 ? x + y : 3 —— ge(3) 证得", () => {
    expect(retDiags(" return x >= 1 && y >= 2 ? x + y : 3;")).toEqual([]);
  });

  it("if 正合取事实臂：if (x >= 1 && y >= 2) return x + y; return 3 —— 证得", () => {
    expect(retDiags(" if (x >= 1 && y >= 2) { return x + y; } return 3;")).toEqual([]);
  });

  it("否定合取的早退后续路径：!(A ∧ B) 为假 ⇒ A ∧ B —— 证得", () => {
    // `!` 是精确布尔取反（NaN 无关）⇒ 后续路径事实健全
    expect(retDiags(" if (!(x >= 1 && y >= 2)) return 3; return x + y;")).toEqual([]);
  });

  it("三元否定的 else 臂：!(A ∧ B) ? 3 : x + y —— 证得", () => {
    expect(retDiags(" return !(x >= 1 && y >= 2) ? 3 : x + y;")).toEqual([]);
  });

  it("单关系否定的早退后续路径：!(x >= 1) 为假 ⇒ x >= 1 —— 证得", () => {
    expect(retDiags1(" if (!(x >= 1)) return 2; return x + 1;")).toEqual([]);
  });

  it("&& 短路右臂接 left 的关系事实：x 的界进入 (y >= 2 ? x + y : 3)", () => {
    // 值形态无法用整体契约观察（alt 臂值是抽象 boolean）⇒ 直接探 evaluator：
    // 修复前 x+y 成员无下界；修复后数值成员 lo = 3。
    const r = call(
      "function f(x, y) { return x >= 1 && (y >= 2 ? x + y : 3); }",
      "f",
      [numVar("x"), numVar("y")],
    );
    const shape = r.result.shape as { k: string; members?: unknown[] };
    const members = shape.k === "sum" ? shape.members! : [r.result];
    const bounded = members.some((m) => {
      const b = numericBounds(m as never, pTrue);
      return b?.lo?.value === 3 && b.lo.strict === false;
    });
    expect(bounded).toBe(true);
  });
});

describe("issue #185：不可健全证明的形态保持 unproven（NaN 红线）", () => {
  it("顺序早退 clause（x < 1 / y < 2）后续路径不断言补集", () => {
    // 原生反例：add6(NaN, 5) = NaN ⊭ ge(3)（NaN < 1 为假 ⇒ 走到 return x + y）
    expect(retDiags(" if (x < 1) return 3; if (y < 2) return 3; return x + y;")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  });

  it("De Morgan 形态（x < 1 || y < 2）后续路径不断言补集", () => {
    expect(retDiags(" if (x < 1 || y < 2) return 3; return x + y;")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  });

  it("裸关系补集（Bug 1115）：if (x < 0) return 0; return x; 仍不得证成 nonNeg", () => {
    const diags = retDiags1(" if (x < 0) return 0; return x;", "nonNeg");
    // 既有口径（Bug 1115 / Bug 1116）：后续路径返回项是声明域参数 ⇒ 可证伪
    // ⇒ 该契约在 x=NaN 时确实被违反 ⇒ 必须报（不得静默）
    expect(diags).toHaveLength(1);
  });

  it("测试自身改写守卫变量 ⇒ 关系事实剪影跳过（不得拿改写前的界证改写后的值）", () => {
    // 原生：y=2 ⇒ 合取为真（2>=2 ∧ -8>-999）⇒ else 返回 -8 ⊭ ge(2)
    const src = `/// @nudo:import { num, ge3 } from "./issue185.nudo.js"
/**
 * @nudo:contract x num
 * @nudo:contract y num
 * @nudo:contract return ge3
 */
function h(x, y) { if (!(x >= 1 && (y = y - 10) > -999)) { return 3; } else { return x + y; } }
`;
    const diags = checkSource(FILE, src, pTrue, opts).issues.filter(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    );
    expect(diags).not.toHaveLength(0);
  });
});
