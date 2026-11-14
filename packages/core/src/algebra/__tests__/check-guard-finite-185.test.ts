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
import { $refineRelComplement, $refineNotNaN, withExecPhi, transpileSource } from "../exec/index.ts";
import { number, string, shape, derefConstraint } from "../constraint.ts";
import { abs, litValue } from "../abs.ts";
import { v as termVar, lit } from "../term.ts";
import { assumeFinite, eq, ge, implies, ne } from "../pred.ts";
import { isNonNaN } from "../arithmetic.ts";

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

function issues1(body: string, contracts: string): string[] {
  const src = `/// @nudo:import { num, fin, ge3, nonNeg, geNeg5 } from "./issue185-finite.nudo.js"
/**
${contracts}
 */
function g(x) {${body}}
`;
  return checkSource(FILE, src, pTrue, opts).issues
    .filter(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

const C_NUM_2 = ` * @nudo:contract x num
 * @nudo:contract y num
 * @nudo:contract return ge3`;

describe("NaN 守卫为补集提供非 NaN 证据（issue #185 残余）", () => {
  it("Number.isNaN(x/y) 早退守卫 ⇒ fall-through 挂 ne(x, NaN)", () => {
    expect(
      issuesOf(
        " if (Number.isNaN(x)) return 3; if (Number.isNaN(y)) return 3; if (x < 1) return 3; if (y < 2) return 3; return x + y;",
        C_NUM_2,
      ),
    ).toEqual([]);
  });

  it("x !== x 自比较守卫同样可用", () => {
    expect(
      issuesOf(
        " if (x !== x) return 3; if (y !== y) return 3; if (x < 1) return 3; if (y < 2) return 3; return x + y;",
        C_NUM_2,
      ),
    ).toEqual([]);
  });

  it("内联 !Number.isNaN(x) / x === x 真臂同样可用", () => {
    const c = ` * @nudo:contract x num
 * @nudo:contract return nonNeg`;
    expect(
      issues1(" if (!Number.isNaN(x)) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
    expect(
      issues1(" if (x === x) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
  });

  it("boolean 变量形态：const ok = Number.isNaN(x); if (!ok) 携带事实", () => {
    const c = ` * @nudo:contract x num
 * @nudo:contract return nonNeg`;
    expect(
      issues1(" const ok = Number.isNaN(x); if (!ok) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
    expect(
      issues1(" const ok = !Number.isNaN(x); if (ok) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
  });

  it("boolean 变量形态：if (ok) 是 NaN 臂，不产生非 NaN 事实", () => {
    const c = ` * @nudo:contract x num
 * @nudo:contract return nonNeg`;
    // ok 为真 ⇒ x 就是 NaN；补集事实只对「非 NaN 臂」成立 ⇒ 保持可证伪。
    expect(
      issues1(" const ok = Number.isNaN(x); if (ok) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual(["error:nudo:constraint-violated"]);
  });

  it("Number.isFinite 单边事实：真臂可用、取反不可用", () => {
    const c = ` * @nudo:contract x num
 * @nudo:contract return nonNeg`;
    expect(
      issues1(" if (Number.isFinite(x)) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
    expect(
      issues1(" if (!Number.isFinite(x)) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual(["error:nudo:constraint-violated"]);
    expect(
      issues1(" const ok = Number.isFinite(x); if (ok) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual([]);
    expect(
      issues1(" const ok = Number.isFinite(x); if (!ok) { if (x < 0) return 0; return x; } return 0;", c),
    ).toEqual(["error:nudo:constraint-violated"]);
  });
});

describe("$refineNotNaN / Φ 证据（运行时）", () => {
  const t = termVar("x");
  const plainNum = abs({ k: "prim", type: "number" }, t, undefined, "exact");

  it("$refineNotNaN 挂 ne(x, NaN) 且保留其它 pred", () => {
    const out = $refineNotNaN(plainNum);
    expect(implies(out.pred!, ne(t, lit(NaN)))).toBe(true);
    expect(isNonNaN(out, pTrue)).toBe(true);
    const bounded = abs({ k: "prim", type: "number" }, t, ge(t, lit(0)), "exact");
    const both = $refineNotNaN(bounded);
    expect(implies(both.pred!, ge(t, lit(0)))).toBe(true);
    expect(implies(both.pred!, ne(t, lit(NaN)))).toBe(true);
  });

  it("字面量接收者原样返回", () => {
    const litNum = abs({ k: "prim", type: "number" }, lit(0), undefined, "exact");
    expect($refineNotNaN(litNum)).toBe(litNum);
  });

  it("Φ 中的自等事实 x === x 让补集生效（不依赖绑定 pred）", () => {
    const narrowed = withExecPhi(eq(t, t), () => $refineRelComplement(plainNum, "lt", 1));
    expect(implies(narrowed.pred!, ge(t, lit(1)))).toBe(true);
  });
});

describe("NaN 守卫的遮蔽门禁（soundness）", () => {
  it("Number 未被遮蔽 ⇒ Number.isNaN(x) 发射 $refineNotNaN", () => {
    const out = transpileSource(
      "function f(x){ if (Number.isNaN(x)) return 0; return x; }",
    );
    // 转译头部的 `import { … $refineNotNaN … }` 恒在；断言**调用点**。
    expect(out).toContain("$refineNotNaN(x)");
  });

  it("用户遮蔽 Number（形参/声明）⇒ 不产出一个 ne(x, NaN) 事实", () => {
    const viaParam = transpileSource(
      "function f(Number, x){ if (Number.isNaN(x)) return 0; return x; }",
    );
    expect(viaParam).not.toContain("$refineNotNaN(x)");
    const viaDecl = transpileSource(
      "function f(x){ const Number = { isNaN: () => false }; if (Number.isNaN(x)) return 0; return x; }",
    );
    expect(viaDecl).not.toContain("$refineNotNaN(x)");
  });

  it("别名只对未改写的被守卫变量生效（x 被写 ⇒ 不登记）", () => {
    const reassigned = transpileSource(
      "function f(x){ const ok = Number.isNaN(x); x = 1; if (!ok) { if (x < 0) return 0; return x; } return 0; }",
    );
    expect(reassigned).not.toContain("$refineNotNaN(x)");
  });

  it("同名 let 重声明删除别名（作用域遮蔽）", () => {
    const shadowed = transpileSource(
      "function f(x){ const ok = Number.isNaN(x); { let ok = true; if (!ok) { if (x < 0) return 0; return x; } } return 0; }",
    );
    expect(shadowed).not.toContain("$refineNotNaN(x)");
  });
});
