/**
 * Bug 12/13/22：弱集合实例方法三连（同族，一次修完）。
 * - Bug 12：evalBuiltinInstanceMethod 无 WeakMap/WeakSet case——方法值经
 *   BUILTIN_BRAND_METHODS 的 no-op fn 被直接调用，折精确 undefined/false
 *   （w.set(k,1) 后 w.get(k) 声称「键必不存在」）。修复：诚实域——条目表
 *   不建模（key 身份不在分析域）：get → unknown、has/delete → 抽象 boolean、
 *   set/add → receiver（原生恒返 this）；确定非弱键时 get/has/delete 原生
 *   不抛直返 undefined/false，可精确折（node 实测）。
 * - Bug 22：set/add 缺 ValidateWeakMapKey——键过 CanBeHeldWeakly
 *   （enforceCanBeHeldWeakly，与 FCR register 同口径）：prim/nullish 字面量
 *   与缺省 → 确定 TypeError；symbol/对象形态合法（node 26：Symbol() 不抛；
 *   注册 Symbol.for 原生抛，Abs 无注册标记不可分，保守按合法——已知欠
 *   近似）；抽象 → recordMayThrow（L2 gate）。get/has/delete 原生不校验。
 * - Bug 13：brand 实例方法值读（containers $get）此前返回 no-op fn，借用
 *   m.get.call(m,k) / .apply / .bind 产物直接调用折精确 undefined。修复：
 *   具名方法值走方法值读通道（protoMethodValueAbs），apply 钩子转发回
 *   $invoke 既有派发——全部内建 brand（Map/Set/Date/RegExp/Error）借用
 *   调用与直调同面；@@iterator 维持 no-op 形状（迭代协议派发另走）。
 * ground truth：node 原生实测（native 是 ground truth）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs } from "@nudojs/core";
import type { Abs } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 无约束实参（may 档探针——缺省会把 k 绑成 undefined 字面量而走定抛面） */
const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

/** result + throws + may-effects 三面（effects 去重 kind）；args 传入 f 的实参 */
function evalAbs(
  src: string,
  args: unknown[] = [],
): { result: Abs | undefined; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let out: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      out = callTranspiledExportFull(run, "f", args as never[]) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: out.result as Abs | undefined,
    throws: out.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

function shapeK(a: Abs | undefined): string {
  return a?.shape?.k ?? "?";
}

/** 精确 undefined 字面量（k:"unknown" + lit undefined）——Bug 12 的病灶面 */
function isUndefLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    (a.term as { value?: unknown }).value === undefined
  );
}

/** 精确 false 字面量 */
function isFalseLit(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "prim" && (a.shape as { type?: string }).type === "boolean" &&
    a.term?.op === "lit" && (a.term as { value?: unknown }).value === false;
}

/** 抽象 boolean 域（非精确 lit——has/delete 的诚实面） */
function isBoolPrim(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "prim" && (a.shape as { type?: string }).type === "boolean" &&
    a.term?.op !== "lit";
}

/** lit 值读取便捷面 */
function litOf(a: Abs | undefined): unknown {
  const r = a ? litValue(a) : undefined;
  return r?.ok ? r.value : undefined;
}

describe("Bug 12：WeakMap/WeakSet 实例方法返回面（诚实域，不再折精确 undefined/false）", () => {
  it("w.get(k) after w.set(k,1) → unknown（条目表不建模；修复前折精确 undefined）", () => {
    const src = `export function f() { const w = new WeakMap(); const k = {}; w.set(k, 1); return w.get(k); }`;
    const r = evalAbs(src);
    expect(shapeK(r.result), src).toBe("unknown");
    expect(isUndefLit(r.result), src).toBe(false);
    expect(throwsTypeError(r.throws), src).toBe(false);
  });

  it("w.has(k) / w.delete(k) → 抽象 boolean（修复前折精确 undefined）", () => {
    for (const src of [
      `export function f() { const w = new WeakMap(); const k = {}; w.set(k, 1); return w.has(k); }`,
      `export function f() { const w = new WeakMap(); const k = {}; w.set(k, 1); return w.delete(k); }`,
    ]) {
      const r = evalAbs(src);
      expect(isBoolPrim(r.result), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("w.set(k,1) 恒返 receiver：=== w 折精确 true（修复前精确 false，断链式）", () => {
    for (const src of [
      `export function f() { const w = new WeakMap(); const k = {}; return w.set(k, 1) === w; }`,
      `export function f() { const w = new WeakMap(); const k = {}; const r = w.set(k, 1); return r === w; }`,
    ]) {
      const r = evalAbs(src);
      expect(litOf(r.result), src).toBe(true);
    }
  });

  it("WeakSet：s.add(k) === s 折精确 true；s.has(k) → 抽象 boolean", () => {
    expect(litOf(evalAbs(`export function f() { const s = new WeakSet(); const k = {}; return s.add(k) === s; }`).result)).toBe(true);
    expect(isBoolPrim(evalAbs(`export function f() { const s = new WeakSet(); const k = {}; s.add(k); return s.has(k); }`).result)).toBe(true);
  });

  it("确定非弱键精确折（node：get(1)/get()=undefined、has(1)/delete(1)=false，均不抛）", () => {
    expect(isUndefLit(evalAbs(`export function f() { const w = new WeakMap(); return w.get(1); }`).result)).toBe(true);
    expect(isUndefLit(evalAbs(`export function f() { const w = new WeakMap(); return w.get(); }`).result)).toBe(true);
    expect(isFalseLit(evalAbs(`export function f() { const w = new WeakMap(); return w.has(1); }`).result)).toBe(true);
    expect(isFalseLit(evalAbs(`export function f() { const w = new WeakMap(); return w.delete(1); }`).result)).toBe(true);
    expect(isFalseLit(evalAbs(`export function f() { const s = new WeakSet(); return s.has("s"); }`).result)).toBe(true);
  });

  it("Map 对照组：m.get(k) 条目表面（非精确 undefined——不因弱集合修复回归）", () => {
    const src = `export function f() { const m = new Map(); const k = {}; m.set(k, 1); return m.get(k); }`;
    const r = evalAbs(src);
    expect(isUndefLit(r.result), src).toBe(false);
    expect(shapeK(r.result), src).not.toBe("never");
  });

  it("值读面保持：typeof w.set === 'function'（方法值读通道产物仍 fn 形状）", () => {
    const r = evalAbs(`export function f() { const w = new WeakMap(); return typeof w.set; }`);
    expect(litOf(r.result)).toBe("function");
  });
});

describe("Bug 22：WeakMap.set / WeakSet.add 弱键校验（CanBeHeldWeakly）", () => {
  it("prim/nullish 字面量键 → definite TypeError（node 实测均抛）", () => {
    for (const key of ["1", "'s'", "null", "undefined", "true", "1n"]) {
      const src = `export function f() { try { new WeakMap().set(${key}, 1); return "no-throw"; } catch (e) { return e.constructor.name; } }`;
      const r = evalAbs(src);
      expect(litOf(r.result), src).toBe("TypeError");
      expect(r.effects, src).toEqual([]);
    }
  });

  it("缺省键 w.set() → definite TypeError（node 实测；缺省 ≡ undefined 非弱键）", () => {
    const src = `export function f() { try { new WeakMap().set(); return "no-throw"; } catch (e) { return e.constructor.name; } }`;
    expect(litOf(evalAbs(src).result)).toBe("TypeError");
  });

  it("WeakSet.add 同校验：add(1) / add(null) / add() → definite TypeError", () => {
    for (const key of ["1", "null", ""]) {
      const src = `export function f() { try { new WeakSet().add(${key}); return "no-throw"; } catch (e) { return e.constructor.name; } }`;
      expect(litOf(evalAbs(src).result), src).toBe("TypeError");
    }
  });

  it("对象 / symbol 键合法不抛（node：{} 与 Symbol() 不抛；Symbol.for Abs 层无注册标记保守按合法）", () => {
    for (const key of ["{}", "Symbol()"]) {
      const src = `export function f() { const w = new WeakMap(); w.set(${key}, 1); return w.set(${key}, 2) === w; }`;
      const r = evalAbs(src);
      expect(litOf(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(false);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("抽象键 → recordMayThrow TypeError（L2 gate；结果面仍返回 receiver）", () => {
    for (const [name, src] of [
      ["WeakMap.set", `export function f(k) { const w = new WeakMap(); return w.set(k, 1) === w; }`],
      ["WeakSet.add", `export function f(k) { const s = new WeakSet(); return s.add(k) === s; }`],
    ] as const) {
      const r = evalAbs(src, [anyAbs]);
      expect(r.effects, `${name}: ${src}`).toContain("TypeError");
      expect(litOf(r.result), `${name}: ${src}`).toBe(true);
    }
  });

  it("get/has/delete 非弱键不记 may-throw（原生直返 undefined/false 不校验）", () => {
    for (const src of [
      `export function f() { const w = new WeakMap(); return w.get(1); }`,
      `export function f() { const w = new WeakMap(); return w.has(1); }`,
      `export function f() { const s = new WeakSet(); return s.delete("s"); }`,
    ]) {
      const r = evalAbs(src);
      expect(r.effects, src).toEqual([]);
      expect(throwsTypeError(r.throws), src).toBe(false);
    }
  });
});

describe("Bug 13：借用 .call/.apply/.bind 在 brand 实例方法值上转发既有派发", () => {
  it("Map 借用 call：get/has/set 与直调同面（node：1 / true / true）", () => {
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); return m.get.call(m, "k"); }`).result)).toBe(1);
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); return m.has.call(m, "k"); }`).result)).toBe(true);
    expect(litOf(evalAbs(`export function f() { const m = new Map(); return m.set.call(m, "k", 1) === m; }`).result)).toBe(true);
  });

  it("Set 借用 call：s.has.call(s, 1) → true（node 实测）", () => {
    expect(litOf(evalAbs(`export function f() { const s = new Set([1]); return s.has.call(s, 1); }`).result)).toBe(true);
  });

  it("Date 借用 call：getTime.call(d) → number 域（node：0；修复前精确 undefined）", () => {
    const src = `export function f() { const d = new Date(0); return d.getTime.call(d); }`;
    const r = evalAbs(src);
    expect(shapeK(r.result), src).toBe("prim");
    expect((r.result!.shape as { type?: string }).type, src).toBe("number");
    expect(isUndefLit(r.result), src).toBe(false);
  });

  it("RegExp 借用 call：r.exec.call(r,'bab') 命中槽 'a'；r.test.call → true", () => {
    const exec = evalAbs(`export function f() { const r = /a/; return r.exec.call(r, "bab"); }`).result;
    expect(shapeK(exec)).toBe("obj");
    const slots = (exec!.shape as { slots?: Record<string, { value: Abs }> }).slots ?? {};
    expect(litOf(slots["0"]?.value)).toBe("a");
    expect(litOf(evalAbs(`export function f() { const r = /a/; return r.test.call(r, "bab"); }`).result)).toBe(true);
  });

  it("Error 借用 call：e.toString.call(e) → 'Error: m'（精确）", () => {
    expect(litOf(evalAbs(`export function f() { const e = new Error("m"); return e.toString.call(e); }`).result)).toBe("Error: m");
  });

  it("apply 形式：m.get.apply(m, ['k']) → 1（node 实测）", () => {
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); return m.get.apply(m, ["k"]); }`).result)).toBe(1);
  });

  it("bind 产物：callable 转发不再精确 undefined——m.get.bind(m,'k')() → 1", () => {
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); const g = m.get.bind(m, "k"); return g(); }`).result)).toBe(1);
  });

  it("一等值读取后借用：const g = m.get; g.call(m, 'k') → 1", () => {
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); const g = m.get; return g.call(m, "k"); }`).result)).toBe(1);
  });

  it("WeakMap 借用走同一面：set.call 定抛 / get.call 诚实 unknown / set.call(k)===w 折 true", () => {
    const t = evalAbs(`export function f() { const w = new WeakMap(); try { w.set.call(w, 1, 2); return "no-throw"; } catch (e) { return e.constructor.name; } }`);
    expect(litOf(t.result)).toBe("TypeError");
    const g = evalAbs(`export function f() { const w = new WeakMap(); const k = {}; w.set(k, 1); return w.get.call(w, k); }`);
    expect(isUndefLit(g.result)).toBe(false);
    expect(shapeK(g.result)).toBe("unknown");
    expect(litOf(evalAbs(`export function f() { const w = new WeakMap(); const k = {}; return w.set.call(w, k, 1) === w; }`).result)).toBe(true);
  });

  it("控制组：直调不受影响（m.get('k') → 1、Map.prototype.get.call(m,'k') → 1）", () => {
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); return m.get("k"); }`).result)).toBe(1);
    expect(litOf(evalAbs(`export function f() { const m = new Map([["k", 1]]); return Map.prototype.get.call(m, "k"); }`).result)).toBe(1);
  });
});
