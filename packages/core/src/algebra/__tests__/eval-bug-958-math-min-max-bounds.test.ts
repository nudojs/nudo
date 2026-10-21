/**
 * Bug 958 回归：Math.min / Math.max 的**区间端点合并**按合取/析取分家。
 *
 * ES 语义（node 实测）：
 * - `Math.min(a,b) ≥ L ⟺ a ≥ L ∧ b ≥ L`（**合取**）⇒ 端点值相同时只能取
 *   **更松**（非 strict）的一侧：`a > 0 ∧ b ≥ 0` 时 `min(a,b)` 可能恰为 0
 *   （b = 0）⇒ 只能推出 `min(a,b) ≥ 0`。
 * - `Math.max(a,b) ≤ U ⟺ a ≤ U ∧ b ≤ U`（**合取**）⇒ 同款取更松的一侧。
 * - `Math.max(a,b) ≥ L ⟺ a ≥ L ∨ b ≥ L`（**析取**）与
 *   `Math.min(a,b) ≤ U ⟺ a ≤ U ∨ b ≤ U`（**析取**）⇒ 取**更严**的一侧。
 *
 * 修复前：`loMin`（min 的 lo）与 `hiMax`（max 的 hi）照抄了析取位的条件
 * （`b.strict && !a.strict → b`）⇒ 取了**更严**的一侧 ⇒ 端点同值时产出
 * **不可满足**谓词（`min(x,0) > 0 ∧ min(x,0) ≤ 0`）⇒
 *   ① 证明器 ex falso 放电 ⇒ L1 返回契约门禁**假绿**（恒为 0 的函数被判
 *      满足 `number().gt(0)`）；
 *   ② 分支选择把不可满足谓词当恒真 ⇒ 走错臂且 `conf: exact`
 *      （`Math.min(x,0) > 0 ? "pos" : "nonpos"` 折成 `"pos"`，原生恒
 *      `"nonpos"`）。
 *
 * 修法（`builtins/math.ts`）：`loMin` / `hiMax` 的 tie-break 改成取**非
 * strict**（更松）的一侧；`loMax` / `hiMin`（析取位）保持取更严的一侧。
 *
 * 负控制钉住：常量取 1（区间自洽）、字面量折叠路径、round/abs 不走区间
 * 合并、max 的析取位（`Math.max(x,-1) > 0`）语义不变。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { checkSource, pTrue } from "../index.ts";
import { abs } from "../abs.ts";
import { v as termVar, lit as termLit } from "../term.ts";
import { and, gt, lt } from "../pred.ts";
import type { Pred } from "../pred.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 带数值界的实参（x > 0 / x < 0）——驱动 numericBounds 区间路径 */
function numArg(id: string, op: "gt" | "lt", n: number) {
  const t = termVar(id);
  const pred: Pred =
    op === "gt" ? { op: "gt", a: t, b: termLit(n) } : { op: "lt", a: t, b: termLit(n) };
  return abs({ k: "prim", type: "number" }, t, pred, "exact");
}

const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/math-bounds.js",
});

function checkOf(src: string, sidecar: string) {
  return checkSource("/t/math-bounds.js", src, pTrue, sidecarOpts(sidecar));
}

describe("Bug 958 — Math.min / Math.max 区间端点合并（合取位取更松的一侧）", () => {
  it("Math.min(x,0) > 0：x>0 时原生恒 \"nonpos\"（改前折 \"pos\" 且 conf: exact）", () => {
    const r = call(
      `export function f(x) { return Math.min(x, 0) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "nonpos" });
  });

  it("Math.max(x,0) < 0：x<0 时原生恒 \"nonneg\"（改前折 \"neg\"）", () => {
    const r = call(
      `export function f(x) { return Math.max(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "nonneg" });
  });

  it("Math.min(x,0) < 0：x>0 时原生恒 \"nonneg\"（区间下界不再是 > 0 的矛盾谓词）", () => {
    const r = call(
      `export function f(x) { return Math.min(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "nonneg" });
  });

  it("Math.max(x,0) > 0：x<0 时原生恒 \"nonpos\"（区间上界不再是 < 0 的矛盾谓词）", () => {
    const r = call(
      `export function f(x) { return Math.max(x, 0) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "nonpos" });
  });

  it("L1 返回契约门禁：Math.min(x,0)（x>0）恒为 0 ⇒ 违反 number().gt(0)（改前假绿 OK）", () => {
    const r = checkOf(
      `export function branch(x) { return Math.min(x, 0); }`,
      `import { fn, number } from "@nudojs/core";
export const branch = fn({ x: number().gt(0) }, number().gt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });

  it("L1 返回契约门禁：Math.max(x,0)（x<0）恒为 0 ⇒ 违反 number().lt(0)（改前假绿 OK）", () => {
    const r = checkOf(
      `export function branchMax(x) { return Math.max(x, 0); }`,
      `import { fn, number } from "@nudojs/core";
export const branchMax = fn({ x: number().lt(0) }, number().lt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });

  it("L1 返回契约门禁：Math.min(x,1)（x>0）值域 (0,1] ⇒ 满足 number().gt(0)（不误报红）", () => {
    const r = checkOf(
      `export function branchOne(x) { return Math.min(x, 1); }`,
      `import { fn, number } from "@nudojs/core";
export const branchOne = fn({ x: number().gt(0) }, number().gt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(0);
  });

  it("自洽性守卫：合并区间为空时不发互斥事实（不得让矛盾 pred 触发 ex falso 放电）", () => {
    // 操作数自身区间不相容（x > 5 ∧ x < 3）⇒ Math.min(x,10) 的合并区间
    // [5,3) 为空 ⇒ 两条端点事实互斥 ⇒ 不得合成为不可满足 pred。
    const t = termVar("x");
    const bad = abs(
      { k: "prim", type: "number" },
      t,
      and(gt(t, termLit(5)), lt(t, termLit(3))),
      "exact",
    );
    const r = call(
      `export function f(x) { return Math.min(x, 10) > 100 ? "big" : "small"; }`,
      "f",
      [bad],
    );
    // ex falso 会把矛盾的 `> 5 ∧ < 3` 当恒真 ⇒ 折成 "big"（错的确定值）
    expect(litValue(r.result)).not.toEqual({ ok: true, value: "big" });
    expect(litValue(r.result)).toEqual({ ok: false });
  });
});

describe("Bug 958 — 负控制（区间合并的邻近形态不回归）", () => {
  it("Math.min(x,1) > 0：x>0 时原生恒 \"pos\"", () => {
    const r = call(
      `export function f(x) { return Math.min(x, 1) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "pos" });
  });

  it("Math.max(x,-1) > 0：x>0 时原生恒 \"pos\"（max 的析取位语义不变）", () => {
    const r = call(
      `export function f(x) { return Math.max(x, -1) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "pos" });
  });

  it("Math.max(x,0) < 0：x<0 时原生恒 \"nonneg\"（与 min 臂对称）", () => {
    const r = call(
      `export function f(x) { return Math.max(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "nonneg" });
  });

  it("字面量折叠路径不变：Math.min(3,5)=3 / Math.max(3,5)=5", () => {
    expect(v(`export function f() { return Math.min(3, 5); }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { return Math.max(3, 5); }`)).toEqual({ ok: true, value: 5 });
  });

  it("round / abs 不走区间合并路径，结果不变", () => {
    expect(v(`export function f() { return Math.abs(-3); }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { return Math.round(2.4); }`)).toEqual({ ok: true, value: 2 });
  });
});
