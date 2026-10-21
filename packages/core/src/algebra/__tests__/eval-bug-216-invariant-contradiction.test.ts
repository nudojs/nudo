/**
 * Bug 216（族 02 / tmp/bugs/02-core-exec-runtime.md）：@nudo:invariant 把
 * **矛盾谓词**烘进 Abs ⇒ **ex falso**：真正的契约违例被判为「已证明」，
 * 门禁**绿灯**（假绿）。
 *
 * 根因：invariant-apply.ts 的 strengthenLeaf 把叶子既有 pred 与公理界
 * **直接 AND**（`and(a.pred, rel)`），不检查二者是否相容。叶子已带与公理
 * 冲突的界（侧车参数契约给的 `le(n,-5)` + 公理 `ge(n,0)`）时，结果是矛盾
 * 谓词 `n ≤ -5 ∧ n ≥ 0`；证明器对矛盾 pred 能对任意约束放电 ⇒ 整个返回
 * 契约「证得」⇒ 一条真正该红的门禁变绿。lit 叶子守卫本就为防这个而加，
 * 但它只覆盖「值是字面量」的叶子——带数值 pred 的参数 / 局部变量照样穿过。
 *
 * 修法：strengthenLeaf 在 AND 之前做**相容性检查**（证明器双向试判
 * `pred ⊨ ¬rel` / `rel ⊨ ¬pred`）：可证矛盾 ⇒ **不得**把公理烘进 Abs
 * （保持叶子原 pred，该不变式不参与本次证明）——公理与观测冲突时引擎站
 * 在观测一侧（少一条公理证据 ≠ 多一条假证据）。
 *
 * 全部相对路径导入（单一模块实例）：会话槽（state.ts 模块级 let）跨实例
 * 不可见（#152 教训）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withInvariantSpecs } from "../exec/runtime/state.ts";
import { applyInvariantsToPack } from "../exec/runtime/invariant-apply.ts";
import { abs, num } from "../abs.ts";
import { lit, v } from "../term.ts";
import { ge, le, predToString } from "../pred.ts";
import type { Abs } from "../../abs.ts";

const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/invariant.js",
});

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/invariant.js", src, pTrue, opts);
}

/** 循环携带 `last` = 侧车参数 `n`（pred 来自参数契约） */
const BODY = `
  let last = 0;
  for (let j = 0; j < 3; j++) last = n;
  return last;
`;

const srcOf = (directive: string | null): string => `
${directive ? `/**\n * ${directive}\n */` : ""}
export function f(n) {${BODY}}
`;

const SIDECAR_CONFLICT = `export const f = fn({ n: number().le(-5) }, number().ge(0).le(1));`;

describe("Bug 216：矛盾公理不得烘进 Abs（ex falso 假绿）", () => {
  it("矛盾公理（last >= 0 vs 参数契约 n ≤ -5）：门禁红（constraint-violated），不得判绿", () => {
    const r = checkOf(srcOf("@nudo:invariant last >= 0"), sidecarOpts(SIDECAR_CONFLICT));
    // 假绿回归钉：改前此处只有 nudo:invariant-relied info、门禁 exit=0
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(1);
    const err = r.issues.find((i) => i.severity === "error");
    expect(err!.code).toBe("nudo:constraint-violated");
  });

  it("签名面：矛盾合取不得出现在返回值的 pred 上（n ≤ -5 ∧ n ≥ 0 是 ex falso 指纹）", () => {
    const r = checkOf(srcOf("@nudo:invariant last >= 0"), sidecarOpts(SIDECAR_CONFLICT));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("n ≤ -5");
    expect(sig!.display).not.toContain("n ≥ 0");
  });

  it("对照（无公理）：同样的红（公理被拒后行为与「没写公理」同口径）", () => {
    const r = checkOf(srcOf(null), sidecarOpts(SIDECAR_CONFLICT));
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(1);
    expect(r.issues.find((i) => i.severity === "error")!.code).toBe(
      "nudo:constraint-violated",
    );
    expect(r.issues.some((i) => i.code.startsWith("nudo:invariant"))).toBe(false);
  });

  it("非矛盾公理照常实施（负控制：不得把公理一律丢掉）", () => {
    const r = checkOf(
      srcOf("@nudo:invariant last >= 0"),
      sidecarOpts(`export const f = fn({ n: number() }, number().ge(0));`),
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(true);
  });
});

describe("Bug 216 单元：strengthenLeaf 的相容性检查", () => {
  const packOf = (leaf: Abs): Abs =>
    abs({ k: "obj", slots: { last: { value: leaf } } }, undefined, undefined, "path");

  it("矛盾叶子（le(n,-5) + 公理 ge 0）：pred 保持原样，不得并入 ≥ 0", () => {
    const leaf = abs(num().shape, v("n"), le(v("n"), lit(-5)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "ge", value: 0 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs }> }).slots.last!.value;
    expect(out.pred).toBe(leaf.pred);
    expect(predToString(out.pred!)).not.toContain("≥ 0");
  });

  it("相容叶子（ge(n,1) + 公理 le 10）：两个界都在（不得误拒）", () => {
    const leaf = abs(num().shape, v("n"), ge(v("n"), lit(1)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "le", value: 10 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs }> }).slots.last!.value;
    const s = predToString(out.pred!);
    expect(s).toContain("≥ 1");
    expect(s).toContain("≤ 10");
  });

  it("反向矛盾（ge(n,0) + 公理 le -5）：同样被拒", () => {
    const leaf = abs(num().shape, v("n"), ge(v("n"), lit(0)), "path");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "le", value: -5 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs }> }).slots.last!.value;
    expect(out.pred).toBe(leaf.pred);
    expect(predToString(out.pred!)).not.toContain("≤ -5");
  });

  it("字面量叶子不改写（既有守卫仍在）：具体值自带真值", () => {
    const leaf = abs(num().shape, lit(-1), undefined, "exact");
    const r = withInvariantSpecs(
      [{ name: "last", path: [], rel: "ge", value: 0 }],
      () => applyInvariantsToPack(packOf(leaf)),
    );
    const out = (r.shape as { slots: Record<string, { value: Abs }> }).slots.last!.value;
    expect(out).toBe(leaf);
    expect(out.pred).toBeUndefined();
  });
});
