/**
 * 类 A 值读/反射面回归（Bug 3/9/31/32/41/43/49/54/56/57）：
 * - Bug 3：字符串下标 s[n]（抽象字符串接收者）→ unknown（应 string|undefined）。
 * - Bug 9：函数值属性 f.name / f.length / f.prototype → unknown。
 * - Bug 31：Reflect.set/deleteProperty/defineProperty/setPrototypeOf/
 *   preventExtensions 五个 mutator 不修改接收者（错误具体值，静默）。
 * - Bug 32：Object.create(proto, descriptors) 双参数——descriptors 被整体忽略。
 * - Bug 41：Object.keys/values/entries/gOPN(Object.create(<obj>)) 假 may-throw
 *   （原生恒 total）。
 * - Bug 43：keys/values/entries 非字符串 prim / 内建 brand 接收者未分类
 *   （假精确 string[]/unknown[]）。
 * - Bug 49：prim 实例方法**值读**（"ab".trim / (1).toFixed）→ 静默 undefined /
 *   假 unknown（原生一等函数）；typeof / === undefined 面错误具体值。
 * - Bug 54：Symbol.<well-known> 常量读 → 假 unknown。
 * - Bug 56：X.prototype.<method> 值读 → undefined/unknown（级联 .call 借用
 *   never + 假 may-throw）；与 Bug 49 收敛为同一条「方法值读」通道。
 * - Bug 57：访问器属性对反射/枚举内建不可见（entries/values/gOPD/
 *   JSON.stringify 直接读占位数据槽，绕过 accessorTable thunk）。
 *
 * 原生 ground truth：node v26 实测对照。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  abs,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

/** formatAbs 渲染 + conf 后缀剥离（evalWithArgs.norm 同款） */
function fmt(a: unknown): string {
  return formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
}

/** 抽象 prim 实参调用：返回 { value, throws, effects } */
function evalWithArgs(
  src: string,
  args: unknown[],
  fnName = "f",
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

describe("Bug 3: 字符串下标（抽象字符串接收者）", () => {
  it("s[0] → string | undefined（与 s.at(n) 同域；字面量路径维持精确）", () => {
    const r = evalWithArgs(`export function f(s) { return s[0]; }`, [strAbs]);
    expect(r.value).toContain("string");
    expect(r.value).toContain("undefined");
    expect(r.effects).toEqual([]);
    expect(litValue(call(`export function f() { return "abc"[1]; }`).result)).toEqual({
      ok: true,
      value: "b",
    });
    // 越界字面量 → undefined（非 unknown）
    expect(litValue(call(`export function f() { return "abc"[9]; }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("Bug 9: 函数值属性 name / length / prototype", () => {
  it("声明名 / 形参数 / prototype 对象全部可判定", () => {
    expect(litValue(call(`export function f() { function g(a, b) { return a; } return g.name; }`).result))
      .toEqual({ ok: true, value: "g" });
    expect(litValue(call(`export function f() { function g(a, b) { return a; } return g.length; }`).result))
      .toEqual({ ok: true, value: 2 });
    // 非箭头函数恒有 prototype 对象（读其键得 undefined，非 unknown）
    const proto = call(`export function f() { function g() {} return g.prototype.x; }`);
    expect(litValue(proto.result)).toEqual({ ok: true, value: undefined });
  });

  it("箭头函数：无 prototype（undefined）；name 域 string", () => {
    expect(litValue(call(`export function f() { const g = () => 1; return g.prototype; }`).result))
      .toEqual({ ok: true, value: undefined });
    const r = call(`export function f() { const g = () => 1; return g.name; }`);
    expect(fmt(r.result)).toBe("string");
    // fn Abs 面（$fnVal 产物）：length 保守 number ≥ 0（含 var term/pred 渲染）
    const len = call(`export function f() { const g = (a, b) => a; return g.length; }`);
    expect(fmt(len.result)).toContain("number");
    expect(fmt(len.result)).toContain("≥ 0");
  });

  it("Object.prototype 方法在函数值上一等可读（typeof f.toString）", () => {
    const r = call(`export function f() { function g() {} return typeof g.toString; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });
});

describe("Bug 31: Reflect 五个 mutator 修改接收者", () => {
  it("set / deleteProperty / defineProperty / setPrototypeOf / preventExtensions", () => {
    expect(litValue(call(`export function f() { const o = {}; Reflect.set(o, "a", 1); return o.a; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { const o = { a: 1 }; Reflect.deleteProperty(o, "a"); return o.a; }`).result))
      .toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { const o = {}; Reflect.defineProperty(o, "a", { value: 1 }); return o.a; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { const o = {}; Reflect.setPrototypeOf(o, null); return Object.getPrototypeOf(o) === null; }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { const o = {}; Reflect.preventExtensions(o); return Object.isExtensible(o); }`).result))
      .toEqual({ ok: true, value: false });
  });

  it("返回值照原生 boolean；定 false 形态（frozen / 非 writable）不假抛", () => {
    expect(litValue(call(`export function f() { const o = {}; return Reflect.set(o, "a", 1); }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { const o = {}; return Reflect.preventExtensions(o); }`).result))
      .toEqual({ ok: true, value: true });
    const frozenSet = call(`export function f() { const o = Object.freeze({}); return Reflect.set(o, "a", 1); }`);
    expect(litValue(frozenSet.result)).toEqual({ ok: true, value: false });
    expect(fmt(frozenSet.throws)).toBe("never");
    // setPrototypeOf 返回 boolean（非 Object.* 的接收者）
    expect(litValue(call(`export function f() { const o = {}; return Reflect.setPrototypeOf(o, null); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("数组接收者：Reflect.set 写下标元素", () => {
    const r = call(`export function f() { const a = [1, 2]; Reflect.set(a, 0, 9); return a[0]; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });
});

describe("Bug 32: Object.create(proto, descriptors)", () => {
  it("descriptors 安装为自有属性（null-proto 与 obj-proto 双变体）", () => {
    expect(litValue(call(`export function f() { return Object.create(null, { y: { value: 2 } }).y; }`).result))
      .toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return Object.create({ x: 1 }, { y: { value: 2 } }).y; }`).result))
      .toEqual({ ok: true, value: 2 });
    // enumerable 键进 keys 视图；enumerable:false 不进
    expect(fmt(call(`export function f() { return Object.keys(Object.create(null, { a: { value: 1, enumerable: true }, b: { value: 2 } })); }`).result))
      .toBe('["a"]');
  });

  it("nullish descriptors → 定抛；prim descriptors 装箱零键不抛（node 实测）", () => {
    const r = call(`export function f() { return Object.create(null, null); }`);
    expect(litValue(r.result)).toEqual({ ok: false, value: undefined });
    expect(fmt(r.throws)).toContain("TypeError");
    // ToObject(5) → Number 包装器，零可枚举自有键 → 无属性安装、不抛
    const prim = call(`export function f() { return Object.keys(Object.create(null, 5)); }`);
    expect(fmt(prim.result)).toBe("[]");
    expect(fmt(prim.throws)).toBe("never");
  });
});

describe("Bug 41: keys 家族对 Object.create(<obj>) 恒 total", () => {
  it("无假 may-throw；keys/values/entries 精确 []", () => {
    for (const src of [
      `export function f() { return Object.keys(Object.create({ a: 1 })); }`,
      `export function f() { return Object.values(Object.create({ a: 1 })); }`,
      `export function f() { return Object.entries(Object.create({ a: 1 })); }`,
    ]) {
      const r = call(src);
      expect(fmt(r.result)).toBe("[]");
      expect(fmt(r.throws)).toBe("never");
    }
    const gopn = call(`export function f() { return Object.getOwnPropertyNames(Object.create({ a: 1 })); }`);
    expect(fmt(gopn.throws)).toBe("never"); // 假 throw 消除（值域 string[] 保守）
    expect(fmt(gopn.result)).toBe("string[]");
  });

  it("obj-proto 原型读保持保守（不折假 undefined——nullproto pin 兼容）", () => {
    const r = call(`export function f() { return Object.create({ x: 1 }).x; }`);
    expect(fmt(r.result)).toBe("unknown");
  });
});

describe("Bug 43: keys/values/entries 接收者分类", () => {
  it("非字符串 prim（bool/bigint/symbol 字面量 + 抽象 number）→ []", () => {
    for (const recv of ["true", "1n", 'Symbol("d")']) {
      const r = call(`export function f() { return Object.keys(${recv}); }`);
      expect(fmt(r.result)).toBe("[]");
    }
    const abstractNum = evalWithArgs(`export function f(x) { return Object.keys(x); }`, [numAbs]);
    expect(abstractNum.value).toBe("[]");
    expect(abstractNum.effects).toEqual([]);
    const abstractVals = evalWithArgs(`export function f(x) { return Object.values(x); }`, [numAbs]);
    expect(abstractVals.value).toBe("[]");
  });

  it("抽象 string prim：values → string[]；entries → [string, string][]", () => {
    const vals = evalWithArgs(`export function f(s) { return Object.values(s); }`, [strAbs]);
    expect(vals.value).toBe("string[]");
    const entries = evalWithArgs(`export function f(s) { return Object.entries(s); }`, [strAbs]);
    expect(entries.value).toBe("[string, string][]");
  });

  it("内建 brand：Map → []；boxed String → 下标键（gOPN 含 length）", () => {
    expect(fmt(call(`export function f() { return Object.keys(new Map()); }`).result)).toBe("[]");
    expect(fmt(call(`export function f() { return Object.keys(new String("ab")); }`).result))
      .toBe('["0", "1"]');
    expect(fmt(call(`export function f() { return Object.values(new String("ab")); }`).result))
      .toBe('["a", "b"]');
    expect(fmt(call(`export function f() { return Object.getOwnPropertyNames(new String("ab")); }`).result))
      .toBe('["0", "1", "length"]');
  });
});

describe("Bug 49: prim 实例方法值读（方法值读通道）", () => {
  it("字符串方法：typeof 折 function；=== undefined 折 false（不再静默 undef）", () => {
    for (const m of ["trim", "charAt", "indexOf", "split", "padStart", "bold", "replace"]) {
      const r = call(`export function f() { return typeof "ab".${m}; }`);
      expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
    }
    expect(litValue(call(`export function f() { return "ab".trim === undefined; }`).result))
      .toEqual({ ok: true, value: false });
  });

  it("Number/BigInt 方法与抽象接收者同臂", () => {
    expect(litValue(call(`export function f() { return typeof (1).toFixed; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f() { return typeof (1n).toString; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(evalWithArgs(`export function f(s) { return typeof s.trim; }`, [strAbs]).value)
      .toBe(`"function"`);
    expect(evalWithArgs(`export function f(s) { return s.trim === undefined; }`, [strAbs]).value)
      .toBe("false");
  });

  it("确定缺失键仍折 undefined（s.foo 原生无此属性）", () => {
    expect(litValue(call(`export function f() { return "ab".nonexistentKey; }`).result))
      .toEqual({ ok: true, value: undefined });
  });

  it("借用调用折既有派发（值读产物带 apply 钩子）", () => {
    const r = call(`export function f() { const t = "ab".trim; return t.call("  x  "); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });
});

describe("Bug 54: Symbol.<well-known> 常量读", () => {
  it("值域 symbol；=== 恒等折 true；description 精确", () => {
    const r = call(`export function f() { return typeof Symbol.iterator; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "symbol" });
    expect(litValue(call(`export function f() { return Symbol.iterator === Symbol.iterator; }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return Symbol.iterator.description; }`).result))
      .toEqual({ ok: true, value: "Symbol.iterator" });
    expect(litValue(call(`export function f() { return String(Symbol.iterator); }`).result))
      .toEqual({ ok: true, value: "Symbol(Symbol.iterator)" });
    for (const s of ["asyncIterator", "toStringTag", "hasInstance", "match", "replace", "search", "split", "species", "toPrimitive", "unscopables", "isConcatSpreadable", "dispose"]) {
      expect(litValue(call(`export function f() { return typeof Symbol.${s}; }`).result))
        .toEqual({ ok: true, value: "symbol" });
    }
  });
});

describe("Bug 56: X.prototype.<method> 值读 + 借用调用（与 49 同通道）", () => {
  it("typeof 面折 function（不再 undefined/unknown）", () => {
    for (const src of [
      `typeof Array.prototype.slice`,
      `typeof Array.prototype.push`,
      `typeof String.prototype.charAt`,
      `typeof Number.prototype.toFixed`,
      `typeof Date.prototype.getTime`,
      `typeof RegExp.prototype.exec`,
      `typeof Map.prototype.has`,
      `typeof WeakMap.prototype.get`,
    ]) {
      const r = call(`export function f() { return ${src}; }`);
      expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
    }
  });

  it(".call 借用折既有派发（不再 never + 假 may-throw）", () => {
    expect(fmt(call(`export function f() { return Array.prototype.slice.call("abc"); }`).result))
      .toBe('["a", "b", "c"]');
    expect(fmt(call(`export function f() { return Array.prototype.slice.call("abc", 1); }`).result))
      .toBe('["b", "c"]');
    expect(fmt(call(`export function f() { return Array.prototype.map.call([1, 2, 3], (x) => x * 2); }`).result))
      .toBe("[2, 4, 6]");
    expect(fmt(call(`export function f() { return Array.prototype.concat.call([1], [2]); }`).result))
      .toBe("[1, 2]");
    expect(litValue(call(`export function f() { return Array.prototype.indexOf.call([1, 2, 3], 2); }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(fmt(call(`export function f() { return Array.prototype.slice.call({ 0: "a", 1: "b", length: 2 }); }`).result))
      .toBe('["a", "b"]');
    expect(litValue(call(`export function f() { return Number.prototype.toString.call(255); }`).result))
      .toEqual({ ok: true, value: "255" });
    expect(litValue(call(`export function f() { return Number.prototype.toFixed.call(1.5, 2); }`).result))
      .toEqual({ ok: true, value: "1.50" });
    expect(litValue(call(`export function f() { return String.prototype.slice.call("abc", 1); }`).result))
      .toEqual({ ok: true, value: "bc" });
    expect(litValue(call(`export function f() { return Map.prototype.has.call(new Map([["a", 1]]), "a"); }`).result))
      .toEqual({ ok: true, value: true });
    // Array 三键既有精确面不回归
    expect(litValue(call(`export function f() { return Array.prototype.join.call([1, 2], "-"); }`).result))
      .toEqual({ ok: true, value: "1-2" });
  });

  it("RegExp.prototype.exec 借用不再假抛", () => {
    const r = call(`export function f() { return RegExp.prototype.exec.call(/a/, "abc")[0]; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "a" });
    expect(fmt(r.throws)).toBe("never");
  });
});

describe("Bug 57: 访问器属性对反射/枚举内建可见（readProperty 收口）", () => {
  it("Object.entries / Object.values 经 getter 求值", () => {
    expect(fmt(call(`export function f() { return Object.entries({ get a() { return 1; } }); }`).result))
      .toBe('[["a", 1]]');
    expect(fmt(call(`export function f() { return Object.values({ get a() { return 1; } }); }`).result))
      .toBe("[1]");
    expect(fmt(call(`export function f() { return Object.entries({ a: 1, get b() { return 2; } }); }`).result))
      .toBe('[["a", 1], ["b", 2]]');
  });

  it("JSON.stringify 调用 getter（键不丢；defineProperty 变体假 may-throw 消除）", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({ get a() { return 1; } }); }`).result))
      .toEqual({ ok: true, value: `{"a":1}` });
    expect(litValue(call(`export function f() { return JSON.stringify({ get a() { return 1; }, b: 2 }); }`).result))
      .toEqual({ ok: true, value: `{"a":1,"b":2}` });
    const defProp = call(
      `export function f() { const o = {}; Object.defineProperty(o, "a", { get() { return 1; }, enumerable: true }); return JSON.stringify(o); }`,
    );
    expect(litValue(defProp.result)).toEqual({ ok: true, value: `{"a":1}` });
    expect(fmt(defProp.throws)).toBe("never");
  });

  it("gOPD 访问器描述符 {get, set, enumerable, configurable}（无 value/writable）", () => {
    const d = call(`export function f() { return Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a"); }`);
    expect(fmt(d.result)).toContain("get"); // 访问器描述符对象（含 get/set 槽）
    const getFn = call(`export function f() { return typeof Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a").get; }`);
    expect(litValue(getFn.result)).toEqual({ ok: true, value: "function" });
    const noVal = call(`export function f() { return Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a").value; }`);
    expect(litValue(noVal.result)).toEqual({ ok: true, value: undefined });
    const enumr = call(`export function f() { return Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a").enumerable; }`);
    expect(litValue(enumr.result)).toEqual({ ok: true, value: true });
    const setFn = call(`export function f() { return typeof Object.getOwnPropertyDescriptor({ set a(v) {} }, "a").set; }`);
    expect(litValue(setFn.result)).toEqual({ ok: true, value: "function" });
    // 描述符 getter 可调用求值
    const invoked = call(`export function f() { return Object.getOwnPropertyDescriptor({ get a() { return 7; } }, "a").get(); }`);
    expect(litValue(invoked.result)).toEqual({ ok: true, value: 7 });
  });

  it("直接读 / 展开面不回归；setter-only 枚举读 undefined（原生一致）", () => {
    expect(litValue(call(`export function f() { return { get a() { return 1; } }.a; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(fmt(call(`export function f() { return Object.entries({ set a(v) {} }); }`).result))
      .toBe('[["a", undefined]]');
  });

  it("for-in boxed String brand：length 槽排除（原生只枚举下标键）", () => {
    const r = call(`export function f() { const ks = []; for (const k in new String("ab")) { ks.push(k); } return ks; }`);
    expect(fmt(r.result)).toBe('["0", "1"]');
  });
});
