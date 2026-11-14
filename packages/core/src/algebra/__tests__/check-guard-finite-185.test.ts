/**
 * issue #185 · 补集半：契约 `number().finite()` + 运行时关系补集。
 *
 * 顺序早退 / De Morgan 的 fall-through 不能断言 `x >= k`，因为
 * `¬(x < k)` 只蕴含 `x >= k ∨ x is NaN`（Bug 1115）。`.finite()` 提供
 * 非 NaN 证据后，运行时 `$refineRelComplement` 才收紧；缺证据必须**原样
 * 返回**（不得假绿）。负数界（`.ge(-5)` 等）本身排除 NaN ⇒ 同样触发补集。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { $refineRelComplement } from "../exec/index.ts";
import { number, string, shape, derefConstraint } from "../constraint.ts";
import { abs, litValue } from "../abs.ts";
import { v as termVar, lit } from "../term.ts";
import { assumeFinite, ge, implies } from "../pred.ts";

const SIDECAR = `
export const num = number();
export const fin = number().finite();
export const ge3 = number().ge(3);
export const nonNeg = number().ge(0);
export const geNeg5 = number().ge(-5);
`;

const FILE = "/t/issue185-finite.js";
const opts = sidecarOpts("issue185-finite.nudo", SIDECAR, FILE);

function issuesOf(body: string, contracts: string, calls = ""): string[] {
  const src = `/// @nudo:import { num, fin, ge3, nonNeg, geNeg5 } from "./issue185-finite.nudo.js"
/**
${contracts}
 */
function f(x, y) {${body}}
${calls}
`;
  return checkSource(FILE, src, pTrue, opts).issues
    .filter(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

const C_FIN = ` * @nudo:contract x fin
 * @nudo:contract y fin
 * @nudo:contract return ge3`;
const C_NUM = ` * @nudo:contract x num
 * @nudo:contract y num
 * @nudo:contract return ge3`;

describe("issue #185 补集半：number().finite() 提供非 NaN 证据", () => {
  it("顺序早退（x < 1 / y < 2）在 finite 下证得 ge(3)", () => {
    expect(
      issuesOf(" if (x < 1) return 3; if (y < 2) return 3; return x + y;", C_FIN),
    ).toEqual([]);
  });

  it("无 finite 仍是 unproven（NaN 反例：add6(NaN, 5) = NaN）", () => {
    expect(
      issuesOf(" if (x < 1) return 3; if (y < 2) return 3; return x + y;", C_NUM),
    ).toEqual(["warning:nudo:unproven-return"]);
  });

  it("De Morgan（x < 1 || y < 2）在 finite 下逐项取补集 ⇒ 证得", () => {
    expect(issuesOf(" if (x < 1 || y < 2) return 3; return x + y;", C_FIN)).toEqual([]);
    expect(issuesOf(" if (x < 1 || y < 2) return 3; return x + y;", C_NUM)).toEqual([
      "warning:nudo:unproven-return",
    ]);
  });

  it("三元 else 臂同样取补集（x < 1 || y < 2 ? 3 : x + y）", () => {
    expect(issuesOf(" return x < 1 || y < 2 ? 3 : x + y;", C_FIN)).toEqual([]);
  });

  it("数值界本身排除 NaN：number().ge(-5) 无需 .finite() 也能取补集", () => {
    const bounded = ` * @nudo:contract x geNeg5
 * @nudo:contract return nonNeg`;
    expect(issuesOf(" if (x < 0) return 0; return x;", bounded)).toEqual([]);
    const plain = ` * @nudo:contract x num
 * @nudo:contract return nonNeg`;
    // 无界 number() 含 NaN ⇒ 后续路径返回 x 可证伪（x=NaN 违反 nonNeg）
    expect(issuesOf(" if (x < 0) return 0; return x;", plain)).toEqual([
      "error:nudo:constraint-violated",
    ]);
  });

  it("literal NaN / Infinity 违反 finite 前置；普通数字放行", () => {
    const ret = ` * @nudo:contract x fin
 * @nudo:contract return num`;
    const body = " return x;";
    expect(issuesOf(body, ret, "f(0/0);")).toEqual(["error:nudo:constraint-violated"]);
    expect(issuesOf(body, ret, "f(1/0);")).toEqual(["error:nudo:constraint-violated"]);
    expect(issuesOf(body, ret, "f(1);")).toEqual([]);
  });
});

describe("number().finite() builder", () => {
  it("追加 assumeFinite(self) 并保留数值 prim", () => {
    const c = derefConstraint(number().finite());
    expect(c.prim).toBe("number");
    expect(c.preds).toEqual([assumeFinite(termVar("__nudo_self__"))]);
  });

  it("与数值界可链式组合", () => {
    const c = derefConstraint(number().finite().ge(0));
    expect(c.preds.map((p) => p.op)).toEqual(["assumeFinite", "ge"]);
  });

  it("非数值链构造期拒绝（避免恒假契约）", () => {
    expect(() => string().finite()).toThrow(/only numeric chains/);
    expect(() => shape({ a: number() }).finite()).toThrow(/numeric scalar/);
  });
});

describe("$refineRelComplement：运行时非 NaN 门", () => {
  const t = termVar("x");
  const finiteNum = abs({ k: "prim", type: "number" }, t, assumeFinite(t), "exact");
  const plainNum = abs({ k: "prim", type: "number" }, t, undefined, "exact");

  it("有 finite 证据 ⇒ 补集界进入 Abs", () => {
    const out = $refineRelComplement(finiteNum, "lt", 1);
    expect(out.pred).toBeDefined();
    expect(implies(out.pred!, ge(t, lit(1)))).toBe(true);
  });

  it("无证据 ⇒ 原样返回（不得断言 x >= k）", () => {
    expect($refineRelComplement(plainNum, "lt", 1)).toBe(plainNum);
  });

  it("非数值 / 字面量接收者保持原样", () => {
    const str = abs({ k: "prim", type: "string" }, t, assumeFinite(t), "exact");
    expect($refineRelComplement(str, "lt", 1)).toBe(str);
    const litNum = abs({ k: "prim", type: "number" }, lit(0), assumeFinite(t), "exact");
    expect($refineRelComplement(litNum, "lt", 1)).toBe(litNum);
    expect(litValue($refineRelComplement(finiteNum, "lt", 1)).ok).toBe(false);
  });
});
