/**
 * Bug 23 回归：Object.create(proto, props) 的 ToPropertyDescriptor 面。
 * props 此前只有 nullish 定抛 / any-unknown-sum may / obj 枚举安装三臂，
 * 字符串与数组字面量落到「装箱零可枚举键」尾注口径静默——node 实测：
 * - 非空串 props：装箱后 "0".."n-1" 下标键值全为单字符 string（非对象）
 *   → 定抛 TypeError（空串零键静默）；
 * - 数组字面量 props：下标槽即自有可枚举键——非对象元素（string/null/
 *   undefined/prim/symbol）定抛，对象元素安装 "i"（[{}] 落键 "0"，
 *   "0" in o 原生 true），hole 位无键跳过；
 * - 抽象 string（可能非空）/ 抽象数组（元素可能非对象）→ may TypeError；
 * - 其余 prim 装箱（5/true/1n/Symbol()）零可枚举自有键 → 静默不装。
 * 控制组：obj props 安装面（getter/writable/多键/空描述符）与 proto 面
 * （null/对象/字面量）不回退。ground truth：node 原生实测。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs } from "@nudojs/core";
import { str } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function call(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

function kindOf(r: unknown): string | undefined {
  return (r as { shape?: { k?: string } })?.shape?.k;
}

/** string[] 折叠断言（Object.keys 视图） */
function strArr(r: unknown): string[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const out = a.shape.elements!.map((e) => {
    const rr = litValue(e as never);
    return rr.ok && typeof rr.value === "string" ? rr.value : undefined;
  });
  if (out.some((e) => e === undefined)) return undefined;
  return out as string[];
}

/** 源级求值（自定义实参绑定形参）：{ result, throws, effects[kind 去重] } */
function evalAbs(
  src: string,
  args: unknown[] = [anyAbs],
): { result: unknown; throws: unknown; effects: string[] } {
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
    result: out.result,
    throws: out.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

// --- Bug 23：props 校验矩阵 ---------------------------------------------------

describe("Bug 23: Object.create props 字符串/数组字面量定抛", () => {
  it("非空字符串字面量 props → 定抛 TypeError（装箱下标键值非对象）", () => {
    for (const src of [
      `export function f() { return Object.create(null, "x"); }`,
      `export function f() { return Object.create(null, "ab"); }`,
      `export function f() { return Object.create({ x: 1 }, "x"); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    // catch 吸收面：与原生 e.constructor.name 对齐
    const c = call(
      `export function f() { try { Object.create(null, "x"); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    );
    expect(litValue(c.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("数组字面量 props：非对象元素 → 定抛；混合（先装后坏元素）同抛", () => {
    for (const el of [`"x"`, "null", "undefined", "5", "true", "1n", "Symbol()"]) {
      const src = `export function f() { return Object.create(null, [${el}]); }`;
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    // [{value:9}, "x"]：原生在 "1" 处抛（"0" 先装但整体表达式抛出不可观测）
    const mixed = call(`export function f() { return Object.create(null, [{ value: 9 }, "x"]); }`);
    expect(isNever(mixed.result)).toBe(true);
    expect(throwsError(mixed.throws, "TypeError")).toBe(true);
    const c = call(
      `export function f() { try { Object.create(null, [null]); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    );
    expect(litValue(c.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("数组字面量 props：对象元素安装下标键（[{}] 落 \"0\"）", () => {
    // 空描述符/未知字段描述符：ToPropertyDescriptor 成功即定义键（值
    // undefined、flags 全 false）——"0" in o 原生 true，此前假 false
    expect(litValue(call(`export function f() { const o = Object.create(null, [{}]); return "0" in o; }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { const o = Object.create(null, [{ a: 1 }]); return "0" in o; }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return Object.create(null, [{ a: 1 }])[0]; }`).result))
      .toEqual({ ok: true, value: undefined });
    // value 描述符元素：数据属性安装
    expect(litValue(call(`export function f() { return Object.create(null, [{ value: 42 }])[0]; }`).result))
      .toEqual({ ok: true, value: 42 });
    // getter 描述符元素：键落（in true）；值读经计算下标 $idx 通道对
    // 访问器侧表保守 unknown（与 obj 臂 o["g"] 同口径，o.g 标识符读才
    // 走 $get 侧表派发——既有引擎面，非本 Bug 矩阵）
    const ge = call(`export function f() { const o = Object.create(null, [{ get() { return 42; } }]); return "0" in o; }`);
    expect(litValue(ge.result)).toEqual({ ok: true, value: true });
    // enumerable 元素进 keys 视图；空描述符（非枚举）不进
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, [{ value: 1, enumerable: true }, { value: 2, enumerable: true }])); }`).result))
      .toEqual(["0", "1"]);
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, [{}])); }`).result))
      .toEqual([]);
    // hole 位无键跳过（[,{}] 只装 "1"）
    expect(litValue(call(`export function f() { const o = Object.create(null, [, {}]); return "0" in o; }`).result))
      .toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { const o = Object.create(null, [, {}]); return "1" in o; }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("空串/空数组/装箱 prim props → 静默：不抛、零键安装", () => {
    for (const src of [
      `export function f() { return Object.create(null, ""); }`,
      `export function f() { return Object.create(null, []); }`,
      `export function f() { return Object.create(null, 5); }`,
      `export function f() { return Object.create(null, true); }`,
      `export function f() { return Object.create(null, 1n); }`,
      `export function f() { return Object.create(null, Symbol()); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(false);
      expect(isNever(r.throws), src).toBe(true);
    }
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, "")); }`).result))
      .toEqual([]);
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, [])); }`).result))
      .toEqual([]);
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, 5)); }`).result))
      .toEqual([]);
  });

  it("抽象 props → may TypeError（any / 抽象 string / 抽象数组 / 抽象元素）", () => {
    // any props（既有臂，控制组）
    expect(evalAbs(`export function f(p) { return Object.create(null, p); }`).effects)
      .toContain("TypeError");
    // 抽象 string（可能非空）→ may
    expect(evalAbs(`export function f(p) { return Object.create(null, p); }`, [str()]).effects)
      .toContain("TypeError");
    // 抽象数组（元素可能非对象）→ may
    const arrAbs = abs({ k: "arr", element: anyAbs }, undefined, undefined, "partial");
    expect(evalAbs(`export function f(p) { return Object.create(null, p); }`, [arrAbs]).effects)
      .toContain("TypeError");
    // 元素抽象（any）→ 逐元素 may
    expect(evalAbs(`export function f(p) { return Object.create(null, [p]); }`).effects)
      .toContain("TypeError");
    // 元素为抽象 string：任何字符串值都非对象 → 定抛
    const el = evalAbs(`export function f(p) { return Object.create(null, [p]); }`, [str()]);
    expect(isNever(el.result)).toBe(true);
    expect(throwsError(el.throws, "TypeError")).toBe(true);
  });
});

// --- 控制组：obj props 安装面（Bug 32 机器不回退） ---------------------------

describe("Bug 23 控制组: obj props 安装面", () => {
  it("value/getter/setter/writable/多键描述符", () => {
    expect(litValue(call(`export function f() { return Object.create(null, { y: { value: 2 } }).y; }`).result))
      .toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return Object.create(null, { g: { get() { return 42; } } }).g; }`).result))
      .toEqual({ ok: true, value: 42 });
    // setter-only：键落但不可枚举 → keys 视图空（node 实测）
    expect(strArr(call(`export function f() { return Object.keys(Object.create(null, { s: { set(v) {} } })); }`).result))
      .toEqual([]);
    const wb = call(
      `export function f() { const o = Object.create(null, { a: { value: 1, writable: false }, b: { value: 2 } }); return o.a + "," + o.b; }`,
    );
    expect(litValue(wb.result)).toEqual({ ok: true, value: "1,2" });
    // 空描述符也落键（值 undefined）——与数组元素面同机器
    expect(litValue(call(`export function f() { const o = Object.create(null, { a: {} }); return "a" in o; }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return Object.create(null, { a: {} }).a; }`).result))
      .toEqual({ ok: true, value: undefined });
  });
});

// --- 控制组：proto 面 --------------------------------------------------------

describe("Bug 23 控制组: proto 面", () => {
  it("null / 对象 proto 合法；字面量 proto 定抛（既有臂不回退）", () => {
    // null proto：nullProto 标记，Object.prototype 成员缺席
    const np = call(`export function f() { const o = Object.create(null); return "toString" in o; }`);
    expect(litValue(np.result)).toEqual({ ok: true, value: false });
    // 对象 proto：合法，缺槽读保守 unknown
    const op = call(`export function f() { return Object.create({ x: 1 }).x; }`);
    expect(kindOf(op.result)).toBe("unknown");
    expect(isNever(op.throws)).toBe(true);
    // 字面量 proto：定抛
    for (const src of [
      `export function f() { return Object.create(); }`,
      `export function f() { return Object.create(undefined); }`,
      `export function f() { return Object.create(5); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });
});
