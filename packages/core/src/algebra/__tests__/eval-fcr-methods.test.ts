/**
 * Bug 43：FinalizationRegistry.prototype.register/unregister 此前落空 brand
 * 兜底不校验 target（FCR 实例是 $new 空 brand 兜底产物，$invokeInner 品牌
 * 派发直达 evalBuiltinInstanceMethod 但无 case → 不抛、不记 may，L2 漏报）。
 * 修复：register 的 target 与「给出且非 undefined」的 unregisterToken、
 * unregister 的 token 过 CanBeHeldWeakly——number/string/boolean/bigint/
 * nullish 字面量与缺省 → 确定 TypeError；symbol/对象形态 → 合法弱键
 * （node 26 实测 register(Symbol(),1) 不抛）；抽象 → recordMayThrow。
 * heldToken 任意值合法（原生不校验）。unregister 返回保守 boolean
 * （cells 表未建模，与 Map/Set delete 同口径）。
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

/** 无约束实参（may 档探针——缺省会把 x 绑成 undefined 字面量而走折叠面） */
const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

/** 每例内建的 FCR 接收者（$new 空 brand 兜底产物，brand 名路由） */
const MK = `const fcr = new FinalizationRegistry(() => {});`;

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

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

/** register 非抛臂返回面：undefined 字面量（k:"unknown" + lit undefined） */
function isUndefLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined
  );
}

/** unregister 返回面：保守 boolean 域（与 Map/Set delete 同口径） */
function isBoolPrim(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "prim" && (a.shape as { type?: string }).type === "boolean";
}

describe("FinalizationRegistry.prototype.register：target IsObject（CanBeHeldWeakly）", () => {
  it("非对象字面量 target → definite TypeError（node 实测均抛）", () => {
    for (const target of ["1", "'s'", "null", "undefined", "true", "1n"]) {
      const src = `export function f() { ${MK} return fcr.register(${target}, 1); }`;
      const r = evalAbs(src);
      expect(shapeK(r.result), src).toBe("never");
      expect(throwsTypeError(r.throws), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("对象/symbol/元组 target 合法，返回 undefined（node：register({},1)/register(Symbol(),1) 不抛）", () => {
    for (const target of ["{}", "Symbol()", "[]"]) {
      const src = `export function f() { ${MK} return fcr.register(${target}, 1); }`;
      const r = evalAbs(src);
      expect(isUndefLit(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(false);
      expect(r.effects, src).toEqual([]);
    }
    // heldToken 缺省合法（node：register({}) 单参不抛）
    const r1 = evalAbs(`export function f() { ${MK} return fcr.register({}); }`);
    expect(isUndefLit(r1.result)).toBe(true);
    expect(r1.effects).toEqual([]);
  });

  it("heldToken 任意值合法（原生不校验）", () => {
    for (const held of ["1", "'s'", "null", "undefined", "true", "1n", "Symbol()", "{}"]) {
      const src = `export function f() { ${MK} return fcr.register({}, ${held}); }`;
      const r = evalAbs(src);
      expect(isUndefLit(r.result), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("unregisterToken 给出且非 undefined → 同 target 校验（node：register({},1,2)/({},1,null) 抛；({},1,Symbol()) 不抛）", () => {
    for (const tok of ["2", "null", "'s'", "true", "1n"]) {
      const src = `export function f() { ${MK} return fcr.register({}, 1, ${tok}); }`;
      const r = evalAbs(src);
      expect(shapeK(r.result), src).toBe("never");
      expect(throwsTypeError(r.throws), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
    const okSym = evalAbs(`export function f() { ${MK} return fcr.register({}, 1, Symbol()); }`);
    expect(isUndefLit(okSym.result)).toBe(true);
    expect(okSym.effects).toEqual([]);
    // undefined 字面量豁免（原生 SameValue(unregisterToken, undefined) 跳过校验）
    const rU = evalAbs(`export function f() { ${MK} return fcr.register({}, 1, undefined); }`);
    expect(isUndefLit(rU.result)).toBe(true);
    expect(rU.effects).toEqual([]);
  });

  it("抽象 target → gate 记 may TypeError + 非抛臂返回面仍确定 undefined", () => {
    const r = evalAbs(`export function f(x) { ${MK} return fcr.register(x, 1); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(isUndefLit(r.result)).toBe(true);
  });

  it("抽象 unregisterToken（target 确定对象）→ gate 记 may TypeError", () => {
    const r = evalAbs(`export function f(u) { ${MK} return fcr.register({}, 1, u); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(isUndefLit(r.result)).toBe(true);
  });

  it("确定 TypeError 可被 catch 吸收（catch 形参面走 throws 通道）", () => {
    expect(
      litValue(
        call(
          `export function f() { ${MK} try { fcr.register(1, 1); } catch (e) { return e instanceof TypeError ? "type" : "other"; } return "missed"; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "type" });
  });
});

describe("FinalizationRegistry.prototype.unregister：token IsObject + 保守 boolean", () => {
  it("非弱键 token → definite TypeError（node：unregister(undefined)/(1)/(null) 均抛——无 register 的 undefined 豁免）", () => {
    for (const tok of ["undefined", "1", "null", "'s'", "true", "1n"]) {
      const src = `export function f() { ${MK} return fcr.unregister(${tok}); }`;
      const r = evalAbs(src);
      expect(shapeK(r.result), src).toBe("never");
      expect(throwsTypeError(r.throws), src).toBe(true);
      expect(r.effects, src).toEqual([]);
    }
    // 缺省实参 ≡ undefined：同样确定抛
    const r0 = evalAbs(`export function f() { ${MK} return fcr.unregister(); }`);
    expect(shapeK(r0.result)).toBe("never");
    expect(throwsTypeError(r0.throws)).toBe(true);
    expect(r0.effects).toEqual([]);
  });

  it("对象/symbol token 合法，返回保守 boolean（node：unregister({}) → false）", () => {
    for (const tok of ["{}", "Symbol()", "[]"]) {
      const src = `export function f() { ${MK} return fcr.unregister(${tok}); }`;
      const r = evalAbs(src);
      expect(isBoolPrim(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(false);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("抽象 token → gate 记 may TypeError + 保守 boolean", () => {
    const r = evalAbs(`export function f(x) { ${MK} return fcr.unregister(x); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(isBoolPrim(r.result)).toBe(true);
  });
});
