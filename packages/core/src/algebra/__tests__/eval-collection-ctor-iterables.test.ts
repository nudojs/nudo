/**
 * Bug 8 回归：集合构造器 iterable 实参校验（值级 + L2 gate 两面）。
 * node 实测原生口径（AddEntriesFromIterable / CanBeHeldWeakly）：
 * - Map/WeakMap 条目必须是对象：new Map([null]) / ([undefined]) / ([1]) /
 *   (["s"]) / ([Symbol()]) → TypeError "Iterator value … is not an entry object"
 *   ——nullish/symbol 字面量挂 shape k:"unknown" + lit term，旧 primEntry
 *   （shape.k === "prim"）绕过 → 漏抛；
 * - WeakMap 条目键 = Get(entry, "0") 须可弱持有：new WeakMap([{}]) / ([[]]) /
 *   ([["a"]]) / ([["a",1]]) / ([[null,1]]) / ([() => {}]) / ([new Date()])
 *   → TypeError "Invalid value used as weak map key"——闭对象无 0 槽 → 键
 *   undefined 非弱键，旧口径只查 ≥2 元组的首元素 prim → 漏抛；
 * - 一元/零元组与无 0 槽对象都是合法 entry：new Map([["a"]]).size === 1
 *   （值 undefined）、new Map([[]]).size === 1、new Map([{}]).size === 1
 *   ——旧实现 ≥2 元组才入表 → size 假 0（batch21 电池残余）；
 * - WeakSet 元素走 CanBeHeldWeakly（非 IsObject）：new WeakSet([Symbol()])
 *   合法（symbol 可弱持有，node 实测不抛）——旧 primEntry 一刀切 → 假抛；
 * - L2 gate：new Map/Set/WeakMap/WeakSet(x)（x 抽象）记 may TypeError
 *   （报告 repro：四构造器全静默）；元素抽象 new Map([x]) / 抽象字符串
 *   new Map("x"+s) 同记；Map/Set 拷贝构造（迭代协议全定）不记。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { anyAbs, litValue } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { formatAbs } from "../format.ts";
import { $lit } from "../exec/runtime/state.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

function call(src: string, fnName = "f", args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args as never[]) as {
    result?: unknown;
    throws?: unknown;
  };
}

function check(src: string) {
  return checkSource("/t/collection-ctor-iterables.js", src);
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function numLitOf(r: unknown): unknown {
  return litValue(r as never).ok ? (litValue(r as never) as { value: unknown }).value : undefined;
}

function evalSrc(
  src: string,
  fnName: string,
  args: unknown[],
): { value: string; throws: string; effects: string[] } {
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = call(src, fnName, args);
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("Bug 8: 集合构造器元素级 entry 校验（值级定抛）", () => {
  it("Map 非 entry 对象条目（nullish/symbol 字面量挂 unknown 形态）→ TypeError", () => {
    for (const src of [
      `export function f() { return new Map([null]).size; }`,
      `export function f() { return new Map([undefined]).size; }`,
      `export function f() { return new Map([1]).size; }`,
      `export function f() { return new Map(["s"]).size; }`,
      `export function f() { return new Map([Symbol()]).size; }`,
      `export function f() { return new Map([[1, 2], null]).size; }`,
      `export function f() { return new WeakMap([1]).size; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(true);
    }
  });

  it("WeakMap 非弱键条目（闭对象/零元组/一元组/prim 键/fn/Date）→ TypeError", () => {
    for (const src of [
      `export function f() { return new WeakMap([{}]).size; }`,
      `export function f() { return new WeakMap([[]]).size; }`,
      `export function f() { return new WeakMap([["a"]]).size; }`,
      `export function f() { return new WeakMap([["a", 1]]).size; }`,
      `export function f() { return new WeakMap([[null, 1]]).size; }`,
      `export function f() { return new WeakMap([() => {}]).size; }`,
      `export function f() { return new WeakMap([new Date()]).size; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(true);
    }
  });

  it("WeakSet 非弱元素 → TypeError；symbol 元素合法（旧 primEntry 假抛）", () => {
    for (const src of [
      `export function f() { return new WeakSet([null]).size; }`,
      `export function f() { return new WeakSet([1]).size; }`,
      `export function f() { return new WeakSet(["s"]).size; }`,
      `export function f() { return new WeakSet([undefined]).size; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(true);
    }
    // node 实测 new WeakSet([Symbol()]) 不抛：symbol 可弱持有（CanBeHeldWeakly）
    const ok = call(`export function f() { return new WeakSet([Symbol()]).size; }`);
    expect(throwsTypeError(ok.throws)).toBe(false);
  });

  it("TypeError 可 catch（值级与原生同域）", () => {
    expect(
      litValue(call(`export function f() { try { new Map([null]); } catch (e) { return "caught"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "caught" });
    expect(
      litValue(call(`export function f() { try { new WeakMap([{}]); } catch (e) { return "caught"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "caught" });
  });
});

describe("Bug 8: 合法 entry 对齐原生（一元/零元组与对象条目入表）", () => {
  it("new Map([['a']]).size === 1，get('a') → undefined，has('a') → true", () => {
    expect(numLitOf(call(`export function f() { return new Map([["a"]]).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map([["a"]]).get("a"); }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(litValue(call(`export function f() { return new Map([["a"]]).has("a"); }`).result)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("零元组/无 0 槽对象条目：键 undefined 入表（native size 1）", () => {
    expect(numLitOf(call(`export function f() { return new Map([[]]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Map([{}]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Map([new Date()]).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map([[]]).get(undefined); }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("同键 SameValueZero 去重与混合长度条目", () => {
    expect(numLitOf(call(`export function f() { return new Map([["a"], ["a"]]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Map([[], []]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Map([["a", 1], ["b"]]).size; }`).result)).toBe(2);
    expect(numLitOf(call(`export function f() { return new Map([{ 0: 1 }]).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map([{ 0: 1 }]).get(1); }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("合法控制组不回退：二元组 / null 键 / Set 元素 / 弱键对象", () => {
    expect(numLitOf(call(`export function f() { return new Map([["a", 1]]).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map([["a", 1]]).get("a"); }`).result)).toEqual({
      ok: true,
      value: 1,
    });
    expect(numLitOf(call(`export function f() { return new Map([[null, 1]]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Set([null]).size; }`).result)).toBe(1);
    expect(numLitOf(call(`export function f() { return new Set("s").size; }`).result)).toBe(1);
    const wm = call(`export function f() { return new WeakMap([[{}, 1]]).size; }`);
    expect(throwsTypeError(wm.throws)).toBe(false);
    const ws = call(`export function f() { return new WeakSet([{}]).size; }`);
    expect(throwsTypeError(ws.throws)).toBe(false);
  });
});

describe("Bug 8: L2 gate —— 抽象实参记 may TypeError", () => {
  it("报告 repro 矩阵：new Map/Set/WeakMap/WeakSet(x) 全报（旧全静默）", () => {
    const r = check(`
      export function fm(x) { return new Map(x); }
      export function fs(x) { return new Set(x); }
      export function fw(x) { return new WeakMap(x); }
      export function fws(x) { return new WeakSet(x); }
    `);
    expect(l2Count(r, "fm")).toBeGreaterThan(0);
    expect(l2Count(r, "fs")).toBeGreaterThan(0);
    expect(l2Count(r, "fw")).toBeGreaterThan(0);
    expect(l2Count(r, "fws")).toBeGreaterThan(0);
  });

  it("字面量合法构造器不报（gate 无假阳）", () => {
    const r = check(`
      export function ok0() { return new Map().size; }
      export function ok1() { return new Map([["a", 1]]).size; }
      export function ok2() { return new Set([1, 2]).size; }
      export function ok3() { return new WeakMap([[{}, 1]]); }
      export function ok4() { return new WeakSet([{}]); }
      export function ok5() { return new Map(null).size; }
    `);
    expect(l2Count(r)).toBe(0);
  });

  it("运行时 effects：抽象外层 iterable / 抽象元素 / 抽象字符串实参", () => {
    expect(evalSrc(`export function f(x) { return new Map(x).size; }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new Set(x).size; }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new WeakMap(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new WeakSet(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new Map([x]).size; }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return new WeakMap([[x, 1]]); }`, "f", [anyAbs]).effects).toContain("TypeError");
    // 抽象字符串（"x" + any → prim string 无 lit）：非空臂字符非 entry/非弱键
    expect(evalSrc(`export function f(x) { return new Map("x" + x).size; }`, "f", [anyAbs]).effects).toContain("TypeError");
  });

  it("Map/Set 拷贝构造不记（迭代协议全定，无 gate 假阳）", () => {
    const mk = call(`export function mk() { return new Map([["a", 1]]); }`, "mk");
    const mp = mk.result;
    expect(evalSrc(`export function f(m) { return new Map(m).size; }`, "f", [mp]).effects).not.toContain("TypeError");
    const sk = call(`export function mk() { return new Set([1, 2]); }`, "mk");
    expect(evalSrc(`export function f(s) { return new Set(s).size; }`, "f", [sk.result]).effects).not.toContain("TypeError");
  });

  it("定抛面走 throws 通道而非 effects（与其它定抛同口径）", () => {
    const r = evalSrc(`export function f() { return new Map([null]).size; }`, "f", []);
    expect(throwsTypeError(call(`export function f() { return new Map([null]).size; }`).throws)).toBe(true);
    expect(r.effects).not.toContain("TypeError");
  });
});
