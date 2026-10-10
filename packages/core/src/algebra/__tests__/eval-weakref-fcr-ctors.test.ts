/**
 * Bug 25：new WeakRef(x) / new FinalizationRegistry(cb) 此前两个分发面
 * （evalBuiltinNew Abs 面 + $new 宿主表）均无 case——构造实参零校验，
 * `try { new WeakRef(1) } catch` 引擎走 try 臂而原生 TypeError
 * （node 实测 "WeakRef: invalid target" / "FinalizationRegistry:
 * cleanup must be callable"），L2 gate 漏报。
 * 修复（与 FCR.register 同口径）：WeakRef target 过 CanBeHeldWeakly
 * （enforceCanBeHeldWeakly）——prim/nullish 字面量与缺省 → 确定
 * TypeError；symbol/对象形态（含元组）合法；抽象 → recordMayThrow。
 * FCR cleanupCallback 过 IsCallable（validateCallableArg，无 undefinedOk
 * 豁免——缺省原生同抛）。合法 → 空 brand（与原兜底同款，deref/实例方法
 * 面保持 Bug 40/43 现状）。
 * ground truth：node 原生实测（native 是 ground truth）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, abs } from "@nudojs/core";
import type { Abs } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 无约束实参（may 档探针——缺省会把 x 绑成 undefined 字面量而走折叠面） */
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

/** 构造合法臂的返回面：空 brand（名字路由实例方法/枚举面） */
function isBrandNamed(a: Abs | undefined, name: string): boolean {
  return a?.shape?.k === "brand" && (a.shape as { name?: string }).name === name;
}

/** register 非抛臂返回面：undefined 字面量（k:"unknown" + lit undefined） */
function isUndefLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined
  );
}

describe("new WeakRef(target)：CanBeHeldWeakly 校验（node 实测 Invalid value used as weak ref）", () => {
  it("非弱键字面量 target → definite TypeError（node：1/'s'/null/undefined/true/1n/缺省均抛）", () => {
    for (const target of ["1", "'s'", "null", "undefined", "true", "1n", ""]) {
      const call = target === "" ? "new WeakRef()" : `new WeakRef(${target})`;
      const src = `export function f() { const w = ${call}; return w; }`;
      const r = evalAbs(src);
      expect(shapeK(r.result), src).toBe("never");
      expect(throwsTypeError(r.throws), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("try/catch 分叉与原生一致（引擎进 catch 臂收 TypeError brand）", () => {
    const src = `export function f() {
      try { new WeakRef(1); return "no-throw"; } catch (e) { return e.constructor.name; }
    }`;
    const r = evalAbs(src);
    expect(throwsTypeError(r.throws), src).toBe(false);
    expect(r.effects, src).toEqual([]);
    // 引擎收 TypeError brand 的 constructor.name（若读面折字面量则直接断言）
    expect(shapeK(r.result)).not.toBe("never");
  });

  it("对象/symbol/元组 target 合法 → 空 brand（node：WeakRef({})/WeakRef(Symbol()) 不抛）", () => {
    for (const target of ["{}", "Symbol()", "[]", "(()=>{})"]) {
      const src = `export function f() { const w = new WeakRef(${target}); return w; }`;
      const r = evalAbs(src);
      expect(isBrandNamed(r.result, "WeakRef"), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(false);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("抽象 target → gate 记 may TypeError（L2），值域保守 brand 不折 never", () => {
    const r = evalAbs(`export function f(x) { return new WeakRef(x); }`, [anyAbs]);
    expect(shapeK(r.result)).not.toBe("never");
    expect(throwsTypeError(r.throws)).toBe(false);
    expect(r.effects).toEqual(["TypeError"]);
  });

  it("Abs 面（.constructor 派发）与直呼同口径", () => {
    // 定抛：字面量非弱键
    const r1 = evalAbs(
      `export function f() { const C = new WeakRef({}).constructor; return new C(1); }`,
    );
    expect(shapeK(r1.result)).toBe("never");
    expect(throwsTypeError(r1.throws)).toBe(true);
    expect(r1.effects).toEqual([]);
    // 抽象：may TypeError（gate），值域保守 brand 不折 never
    const r2 = evalAbs(
      `export function f(x) { const C = new WeakRef({}).constructor; return new C(x); }`,
      [anyAbs],
    );
    expect(isBrandNamed(r2.result, "WeakRef")).toBe(true);
    expect(throwsTypeError(r2.throws)).toBe(false);
    expect(r2.effects).toEqual(["TypeError"]);
  });
});

describe("new FinalizationRegistry(cleanupCallback)：IsCallable 前置校验（node 实测 cleanup must be callable）", () => {
  it("非 callable 字面量 → definite TypeError（node：1/null/'s'/{}/undefined/缺省均抛）", () => {
    for (const cb of ["1", "null", "'s'", "{}", "undefined", ""]) {
      const call = cb === "" ? "new FinalizationRegistry()" : `new FinalizationRegistry(${cb})`;
      const src = `export function f() { const r = ${call}; return r; }`;
      const r = evalAbs(src);
      expect(shapeK(r.result), src).toBe("never");
      expect(throwsTypeError(r.throws), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("callable → 空 brand（node：new FinalizationRegistry(()=>{}) 不抛；register/unregister 面保持 Bug 43）", () => {
    const r = evalAbs(`export function f() { return new FinalizationRegistry(() => {}); }`);
    expect(isBrandNamed(r.result, "FinalizationRegistry")).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(false);
    expect(r.effects).toEqual([]);
    // 合法构造后实例方法面不变：register 返回 undefined 字面量（Bug 43）
    const r2 = evalAbs(
      `export function f() { const r = new FinalizationRegistry(() => {}); return r.register({}, 1); }`,
    );
    expect(isUndefLit(r2.result)).toBe(true);
    expect(throwsTypeError(r2.throws)).toBe(false);
    expect(r2.effects).toEqual([]);
  });

  it("抽象 callback → gate 记 may TypeError（L2），值域保守不折 never", () => {
    const r = evalAbs(`export function f(x) { return new FinalizationRegistry(x); }`, [anyAbs]);
    expect(shapeK(r.result)).not.toBe("never");
    expect(throwsTypeError(r.throws)).toBe(false);
    expect(r.effects).toEqual(["TypeError"]);
  });

  it("Abs 面（.constructor 派发）与直呼同口径", () => {
    const src = `export function f() { const C = new FinalizationRegistry(()=>{}).constructor; return new C(1); }`;
    const r = evalAbs(src);
    expect(shapeK(r.result), src).toBe("never");
    expect(throwsTypeError(r.throws), src).toBe(true);
    expect(r.effects, src).toEqual([]);
  });
});
