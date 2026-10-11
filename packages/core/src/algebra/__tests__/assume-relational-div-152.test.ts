/**
 * issue #152：`@nudo:assume d <= max` 用户引理参与除法关系界折叠。
 * 核心规则：分子分母**同名相关**（le(a,b)）是独立区间传播证不出的——
 * 独立代入 a.hi/b.lo 会得 ±∞；只有引理提供的相关性可折：
 *   le(a,b) ∧ b > 0 ⇒ a/b ≤ 1；le(b,a) ∧ b > 0 ⇒ a/b ≥ 1；
 *   a ≥ 0 ∧ b > 0 ⇒ a/b ≥ 0（负分母镜像翻号）。
 * 下游 sub 折叠消费本界 ⇒ `1 - d/max ∈ [0,1]` 返回契约可证。
 *
 * 全部相对路径导入（单一模块实例）：vitest 的 @nudojs/core alias 与相对
 * 导入是两个实例——会话槽（state.ts 模块级 let）跨实例不可见，混合
 * 指定符会让 assume 槽设在 A 实例而 $div 读 B 实例（pTrue）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { withAssumePremises } from "../exec/runtime/state.ts";
import { abs, num } from "../abs.ts";
import { v, lit } from "../term.ts";
import { and, le, ge, pTrue } from "../pred.ts";
import { div, numericBounds } from "../arithmetic.ts";
import { makeSum } from "../objects.ts";
import { formatAbs } from "../format.ts";
import type { Abs } from "../abs.ts";

// 入口参数 Abs：契约口径锚 termVar(paramName)，pred 挂自身 term
const dAbs = abs(num().shape, v("d"), ge(v("d"), lit(0)), "path"); // d ≥ 0
const dFree = abs(num().shape, v("d"), undefined, "path"); // d 无符号知识
const maxAbs = abs(num().shape, v("max"), ge(v("max"), lit(1)), "path"); // max ≥ 1
const maxFree = abs(num().shape, v("max"), undefined, "path");
const maxGe0 = abs(num().shape, v("max"), ge(v("max"), lit(0)), "path"); // max ≥ 0（非严格）
const mNeg = abs(num().shape, v("m"), le(v("m"), lit(-1)), "path"); // m ≤ -1

const leDMax = and(le(v("d"), v("max"))); // @nudo:assume d <= max

describe("assume relational div: 正分母（单元）", () => {
  it("le(d,max) ∧ max>0 ∧ d≥0 ⇒ d/max ∈ [0,1]", () => {
    const r = div(dAbs, maxAbs, pTrue, leDMax);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
    expect(formatAbs(r)).toContain("≥ 0");
    expect(formatAbs(r)).toContain("≤ 1");
  });

  it("le(max,d)（即 d ≥ max）∧ max>0 ⇒ d/max ≥ 1（lo 收紧）", () => {
    const r = div(dAbs, maxAbs, pTrue, and(le(v("max"), v("d"))));
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 1, strict: false }); // max(关系界1, 分子界0)
    expect(b?.hi).toBeUndefined();
  });

  it("le 双向同时成立（d = max）⇒ d/max ∈ [1,1]", () => {
    const r = div(dAbs, maxAbs, pTrue, and(le(v("d"), v("max")), le(v("max"), v("d"))));
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 1, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });
});

describe("assume relational div: 负分母镜像（单元）", () => {
  it("le(d,m) ∧ m<0 ⇒ d/m ≥ 1（a ≤ b < 0，除负翻号）", () => {
    const r = div(dFree, mNeg, pTrue, and(le(v("d"), v("m"))));
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 1, strict: false });
    expect(b?.hi).toBeUndefined();
  });

  it("le(m,d) ∧ m<0 ∧ d≥0 ⇒ d/m ≤ 0（分子符号界与关系界合取收紧 hi）", () => {
    const r = div(dAbs, mNeg, pTrue, and(le(v("m"), v("d"))));
    const b = numericBounds(r, pTrue);
    expect(b?.hi).toEqual({ value: 0, strict: false }); // min(关系界1, 符号界0)
    expect(b?.lo).toBeUndefined();
  });
});

describe("assume relational div: 无命中保守回退（soundness）", () => {
  it("无 assume ⇒ 行为与现状一致（无界）", () => {
    const r = div(dAbs, maxAbs, pTrue);
    expect(r.pred).toBeUndefined();
    expect(numericBounds(r, pTrue)).toBeUndefined();
  });

  it("引理项与操作数不匹配 ⇒ 不得产生界", () => {
    // rhs 是 limit ≠ max（分母项不匹配）
    const r = div(dAbs, maxAbs, pTrue, and(le(v("d"), v("limit"))));
    expect(r.pred).toBeUndefined();
    // lhs 是 size ≠ d（分子项不匹配）
    const r2 = div(dAbs, maxAbs, pTrue, and(le(v("size"), v("max"))));
    expect(r2.pred).toBeUndefined();
  });

  it("分母无符号知识 ⇒ 无界", () => {
    const r = div(dAbs, maxFree, pTrue, leDMax);
    expect(r.pred).toBeUndefined();
  });

  it("分母非严格 ≥ 0（含 0，n/0=±Inf 界失效）⇒ 无界", () => {
    const r = div(dAbs, maxGe0, pTrue, leDMax);
    expect(r.pred).toBeUndefined();
  });

  it("既有常数分母路径不受 assume 干扰", () => {
    const r = div(dAbs, abs(num().shape, lit(2), undefined, "exact"), pTrue, leDMax);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false }); // d≥0 /2 ⇒ ≥0
    expect(b?.hi).toBeUndefined();
  });
});

describe("assume relational div: sum 操作数（成员级透传）", () => {
  it("分母 sum{m1,m2} 双引理各命中成员 ⇒ 整体 [0,1]", () => {
    const m1 = abs(num().shape, v("m1"), ge(v("m1"), lit(1)), "path");
    const m2 = abs(num().shape, v("m2"), ge(v("m2"), lit(1)), "path");
    const den = makeSum(m1, m2);
    const prem = and(le(v("d"), v("m1")), le(v("d"), v("m2")));
    const r = div(dAbs, den, pTrue, prem);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });

  it("sum 分发成员未命中引理 ⇒ 该成员无界（不误染）", () => {
    const m1 = abs(num().shape, v("m1"), ge(v("m1"), lit(1)), "path");
    const den = makeSum(m1, abs(num().shape, lit(1), undefined, "exact"));
    const r = div(dAbs, den, pTrue, and(le(v("d"), v("m1"))));
    // 成员 d/m1 ∈ [0,1]，成员 d/1 ∈ [0,∞)（引理未覆盖字面量 1 分母）
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toBeUndefined();
  });
});

function callSim(src: string, fn: string, args: Abs[], assumePremises?: ReturnType<typeof and>) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fn, args, assumePremises ? { assumePremises } : undefined)
    .result;
}

describe("assume relational div: 端到端（runTranspiled）", () => {
  it("issue 原型：sim(d,max) = max===0 ? 1 : 1 - d/max 返回 [0,1]", () => {
    const src = `export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}`;
    // 已知限制：三元不 fork（条件 max===0 不可判定 → 双臂求值后 join）；
    // cons 臂字面量 1 ∈ [0,1]，alt 臂成员携带 div 关系界 ⇒ join 后整体
    // numericBounds 仍为 [0,1]（sum 成员界并集）。
    const r = callSim(src, "sim", [dAbs, maxAbs], leDMax);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });

  it("if 形态（主链同证）：守卫分支 join 后仍 [0,1]", () => {
    const src = `export function simIf(d, max) {
  if (max === 0) { return 1; }
  return 1 - d / max;
}`;
    const r = callSim(src, "simIf", [dAbs, maxAbs], leDMax);
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });

  it("纯主链：1 - d/max 直接携带 [0,1] pred", () => {
    const src = `export function simPure(d, max) { return 1 - d / max; }`;
    const r = callSim(src, "simPure", [dAbs, maxAbs], leDMax);
    expect(r.shape).toEqual({ k: "prim", type: "number" });
    expect(formatAbs(r)).toContain("≥ 0");
    expect(formatAbs(r)).toContain("≤ 1");
    const b = numericBounds(r, pTrue);
    expect(b?.lo).toEqual({ value: 0, strict: false });
    expect(b?.hi).toEqual({ value: 1, strict: false });
  });

  it("withAssumePremises 包裹（会话槽直用）同样生效", () => {
    const src = `export function simPure(d, max) { return 1 - d / max; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = withAssumePremises(leDMax, () =>
      callTranspiledExportFull(run, "simPure", [dAbs, maxAbs]).result,
    );
    expect(numericBounds(r, pTrue)?.hi).toEqual({ value: 1, strict: false });
  });

  it("无 assume 种子 ⇒ 无界（现状行为，不因本特性改变）", () => {
    const src = `export function simPure(d, max) { return 1 - d / max; }`;
    const r = callSim(src, "simPure", [dAbs, maxAbs]);
    expect(numericBounds(r, pTrue)).toBeUndefined();
  });

  it("assume 槽作用域隔离：包裹外求值不受引理影响", () => {
    const src = `export function simPure(d, max) { return 1 - d / max; }`;
    // 先在槽内求值一次（证明包裹生效），槽恢复后再求值必须无界
    const run = runTranspiled(src, { mode: "analyze" });
    const inside = withAssumePremises(leDMax, () =>
      callTranspiledExportFull(run, "simPure", [dAbs, maxAbs]).result,
    );
    expect(numericBounds(inside, pTrue)?.hi).toEqual({ value: 1, strict: false });
    const after = callTranspiledExportFull(run, "simPure", [dAbs, maxAbs]).result;
    expect(numericBounds(after, pTrue)).toBeUndefined();
  });
});

describe("assume relational div: 调用边界隔离（unsound 守卫）", () => {
  // T1 交接旗标：#123 contract-face adoption 会把无信息实参重锚
  // termVar(calleeParamName)——callee 同名参数误匹配 caller 引理 = unsound
  // 假精度。callAtFunctionBoundary 在前提非平凡时清空 assume 槽（边界
  // 退出还原 caller 值）：目标帧（入口直接 invoke，不经边界）保持前提，
  // 一切嵌套 callee 帧（$callNamed / apply 桥 / 容器回调）一律见空。
  const src = `export function simPure(d, max) { return 1 - d / max; }
export function viaInner(d, max) { return simPure(d, max); }`;

  it("控制组：目标帧直接求值 ⇒ [0,1] 折叠生效", () => {
    const run = runTranspiled(src, { mode: "analyze" });
    const r = withAssumePremises(leDMax, () =>
      callTranspiledExportFull(run, "simPure", [dAbs, maxAbs]).result,
    );
    expect(numericBounds(r, pTrue)?.hi).toEqual({ value: 1, strict: false });
  });

  it("嵌套 callee 帧不继承 caller 引理（同实参透传也清空）", () => {
    const run = runTranspiled(src, { mode: "analyze" });
    const r = withAssumePremises(leDMax, () =>
      callTranspiledExportFull(run, "viaInner", [dAbs, maxAbs]).result,
    );
    // viaInner 体是 caller 帧（保持前提），simPure 经 $callNamed 进边界
    // （清空）——即使实参是同一批 Abs 对象（值上 sound）也按嵌套帧保守
    // 清空：#123 重锚场景下同名匹配不可信
    expect(numericBounds(r, pTrue)).toBeUndefined();
  });

  it("边界退出还原：嵌套调用返回后 caller 帧内后续 div 仍折叠", () => {
    const src2 = `export function zero() { return 0; }
export function simAfter(d, max) { const z = zero(); return z + 1 - d / max; }`;
    const run = runTranspiled(src2, { mode: "analyze" });
    const r = withAssumePremises(leDMax, () =>
      callTranspiledExportFull(run, "simAfter", [dAbs, maxAbs]).result,
    );
    // zero() 调用（边界清空）返回后，caller 帧的 d/max 折叠必须恢复前提；
    // div 在调用之后求值、分子分母保持裸 var term（d+z 会合成 +(d,0) 项，
    // 引理按项恒等不匹配——那是项匹配口径，与本还原断言无关）
    expect(numericBounds(r, pTrue)?.hi).toEqual({ value: 1, strict: false });
  });
});
