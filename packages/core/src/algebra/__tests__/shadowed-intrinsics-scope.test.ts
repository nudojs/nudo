/**
 * 宿主内建名的**遮蔽作用域**（undefined / NaN / Infinity / Number）。
 *
 * 遮蔽集是「本作用域链可见的绑定」，不是「整棵子树里出现过的名字」：
 * - 兄弟函数的形参 / 局部名不得关掉本函数的 `Number.isFinite` 守卫事实
 *   （过保守 ⇒ 守卫事实丢失 ⇒ 合法代码判 `nudo:constraint-violated`）；
 * - 本函数的形参 / 体内局部名必须照常遮蔽（否则 `NaN + 1` 会被当内建折叠）；
 * - 模块级绑定遮蔽整个模块（模块作用域对每个函数都可见）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { transpileSource } from "../exec/index.ts";

const SIDECAR = `
export const ge1 = number().ge(1);
export const num = number();
`;

const FILE = "/t/shadow-scope.js";
const opts = sidecarOpts("shadow-scope.nudo", SIDECAR, FILE);

const CONTRACTS = ` * @nudo:contract x num
 * @nudo:contract return ge1`;

/** `b` 的返回值在 `Number.isFinite(x)` 守卫下恒 ≥ 1（NaN / ±Infinity 走 `return 2`）。 */
const B_BODY = " if (Number.isFinite(x)) { if (x < 1) return 2; return x; } return 2;";

function srcOf(prefix: string, body = B_BODY): string {
  return `/// @nudo:import { ge1, num } from "./shadow-scope.nudo.js"
${prefix}
/**
${CONTRACTS}
 */
export function b(x) {${body}}
`;
}

function violationsOf(source: string): string[] {
  return checkSource(FILE, source, pTrue, opts).issues
    .filter((i) => i.code === "nudo:constraint-violated")
    .map((i) => `${i.severity}:${i.fn ?? ""}`);
}

describe("宿主内建遮蔽集按作用域计算", () => {
  it("兄弟函数的 Number 形参不再关掉本函数的 isFinite 守卫", () => {
    expect(violationsOf(srcOf("export function shadower(Number) { return Number; }"))).toEqual([]);
  });

  it("兄弟函数体内的 const Number 同理", () => {
    expect(
      violationsOf(srcOf("export function shadower() { const Number = { isFinite: () => false }; return Number; }")),
    ).toEqual([]);
  });

  it("兄弟函数的解构形参 { Number } 同理", () => {
    expect(violationsOf(srcOf("export function shadower({ Number }) { return Number; }"))).toEqual([]);
  });

  it("对照：本函数体内的 const Number 仍是遮蔽（不出 NaN 收窄）", () => {
    // 同一函数体内 `const Number = …` 是**本作用域**绑定 ⇒ 不得把
    // `Number.isNaN(x)` 当内建守卫收窄（旧口径已如此，此处防回归）
    const code = transpileSource(
      "export function f(x) {\n  const Number = { isNaN: () => false };\n  if (Number.isNaN(x)) return 1;\n  return x;\n}\n",
    );
    expect(code).not.toContain("$refineNotNaN(x)");
  });

  it("模块级 const Number 遮蔽整个模块（每个函数都看得见）", () => {
    expect(
      violationsOf(srcOf("const Number = { isFinite: () => true };")),
    ).toEqual(["error:b"]);
  });

  it("本函数的形参遮蔽仍按 $absVal 发射（不得折成内建字面量）", () => {
    const code = transpileSource("export function f(NaN) {\n  return NaN + 1;\n}\n");
    expect(code).toContain("$absVal(NaN)");
  });

  it("函数形参不改变模块级 NaN 的折叠（作用域互相独立）", () => {
    const code = transpileSource("export function g(NaN) {\n  return 1;\n}\nexport const h = NaN;\n");
    // 形参绑定按遮蔽发射（prologue 一行）；模块级 `NaN` 仍是内建字面量
    expect(code.match(/\$absVal\(NaN\)/g) ?? []).toHaveLength(1);
    expect(code).toContain("export let h = $lit(0/0);");
  });
});
