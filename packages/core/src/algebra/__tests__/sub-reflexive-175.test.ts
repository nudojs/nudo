/**
 * issue #175：同一函数体内「字面相同的纯子表达式」双次求值无相等事实，
 * `max - d` 证不出 ge(0)。
 *
 * 根因：`const d = a===b ? 0 : Math.max(a.length,b.length)` 与
 * `const max = Math.max(a.length,b.length)` 是两次独立求值——len#N 按
 * Abs 对象身份唯一铸造，双次 `Math.max(a.length, b.length)` 结构同项，
 * 但 sub 只有区间算术（无界减无界 ⇒ 无 facts），distributeSumBinOp 把
 * d 的 sum 逐臂分发后 arm 级 sub(max, maxArm) 两操作数结构完全相同也无
 * 相等事实可用。
 *
 * 修法（窄修复，全部在算术层）：
 * ① sub 自反折叠：同一 Abs 对象 或 结构相等 ∧ isDeterministicTerm
 *   （term.ts 新增：len#N 唯一铸造 + 确定性宿主白名单）⇒ x-x = 0；
 *   NaN 检查不过 ⇒ 真值域 {NaN, 0}（minMaxAbs NaN 臂同款）。
 * ② subAssumeBounds（镜像 divAssumeBounds）：le(b,a) 前提 ⇒ a-b ≥ 0；
 *   le(a,b) 前提 ⇒ a-b ≤ 0。
 * ③ $sub 线程 currentAssumePremises()（镜像 $div）。
 *
 * 对照组：结构不等（len 集不同）不折；adoption 重锚的 get 项（非确定性）
 * 不折——结构相等不等于值相等，soundness 门必须挡住跨值同名碰撞。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { abs, num, type Abs } from "../abs.ts";
import { app, v, lit, isDeterministicTerm } from "../term.ts";
import { and, le, ge } from "../pred.ts";
import { sub } from "../arithmetic.ts";

// —— 单元：isDeterministicTerm（soundness 门） ————————————

describe("#175 isDeterministicTerm", () => {
  it("lit 与 len#N var 接受（len 按 Abs 身份唯一铸造）", () => {
    expect(isDeterministicTerm(lit(0))).toBe(true);
    expect(isDeterministicTerm(v("len#0"))).toBe(true);
    expect(isDeterministicTerm(v("len#12"))).toBe(true);
  });
  it("非 len var 拒绝（形参 α / assume 锚名 / 杂名）", () => {
    expect(isDeterministicTerm(v("d"))).toBe(false);
    expect(isDeterministicTerm(v("x"))).toBe(false);
    expect(isDeterministicTerm(v("len"))).toBe(false);
    expect(isDeterministicTerm(v("len#x"))).toBe(false);
    expect(isDeterministicTerm(v("len#0a"))).toBe(false);
  });
  it("确定性宿主 app 接受（含嵌套与算术）", () => {
    expect(isDeterministicTerm(app("Math.max", [v("len#0"), v("len#1")]))).toBe(true);
    expect(
      isDeterministicTerm(
        app("Math.min", [app("Math.abs", [v("len#0")]), lit(1)]),
      ),
    ).toBe(true);
    expect(isDeterministicTerm(app("+", [v("len#0"), lit(2)]))).toBe(true);
    expect(isDeterministicTerm(app("-", [v("len#0"), v("len#1")]))).toBe(true);
  });
  it("get 成员读拒绝（接收者 var 可能是 adoption 锚）", () => {
    expect(isDeterministicTerm(app("get", [v("len#0"), lit("v")]))).toBe(false);
    expect(isDeterministicTerm(app("get", [v("o"), lit("v")]))).toBe(false);
  });
  it("arg 占位 / Math.random / 未列宿主拒绝", () => {
    // minMaxAbs 的 `arg${i}` 占位：实参无 term 时按调用铸造，两次调用同结构碰撞
    expect(isDeterministicTerm(app("Math.max", [app("arg0", []), app("arg1", [])]))).toBe(false);
    expect(isDeterministicTerm(app("Math.random", []))).toBe(false);
    expect(isDeterministicTerm(app("Math.pow", [v("len#0"), lit(2)]))).toBe(false);
  });
});

// —— 单元：sub 自反折叠 ——————————————————————————————

describe("#175 sub 自反折叠（单元）", () => {
  it("结构相等确定性项 ∧ isNonNaN（ge pred）⇒ 字面量 0", () => {
    const t = app("Math.max", [v("len#0"), v("len#1")]);
    const m1 = abs(num().shape, t, ge(t, lit(0)), "path");
    const m2 = abs(num().shape, t, ge(t, lit(0)), "path");
    const r = sub(m1, m2, pTrue);
    expect(r.term).toEqual({ op: "lit", value: 0 });
  });
  it("结构相等确定性项 may-NaN ⇒ 真值域 {NaN, 0}（NaN-NaN=NaN）", () => {
    const t = app("Math.max", [v("len#0"), v("len#1")]);
    const m1 = abs(num().shape, t, undefined, "path");
    const m2 = abs(num().shape, t, undefined, "path");
    const r = sub(m1, m2, pTrue);
    expect(r.shape.k).toBe("sum");
    const members = (r.shape as { k: "sum"; members: Abs[] }).members;
    const lits = members.map((m) => m.term);
    expect(lits).toContainEqual({ op: "lit", value: NaN });
    expect(lits).toContainEqual({ op: "lit", value: 0 });
    expect(members.length).toBe(2);
  });
  it("同对象但非确定性项不折（adoption 面共享对象 ≠ 同值，soundness）", () => {
    // #123 adoption 把多个无信息实参重锚到同一 callee 形参面——同一 Abs
    // 对象流进两个实参位，具体值无关联，对象同一性不是值同一性
    const face = abs(num().shape, app("get", [v("o"), lit("v")]), undefined, "path");
    const r = sub(face, face, pTrue);
    expect(r.term?.op).not.toBe("lit");
    expect(r.shape.k).not.toBe("sum");
  });
  it("结构相等非确定性项（裸 var 名碰撞）不折（soundness）", () => {
    const x1 = abs(num().shape, v("d"), undefined, "path");
    const x2 = abs(num().shape, v("d"), undefined, "path");
    const r = sub(x1, x2, pTrue);
    expect(r.term?.op).not.toBe("lit");
    expect(r.shape.k).not.toBe("sum");
  });
});

// —— 单元：subAssumeBounds（assume 引理减法界） ————————————

describe("#175 subAssumeBounds（单元）", () => {
  const aT = v("max");
  const bT = v("d");
  const A = abs(num().shape, aT, undefined, "path");
  const B = abs(num().shape, bT, undefined, "path");

  it("le(b,a) 前提（d <= max）⇒ max-d ≥ 0", () => {
    const r = sub(A, B, pTrue, and(le(bT, aT)));
    expect(r.pred).toEqual(ge(app("-", [aT, bT]), lit(0)));
  });
  it("le(a,b) 前提（max <= d）⇒ max-d ≤ 0", () => {
    const r = sub(A, B, pTrue, and(le(aT, bT)));
    expect(r.pred).toEqual(le(app("-", [aT, bT]), lit(0)));
  });
  it("前提不匹配 / 无前提 ⇒ 无 assume 界（保守回退）", () => {
    const r1 = sub(A, B, pTrue, and(le(v("z"), aT)));
    expect(r1.pred).toBeUndefined();
    const r2 = sub(A, B, pTrue);
    expect(r2.pred).toBeUndefined();
  });
});

// —— 端到端：issue #175 形态 ——————————————————————————

const sidecar = `export const sim = fn({ a: string(), b: string() }, number().ge(0));`;
const opts = {
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/sub175.js",
};

/** issue #175 原样复现：ternary d + 独立 max，返回 max - d */
const repro = (assumeSeg: string) => `
/**
${assumeSeg}
 */
export function sim(a, b) {
  const d = a === b ? 0 : Math.max(a.length, b.length);
  const max = Math.max(a.length, b.length);
  return max - d;
}`;

describe("#175 端到端（自反折叠）", () => {
  it("原样复现（无 assume）：自反折叠 ⇒ 无 unproven-return", () => {
    const r = checkSource("/t/sub175.js", repro(""), pTrue, opts);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });

  it("同形态 + @nudo:assume d <= max：证得 + assume-relied（此前连 assume 都救不了）", () => {
    const r = checkSource("/t/sub175.js", repro(" * @nudo:assume d <= max"), pTrue, opts);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.message).toContain("d <= max");
  });

  it("无 fork 版（双份独立 Math.max 绑定）：m2 - m1 证得", () => {
    const r = checkSource(
      "/t/sub175.js",
      `export function sim(a, b) {
  const m1 = Math.max(a.length, b.length);
  const m2 = Math.max(a.length, b.length);
  return m2 - m1;
}`,
      pTrue,
      opts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(false);
  });

  it("负对照（结构不等不折）：m2 - Math.max(a.length, a.length) 仍 unproven", () => {
    const r = checkSource(
      "/t/sub175.js",
      `export function sim(a, b) {
  const m2 = Math.max(a.length, b.length);
  return m2 - Math.max(a.length, a.length);
}`,
      pTrue,
      opts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(true);
  });
});

// —— 端到端：adoption 同名碰撞不折（soundness） ———————————

describe("#175 adoption 碰撞不折（soundness）", () => {
  // grab 带参数契约 + f 实参 any（info-free）⇒ #123 contract-face adoption
  // 把 p/q 重锚为 grab 形参面 var("o")：x/y 的 get(var("o"), "v") 项结构
  // 完全相同但值无关联（y-x 可为任意数）——自反折叠必须被 isDeterministicTerm
  // 挡住（get 不在白名单），不得折出假 0。
  const negSidecar = `export const grab = fn({ o: shape({ v: number() }) });
export const f = fn({ p: any(), q: any() }, number().ge(0));`;
  const negOpts = {
    loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? negSidecar : undefined),
    fromFile: "/t/sub175neg.js",
  };

  it("adoption 重锚的 get 项结构相等但不折：仍 unproven-return", () => {
    const r = checkSource(
      "/t/sub175neg.js",
      `export function grab(o) { return o.v; }
export function f(p, q) {
  const x = grab(p);
  const y = grab(q);
  return y - x;
}`,
      pTrue,
      negOpts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "f")).toBe(true);
    // 不得出现 exact 0 假折叠：证得即假证明
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });
});
