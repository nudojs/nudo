/**
 * issue #170：normalised-similarity 推导链的三段补齐。
 *
 * 背景：`@nudo:assume d <= max` 下 `1 - d/max ∈ [0,1]` 的证明缺三步——
 * ① `$eq`/`$ne` 不可判定时落裸 bool()，`max === 0` 守卫分支收不到
 *   eq/ne 路径事实（假臂 Φ 无 ne(max,0)）；
 * ② numericBounds 不折 `ne(x,n) ∧ x≥n ⇒ x>n`（分母正性供不出，
 *   divAssumeBounds 的 posDen 需要严格下界）；
 * ③ `d = cond ? 0 : Math.max(...)` 的 fork 合并 sum 无根 term——引理
 *   项不匹配 + 字面量 0 臂无界污染 join。
 *
 * 修法：① cmp("eq"/"ne") 符号面（ops.ts $eq/$ne）；② numericBounds
 * 端点等值排除收紧（arithmetic.ts collectExclusions*）；③ $assumeAnchor
 * 成员级 α-改名（ops.ts）+ `0 / x`（x 可证非零）字面量折叠（div）。
 *
 * 对照组：无 assume ⇒ unproven-return 诚实上报；错误方向前提
 * （max <= d）⇒ 不经 assume 证得（constraint-violated / unproven）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs, num } from "../abs.ts";
import { v, lit } from "../term.ts";
import { and, le, ge, ne, pTrue as truePhi } from "../pred.ts";
import { div, numericBounds } from "../arithmetic.ts";

// —— 单元：numericBounds 端点等值排除（②） ————————————————

const dAbs = abs(num().shape, v("d"), ge(v("d"), lit(0)), "path");
const maxGe0 = abs(num().shape, v("max"), ge(v("max"), lit(0)), "path");

describe("#170 numericBounds ne 端点收紧", () => {
  it("ne(max,0) 在 Φ、ge(max,0) 在自身 pred ⇒ lo 严格", () => {
    const b = numericBounds(maxGe0, and(ne(v("max"), lit(0))));
    expect(b?.lo).toEqual({ value: 0, strict: true });
    expect(b?.hi).toBeUndefined();
  });
  it("ne 在自身 pred、ge 在 Φ（来源交叉）⇒ 同折", () => {
    const a = abs(num().shape, v("x"), ne(v("x"), lit(0)), "path");
    const b = numericBounds(a, and(ge(v("x"), lit(0))));
    expect(b?.lo).toEqual({ value: 0, strict: true });
  });
  it("端点不同值不折（区间减点不可表示）", () => {
    const b = numericBounds(maxGe0, and(ne(v("max"), lit(1))));
    expect(b?.lo).toEqual({ value: 0, strict: false });
  });
  it("上端点对偶：ne(max,1) ∧ le(max,1) ⇒ hi 严格", () => {
    const capped = abs(num().shape, v("m"), le(v("m"), lit(1)), "path");
    const b = numericBounds(capped, and(ne(v("m"), lit(1))));
    expect(b?.hi).toEqual({ value: 1, strict: true });
  });
  it("无 ne 事实（对照）⇒ 非严格保持", () => {
    const b = numericBounds(maxGe0, truePhi);
    expect(b?.lo).toEqual({ value: 0, strict: false });
  });
});

// —— 单元：div 假臂折叠（①+②+引理合力） ————————————————

describe("#170 div 假臂分母正性", () => {
  const leDMax = and(le(v("d"), v("max")));
  it("ne(max,0) ∧ ge ⇒ posDen ⇒ d/max ∈ [0,1]", () => {
    const r = div(dAbs, maxGe0, and(ne(v("max"), lit(0))), leDMax);
    const b = numericBounds(r, truePhi);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });
  it("0 / x（x 可证非零）⇒ 字面量 0", () => {
    const r = div(lit0(), maxGe0, and(ne(v("max"), lit(0))), undefined);
    expect(r.term).toEqual({ op: "lit", value: 0 });
  });
  it("0 / x（x 可能为 0，对照）⇒ 不折字面量", () => {
    const r = div(lit0(), maxGe0, truePhi, undefined);
    expect(r.term?.op).not.toBe("lit");
  });
});

function lit0() {
  return abs(num().shape, { op: "lit", value: 0 }, undefined, "exact");
}

// —— 端到端：similarity 形态（③ sum 锚定 + 全链） ——————————

const sidecar = `export const sim = fn({ a: string(), b: string() }, number().ge(0).le(1));`;
const opts = {
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/sim170.js",
};

const callee = `export function dist(a, b) { return a === b ? 0 : Math.max(a.length, b.length); }`;
const simBody = `
/**
 * @nudo:assume d <= max
 */
export function sim(a, b) {
  const d = dist(a, b);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - d / max;
}`;

describe("#170 similarity 端到端", () => {
  it("inline Math.max(a.length, b.length)：证得 + assume-relied", () => {
    const r = checkSource("/t/sim170.js", `${callee}\n${simBody}`, pTrue, opts);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.message).toContain("d <= max");
  });

  it("无 assume（对照）：unproven-return 诚实上报", () => {
    const noAssume = simBody.replace(" * @nudo:assume d <= max\n", "");
    const r = checkSource("/t/sim170.js", `${callee}\n${noAssume}`, pTrue, opts);
    const unproven = r.issues.find(
      (i) => i.code === "nudo:unproven-return" && i.fn === "sim",
    );
    expect(unproven).toBeDefined();
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });

  it("错误方向前提 max <= d（健全性对照）：不得经 assume 证得", () => {
    const wrong = simBody.replace("@nudo:assume d <= max", "@nudo:assume max <= d");
    const r = checkSource("/t/sim170.js", `${callee}\n${wrong}`, pTrue, opts);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied" && i.fn === "sim")).toBe(false);
  });

  it("if 守卫同折（`if (max === 0) return 1;` 形态）", () => {
    const r = checkSource(
      "/t/sim170.js",
      `${callee}
/**
 * @nudo:assume d <= max
 */
export function sim(a, b) {
  const d = dist(a, b);
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - d / max;
}`,
      pTrue,
      opts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied" && i.fn === "sim")).toBe(true);
  });
});
