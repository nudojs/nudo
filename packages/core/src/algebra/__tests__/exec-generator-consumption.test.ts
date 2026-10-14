/**
 * Bug 52 / 53 / 54（生成器消费状态与 .return()/.throw() 恢复语义）：
 *
 * - Bug 53：$gen 此前经 `$arr(ys)` 提取元素列表——>cap（>8）widen 成 arr
 *   后塌缩成单代表元素，首个 next() 即 `{done:true}`（9-yield 循环 /
 *   while(true) 全截断）。修复：**完整收集序列**驱动 next()/done 与元素
 *   侧表；$arr widen 只保留给形状槽（类型面合法过近似）。
 *
 * - Bug 54：spread / for-of / Array.from / 解构 / yield* 此前从元素侧表
 *   index 0 重放，忽略 next() 消费位（`it.next(); [...it].length` 假 1）。
 *   修复：消费位 live 视图——next() 推进时同步收缩，迭代消费点 drain
 *   排空（此后生成器 done，native 迭代协议耗尽语义）；数组解构逐项
 *   $idx 也按消费位读。
 *
 * - Bug 52：eager 快照模型无挂起帧可恢复——.return() 盲返注入值、
 *   .throw() 盲抛。修复：yield 点 try 上下文位（transpile 静态标注，
 *   $yield/$yieldStar 第二实参）分级：
 *   · finally 仅副作用（无 yield/return）→ .return(v) 精确透传 v；
 *   · finally 含 return → 值并 unknown、done 恒 true（无 yield）；
 *   · finally 含 yield → 值并 unknown、done 并 boolean、续体 poisoned
 *     （此后 next() → {value: unknown, done: boolean}）；
 *   · .throw(e) 挂 try/catch 内 → 被吸收：{value: unknown, done:
 *     boolean} + may-throw（catch 体收集期未执行、可重抛），不再定值抛；
 *     R1a 精化：catch 静态事实（无 yield、重抛不被外层 catch 二次吸收）
 *     且挂起点后无剩余收集 yield → 吸收必完成，done 折 true（native）；
 *   · 无 finally/catch 的挂起点（含未启动 / 已耗尽）保持原生精确：
 *     .return(v) → v；.throw(e) → 抛 e。
 *   soundness 纪律：消除 wrong-definite（native 值恒在值域内），
 *   完整续体恢复（真跑 finally/catch 体）超出 eager 快照模型能力。
 */
import { describe, it, expect } from "vitest";
import { litValue, formatAbs } from "@nudojs/core";
import { call, effects, isNever, objSlots, throwsError } from "./eval-helpers.ts";

describe("Bug 53: >8 yield 序列不截断（完整序列驱动 next/done）", () => {
  it("for i<9：第二个 next().value → 1（native 1）", () => {
    const r = call(
      `export function f() { function* g() { for (let i = 0; i < 9; i++) { yield i; } } const it = g(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("for i<9：第二个 next().done → false（native false）", () => {
    const r = call(
      `export function f() { function* g() { for (let i = 0; i < 9; i++) { yield i; } } const it = g(); it.next(); return it.next().done; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("while i<10：第三个 next().value → 2（native 2）", () => {
    const r = call(
      `export function f() { function* g() { let i = 0; while (i < 10) { yield i; i++; } } const it = g(); it.next(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("while (true)：无限生成器按序交付（0→1→2，native 2）", () => {
    const r = call(
      `export function f() { function* g() { let i = 0; while (true) { yield i; i++; } } const it = g(); it.next(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("while (true)：done → false（native false）", () => {
    const r = call(
      `export function f() { function* g() { let i = 0; while (true) { yield i; i++; } } const it = g(); it.next(); return it.next().done; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("for (;;)：第二个 next().value → 1（native 1）", () => {
    const r = call(
      `export function f() { function* g() { let i = 0; for (;;) { yield i; i++; if (i > 20) break; } } const it = g(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("9-yield for-of 全量求和 → 36（native 36）", () => {
    const r = call(
      `export function f() { function* g() { for (let i = 0; i < 9; i++) { yield i; } } let t = 0; for (const x of g()) t += x; return t; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 36 });
  });

  it("9-yield next() 链推进到第 9 个值 → 8（native 8）", () => {
    const r = call(
      `export function f() { function* g() { for (let i = 0; i < 9; i++) { yield i; } } const it = g(); let v; for (let k = 0; k < 9; k++) v = it.next().value; return v; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 8 });
  });
});

describe("Bug 54: 迭代消费从当前位继续（不再从 0 重放）", () => {
  it("it.next(); [...it].length → 0（native 0）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); return [...it].length; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("it.next(); for-of 求和剩余 2+3 → 5（native 5）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } const it = g(); it.next(); let t = 0; for (const x of it) t += x; return t; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("[...it] 排空后 next().done → true（native true）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; } const it = g(); [...it]; return it.next().done; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("二次 spread：第二次 → 空元组（native [2,0]）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; } const it = g(); const a = [...it].length; const b = [...it].length; return [a, b]; }`,
    );
    expect(formatAbs(r.result)).toContain("[2, 0]");
  });

  it("it.next() 后 spread 长度 + 后续 done（native [2,true]）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } const it = g(); it.next(); const n = [...it].length; return [n, it.next().done]; }`,
    );
    expect(formatAbs(r.result)).toContain("[2, true]");
  });

  it("数组解构逐项按消费位：it.next(); [a,b]=it → 2+3=5（native 5）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } const it = g(); it.next(); const [a, b] = it; return a + b; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("rest 解构按消费位：it.next(); [a,...r]=it → 2+2=4（native 4）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; yield 4; } const it = g(); it.next(); const [a, ...r] = it; return a + r.length; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("Map.keys() 迭代器同口径：next 后 spread → 剩余（native 1）", () => {
    const r = call(
      `export function f() { const m = new Map([["a", 1], ["b", 2]]); const ks = m.keys(); ks.next(); return [...ks].length; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("yield* 委托位：h() 的 next 序列与 g() 一致（native 2）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } function* h() { yield* g(); } const it = h(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 52: .return()/.throw() 挂起点语义（try 上下文分级，无 wrong-definite）", () => {
  it("finally 含 return：.return(99).value 不再 wrong-definite 99（native \"fin\"；值域 99⊔unknown）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { return "fin"; } } const it = g(); it.next(); return it.return(99).value; }`,
    );
    // native → "fin"：99 定值是 wrong-definite。修复后值域含 unknown（"fin" 在域内）
    expect(litValue(r.result).ok).toBe(false);
    expect(formatAbs(r.result)).toContain("unknown");
    expect(isNever(r.throws)).toBe(true);
  });

  it("finally 含 return（无 yield）：.return(99).done → true 精确（native true）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { return "fin"; } } const it = g(); it.next(); return it.return(99).done; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("finally 仅副作用：.return(99).value → 99 精确透传（native 99）", () => {
    const r = call(
      `export function f() { let c = 0; function* g() { try { yield 1; } finally { c++; } } const it = g(); it.next(); return it.return(99).value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 99 });
  });

  it("finally 含 yield：.return 后 done 并 boolean（native 可 false；不定值）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { yield 2; return "fin"; } } const it = g(); it.next(); return it.return(99).done; }`,
    );
    expect(litValue(r.result).ok).toBe(false);
  });

  it("finally 含 yield：poisoned 后 next() 不再 wrong-definite（native 可再交付）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { yield 2; return "fin"; } } const it = g(); it.next(); it.return(9); return it.next().value; }`,
    );
    expect(litValue(r.result).ok).toBe(false);
    expect(formatAbs(r.result)).toContain("unknown");
  });

  it("挂起点已出 try：.return(99).value → 99 精确（native 99，位置感知）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { return "fin"; } yield 2; } const it = g(); it.next(); it.next(); return it.return(99).value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 99 });
  });

  it("未启动：.return(9) → 9 精确（native 9——体未执行，finally 不跑）", () => {
    const r = call(
      `export function f() { function* g() { try { yield 1; } finally { return "fin"; } } const it = g(); return it.return(9).value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("裸 .return（无 try）：{value: 99, done: true} 精确（native 同）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); const r = it.return(99); return [r.value, r.done]; }`,
    );
    expect(formatAbs(r.result)).toContain("[99, true]");
  });

  it(".throw 进 try/catch：不再定值抛出（native \"caught\"；值 unknown）", () => {
    const r = call(
      `export function f() { function* h() { try { yield 1; } catch (e) { return "caught"; } } const it2 = h(); it2.next(); return it2.throw(new Error("x")).value; }`,
    );
    expect(litValue(r.result).ok).toBe(false);
    expect(formatAbs(r.result)).toContain("unknown");
    expect(isNever(r.throws)).toBe(true);
  });

  it(".throw 进 try/catch（catch 含 return、无剩余 yield）：done 折 true（R1a，native true）", () => {
    const r = call(
      `export function f() { function* h() { try { yield 1; } catch (e) { return "caught"; } } const it2 = h(); it2.next(); return it2.throw(new Error("x")).done; }`,
    );
    // R1a：catch 静态事实（含 return、无 yield）+ 挂起点后无剩余收集 yield →
    // 吸收必完成生成器，done 定值 true（native：catch return → 生成器完成）
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it(".throw 进 try/catch：catch 重抛面记 may-throw（sound 过近似）", () => {
    const eff = effects(
      `export function f() { function* h() { try { yield 1; } catch (e) { return "caught"; } } const it2 = h(); it2.next(); it2.throw(new Error("x")); return 0; }`,
    );
    expect(eff).toContain("Error");
  });

  it(".throw 无 catch（裸 / finally-only / 未启动）：保持原生定值抛（native TypeError）", () => {
    const bare = call(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); it.throw(new TypeError("x")); return 0; }`,
    );
    expect(throwsError(bare.throws, "TypeError")).toBe(true);

    const finOnly = call(
      `export function f() { let c = 0; function* g() { try { yield 1; } finally { c = 1; } } const it = g(); it.next(); it.throw(new TypeError("x")); return 0; }`,
    );
    expect(throwsError(finOnly.throws, "TypeError")).toBe(true);

    const unstarted = call(
      `export function f() { function* g() { try { yield 1; } catch (e) { return "c"; } } const it = g(); it.throw(new TypeError("x")); return 0; }`,
    );
    expect(throwsError(unstarted.throws, "TypeError")).toBe(true);
  });

  it("外层 catch 吸收内层 try/finally 的 .throw → unknown（native \"c\"）", () => {
    const r = call(
      `export function f() { let cleanup = 0; function* g() { try { try { yield 1; } finally { cleanup++; } } catch (e) { return "c"; } } const it = g(); it.next(); return it.throw(new Error("x")).value; }`,
    );
    expect(litValue(r.result).ok).toBe(false);
    expect(formatAbs(r.result)).toContain("unknown");
  });

  it("类方法 / 对象方法 / 函数表达式生成器体同编（try 上下文不丢）", () => {
    const cls = call(
      `export function f() { class A { *g() { try { yield 1; } finally { return "fin"; } } } const it = new A().g(); it.next(); return it.return(99).value; }`,
    );
    expect(litValue(cls.result).ok).toBe(false);

    const obj = call(
      `export function f() { const o = { *g() { try { yield 1; } finally { return "fin"; } } }; const it = o.g(); it.next(); return it.return(99).value; }`,
    );
    expect(litValue(obj.result).ok).toBe(false);

    const fnExpr = call(
      `export function f() { const g = function* () { try { yield 1; } finally { return "fin"; } }; const it = g(); it.next(); return it.return(99).value; }`,
    );
    expect(litValue(fnExpr.result).ok).toBe(false);
  });

  it("嵌套生成器不泄漏外层 try 上下文：inner 裸 .return(77) → 77 精确（native 77）", () => {
    const r = call(
      `export function f() { let leak; function* outer() { try { yield 1; const i2 = (function* () { yield 10; })(); i2.next(); leak = i2.return(77).value; } finally { return "f"; } } const o = outer(); o.next(); o.next(); return leak; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 77 });
  });

  it("终末 return 值 / spread 后 return 值丢弃不回归（Bug 2 口径保持）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; return 42; } const it = g(); it.next(); return it.next().value; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });

    const afterSpread = call(
      `export function f() { function* g() { yield 1; return 42; } const it = g(); it.next(); it.next(); return [...it].length; }`,
    );
    expect(litValue(afterSpread.result)).toEqual({ ok: true, value: 0 });
  });
});

describe("Bug 52/54 混合：for-of/next 与 .return 共享消费位", () => {
  it("for-of 部分消费后 .return 走裸路径（挂起在循环外 yield）", () => {
    // for-of 排空后生成器 done——.return(9) 精确 {value:9, done:true}（native 同）
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; } const it = g(); for (const x of it) {} return [it.return(9).value, it.return(9).done]; }`,
    );
    expect(formatAbs(r.result)).toContain("[9, true]");
  });

  it("iter result 槽位面：done 精确路径经 objSlots 可读", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); return it.return(9); }`,
    );
    expect(objSlots(r.result)).toMatchObject({ value: 9, done: true });
  });
});
