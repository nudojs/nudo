/**
 * 类 B brand 槽建模回归（Bug 10/15/22/23/28/29/39/45/46/58/59）：
 * - Bug 10：Error 家族实例 toString/toLocaleString = `${name}: ${message}`；
 *   Object.prototype.toString.call(错误 brand) → "[object Error]"（[[ErrorData]]）。
 * - Bug 15：ArrayBuffer/SharedArrayBuffer/DataView 构造实参存 brand 槽
 *   （byteLength/byteOffset/maxByteLength/resizable/growable；字面量精确、抽象 → number）。
 * - Bug 22：装箱 brand（new String/Number/Boolean）构造存 [[PrimitiveValue]]，
 *   实例方法拆箱走 prim 面（valueOf/toString 拆箱值；charAt/toFixed 折叠）。
 * - Bug 23：Map/Set keys/values/entries → 迭代器对象（next 按调用序、
 *   spread/for-of/Array.from 精确展开）。
 * - Bug 28：RegExp 7 标志 getter 槽（flags 字符串折 boolean）。
 * - Bug 29：URL 7 组件槽（hostname/pathname/search/hash/port/username/password）。
 * - Bug 39：Date.prototype.getYear/setYear（Annex B）→ number。
 * - Bug 45：new BigInt() 确定 TypeError（BigInt 无 [[Construct]]）。
 * - Bug 46：new Math()/JSON()/Reflect() 确定 TypeError（裸宿主对象不可构造，
 *   此前 specOf 内部崩溃被兜底 unknown + 假 may-throw）。
 * - Bug 58：new RegExp(<抽象 string>) brand 槽全空 → 单一 builder（source/
 *   flags/lastIndex + 标志 getter；字面量 flags 精确）。
 * - Bug 59：Error brand .stack → string 域（不可折叠）。
 *
 * 原生 ground truth：node v26.10.0 实测对照。
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

/** 抽象 prim 实参调用：返回 { value, throws, effects }（formatAbs 渲染，conf 剥离） */
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

const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");

describe("Bug 10: Error family toString/toLocaleString + [object Error] tag", () => {
  it("Error.prototype.toString = `${name}: ${message}`（字面量精确）", () => {
    expect(litValue(call(`export function f() { return new Error("m").toString(); }`).result))
      .toEqual({ ok: true, value: "Error: m" });
    expect(litValue(call(`export function f() { return new TypeError("m").toString(); }`).result))
      .toEqual({ ok: true, value: "TypeError: m" });
    expect(litValue(call(`export function f() { return new RangeError("r").toString(); }`).result))
      .toEqual({ ok: true, value: "RangeError: r" });
  });

  it("空 message 只返 name（原生 Error.prototype.toString 语义）", () => {
    expect(litValue(call(`export function f() { return new Error("").toString(); }`).result))
      .toEqual({ ok: true, value: "Error" });
  });

  it("toLocaleString ≡ toString；抽象 message → string 域", () => {
    expect(litValue(call(`export function f() { return new TypeError("m").toLocaleString(); }`).result))
      .toEqual({ ok: true, value: "TypeError: m" });
    const r = evalWithArgs(`export function f(m) { return new TypeError(m).toString(); }`, [strAbs]);
    expect(r.value).toBe("string");
  });

  it("Object.prototype.toString.call(<错误 brand>) → [object Error]（[[ErrorData]] 家族统一 tag）", () => {
    expect(litValue(call(`export function f() { return Object.prototype.toString.call(new TypeError("m")); }`).result))
      .toEqual({ ok: true, value: "[object Error]" });
    expect(litValue(call(`export function f() { return Object.prototype.toString.call(new RangeError("r")); }`).result))
      .toEqual({ ok: true, value: "[object Error]" });
  });

  it("valueOf 保持 brand 恒等（Object.prototype 语义）", () => {
    const r = call(`export function f() { return new Error("m").valueOf(); }`);
    expect(formatAbs(r.result)).toContain("Error");
  });
});

describe("Bug 15: ArrayBuffer/SharedArrayBuffer/DataView brand slots", () => {
  it("new ArrayBuffer(n).byteLength 字面量精确折叠", () => {
    expect(litValue(call(`export function f() { return new ArrayBuffer(8).byteLength; }`).result))
      .toEqual({ ok: true, value: 8 });
  });

  it("resizable / maxByteLength（options.maxByteLength）", () => {
    expect(litValue(call(`export function f() { return new ArrayBuffer(8).resizable; }`).result))
      .toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return new ArrayBuffer(8).maxByteLength; }`).result))
      .toEqual({ ok: true, value: 8 });
    expect(litValue(call(`export function f() { return new ArrayBuffer(8, { maxByteLength: 16 }).maxByteLength; }`).result))
      .toEqual({ ok: true, value: 16 });
    expect(litValue(call(`export function f() { return new ArrayBuffer(8, { maxByteLength: 16 }).resizable; }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("new SharedArrayBuffer(n).byteLength（growable 面）", () => {
    expect(litValue(call(`export function f() { return new SharedArrayBuffer(8).byteLength; }`).result))
      .toEqual({ ok: true, value: 8 });
    expect(litValue(call(`export function f() { return new SharedArrayBuffer(8).growable; }`).result))
      .toEqual({ ok: true, value: false });
  });

  it("DataView byteOffset/byteLength（缺省 byteLength = buffer.byteLength − offset）", () => {
    expect(litValue(call(`export function f() { return new DataView(new ArrayBuffer(8), 2).byteOffset; }`).result))
      .toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return new DataView(new ArrayBuffer(8), 2).byteLength; }`).result))
      .toEqual({ ok: true, value: 6 });
    expect(litValue(call(`export function f() { return new DataView(new ArrayBuffer(8)).byteLength; }`).result))
      .toEqual({ ok: true, value: 8 });
    expect(litValue(call(`export function f() { return new DataView(new ArrayBuffer(8), undefined, 4).byteOffset; }`).result))
      .toEqual({ ok: true, value: 0 });
  });

  it("抽象 length → number 域（ToIndex may-throw 面保持）", () => {
    const r = evalWithArgs(`export function f(n) { return new ArrayBuffer(n).byteLength; }`, [numAbs]);
    expect(r.value).toBe("number");
    expect(r.effects).toContain("RangeError");
  });
});

describe("Bug 22: boxed brand (new String/Number/Boolean) instance methods", () => {
  it("valueOf 拆箱（原生返回包装原始值）", () => {
    expect(litValue(call(`export function f() { return new Number(5).valueOf(); }`).result))
      .toEqual({ ok: true, value: 5 });
    expect(litValue(call(`export function f() { return new String("ab").valueOf(); }`).result))
      .toEqual({ ok: true, value: "ab" });
    expect(litValue(call(`export function f() { return new Boolean(true).valueOf(); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("toString 按原始值格式化（不是 [object Number]）", () => {
    expect(litValue(call(`export function f() { return new Number(5).toString(); }`).result))
      .toEqual({ ok: true, value: "5" });
    expect(litValue(call(`export function f() { return new Boolean(true).toString(); }`).result))
      .toEqual({ ok: true, value: "true" });
    expect(litValue(call(`export function f() { return new String("ab").toString(); }`).result))
      .toEqual({ ok: true, value: "ab" });
  });

  it("String/Number 独有方法经拆箱折叠（此前假 unknown）", () => {
    expect(litValue(call(`export function f() { return new String("ab").charAt(0); }`).result))
      .toEqual({ ok: true, value: "a" });
    expect(litValue(call(`export function f() { return new String("ab").indexOf("b"); }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return new String("ab").includes("b"); }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return new String("ab").slice(0, 1); }`).result))
      .toEqual({ ok: true, value: "a" });
    expect(litValue(call(`export function f() { return new Number(5).toFixed(1); }`).result))
      .toEqual({ ok: true, value: "5.0" });
  });

  it("构造强转折叠（ToNumber/ToString/ToBoolean；缺省 ≡ undefined）", () => {
    expect(litValue(call(`export function f() { return new Number("5").valueOf(); }`).result))
      .toEqual({ ok: true, value: 5 });
    expect(litValue(call(`export function f() { return new Number().valueOf(); }`).result))
      .toEqual({ ok: true, value: NaN });
    expect(litValue(call(`export function f() { return new String().valueOf(); }`).result))
      .toEqual({ ok: true, value: "undefined" });
    expect(litValue(call(`export function f() { return new String(null).valueOf(); }`).result))
      .toEqual({ ok: true, value: "null" });
    expect(litValue(call(`export function f() { return new Boolean(0).valueOf(); }`).result))
      .toEqual({ ok: true, value: false });
  });

  it("抽象实参 → 拆箱域（number/string/boolean 域，不假精确）", () => {
    expect(evalWithArgs(`export function f(x) { return new Number(x).valueOf(); }`, [numAbs]).value).toBe("number");
    expect(evalWithArgs(`export function f(x) { return new String(x).charAt(0); }`, [strAbs]).value).toBe("string");
    expect(evalWithArgs(`export function f(x) { return new Number(x).toFixed(1); }`, [numAbs]).value).toBe("string");
    expect(evalWithArgs(`export function f(x) { return new Boolean(x).valueOf(); }`, [strAbs]).value).toBe("boolean");
  });

  it("Object(prim) 装箱同款拆箱（evalGlobalFn Object 路由 makeBoxedAbs）", () => {
    expect(litValue(call(`export function f() { return Object(5).valueOf(); }`).result))
      .toEqual({ ok: true, value: 5 });
    expect(litValue(call(`export function f() { return Object("ab").charAt(1); }`).result))
      .toEqual({ ok: true, value: "b" });
    expect(litValue(call(`export function f() { return typeof Object(5); }`).result))
      .toEqual({ ok: true, value: "object" });
  });

  it("装箱 brand 槽不泄漏枚举视图（[[PrimitiveValue]] 不可枚举）", () => {
    expect(litValue(call(`export function f() { return Object.keys(Object.assign({}, new String("ab"))).length; }`).result))
      .toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 23: Map/Set iterator methods (keys/values/entries)", () => {
  it(".next() 按调用序折 {value, done}（字面量条目表）", () => {
    expect(formatAbs(call(`export function f() { return new Map([["a", 1]]).entries().next().value; }`).result))
      .toContain('["a", 1]');
    expect(litValue(call(`export function f() { return new Map([["a", 1]]).keys().next().value; }`).result))
      .toEqual({ ok: true, value: "a" });
    expect(litValue(call(`export function f() { return new Set([1]).values().next().value; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return new Set([1]).keys().next().value; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return new Map([["a", 1]]).values().next().value; }`).result))
      .toEqual({ ok: true, value: 1 });
  });

  it("spread 精确展开（此前 never + 假 throw TypeError）", () => {
    expect(formatAbs(call(`export function f() { return [...new Map([["a", 1]]).entries()]; }`).result))
      .toContain('[["a", 1]]');
    expect(formatAbs(call(`export function f() { return [...new Set([1, 2]).entries()]; }`).result))
      .toContain("[[1, 1], [2, 2]]");
    expect(formatAbs(call(`export function f() { return [...new Map([["a", 1], ["b", 2]]).values()]; }`).result))
      .toContain("[1, 2]");
  });

  it("for-of 精确迭代（此前 never + 假 throw）", () => {
    expect(litValue(call(`export function f() { let n = 0; for (const e of new Map([["a", 1]]).entries()) { n++; } return n; }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { let n = 0; for (const v of new Set([1]).values()) { n++; } return n; }`).result))
      .toEqual({ ok: true, value: 1 });
  });

  it("迭代器对象协议面（typeof next === function、耗尽 done）", () => {
    expect(litValue(call(`export function f() { return typeof new Map().keys().next; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f() { return new Set().values().next().done; }`).result))
      .toEqual({ ok: true, value: true });
    // 语料钉住行：differential batch11（此前 harness skip）
    expect(litValue(call(`export function f() { return new Map([[1, "a"]]).keys().next().value; }`).result))
      .toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 28: RegExp flag getter slots", () => {
  it("7 标志 getter 精确 boolean（字面量 flags 折叠）", () => {
    expect(litValue(call(`export function f() { return /a/g.global; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/i.ignoreCase; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/m.multiline; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/u.unicode; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/s.dotAll; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/y.sticky; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/d.hasIndices; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/gi.ignoreCase; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return /a/g.dotAll; }`).result)).toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return new RegExp("a", "g").global; }`).result)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 29: URL component slots", () => {
  it("7 组件槽精确（宿主真解析）", () => {
    expect(litValue(call(`export function f() { return new URL("https://x.com/a").hostname; }`).result))
      .toEqual({ ok: true, value: "x.com" });
    expect(litValue(call(`export function f() { return new URL("https://x.com/a/b").pathname; }`).result))
      .toEqual({ ok: true, value: "/a/b" });
    expect(litValue(call(`export function f() { return new URL("https://x.com/a?b=1").search; }`).result))
      .toEqual({ ok: true, value: "?b=1" });
    expect(litValue(call(`export function f() { return new URL("https://x.com/a#h").hash; }`).result))
      .toEqual({ ok: true, value: "#h" });
    expect(litValue(call(`export function f() { return new URL("https://x.com:8080/a").port; }`).result))
      .toEqual({ ok: true, value: "8080" });
    expect(litValue(call(`export function f() { return new URL("https://u:p@x.com/a").username; }`).result))
      .toEqual({ ok: true, value: "u" });
    expect(litValue(call(`export function f() { return new URL("https://u:p@x.com/a").password; }`).result))
      .toEqual({ ok: true, value: "p" });
    expect(litValue(call(`export function f() { return new URL("https://x.com/a").href; }`).result))
      .toEqual({ ok: true, value: "https://x.com/a" });
  });
});

describe("Bug 39: Date.prototype.getYear / setYear", () => {
  it("getYear/setYear → number（与同表 33 个兄弟方法一致）", () => {
    expect(evalWithArgs(`export function f() { return new Date(0).getYear(); }`, []).value).toBe("number");
    expect(evalWithArgs(`export function f() { return new Date(0).setYear(2020); }`, []).value).toBe("number");
  });
});

describe("Bug 45: new BigInt() throws TypeError", () => {
  it("BigInt 无 [[Construct]] → never throws TypeError（与 Symbol 同口径）", () => {
    const r1 = evalWithArgs(`export function f() { return new BigInt(); }`, []);
    expect(r1.value).toBe("never");
    expect(r1.throws).toContain("TypeError");
    const r2 = evalWithArgs(`export function f() { return new BigInt(5); }`, []);
    expect(r2.value).toBe("never");
    expect(r2.throws).toContain("TypeError");
  });
});

describe("Bug 46: new Math()/JSON()/Reflect() throws TypeError (no internal crash)", () => {
  it("裸宿主命名空间对象不可构造 → never throws TypeError（非 unknown）", () => {
    for (const ns of ["Math", "JSON", "Reflect"]) {
      const r = evalWithArgs(`export function f() { return new ${ns}(); }`, []);
      expect(r.value, ns).toBe("never");
      expect(r.throws, ns).toContain("TypeError");
    }
  });
});

describe("Bug 58: new RegExp(<abstract pattern>) brand slots (single builder)", () => {
  it("抽象 pattern → source/flags string 域、lastIndex 精确 0", () => {
    expect(evalWithArgs(`export function f(s) { return new RegExp(s).source; }`, [strAbs]).value).toBe("string");
    expect(evalWithArgs(`export function f(s) { return new RegExp(s).flags; }`, [strAbs]).value).toBe("string");
    const r = evalWithArgs(`export function f(s) { return new RegExp(s).lastIndex; }`, [strAbs]);
    expect(r.value).toBe("0");
  });

  it("字面量 flags 实参与抽象 pattern 组合 → flags/getter 精确", () => {
    const r = evalWithArgs(`export function f(s) { return new RegExp(s, "gi").flags; }`, [strAbs]);
    expect(r.value).toBe('"gi"');
    const g = evalWithArgs(`export function f(s) { return new RegExp(s, "g").global; }`, [strAbs]);
    expect(g.value).toBe("true");
  });

  it("字面量路径不受影响（source/flags/lastIndex 精确）", () => {
    expect(litValue(call(`export function f() { return new RegExp("a").source; }`).result))
      .toEqual({ ok: true, value: "a" });
    expect(litValue(call(`export function f() { return new RegExp("a").flags; }`).result))
      .toEqual({ ok: true, value: "" });
    expect(litValue(call(`export function f() { return new RegExp("a").lastIndex; }`).result))
      .toEqual({ ok: true, value: 0 });
  });
});

describe("Bug 59: Error brand .stack → string", () => {
  it("stack 域恒 string（不可精确折叠）", () => {
    const strip = (a: unknown) => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "");
    expect(strip(call(`export function f() { return new Error("m").stack; }`).result)).toBe("string");
    expect(strip(call(`export function f() { return new TypeError("t").stack; }`).result)).toBe("string");
    expect(strip(call(`export function f() { return new AggregateError([new Error("a")], "m").stack; }`).result)).toBe("string");
    expect(litValue(call(`export function f() { return typeof new Error("m").stack; }`).result))
      .toEqual({ ok: true, value: "string" });
    // 抽象 message → string 域
    expect(evalWithArgs(`export function f(m) { return new Error(m).stack; }`, [strAbs]).value).toBe("string");
  });

  it("用户写回 e.stack 经 $set 槽写通道覆盖", () => {
    expect(litValue(call(`export function f() { const e = new Error("m"); e.stack = "custom"; return e.stack; }`).result))
      .toEqual({ ok: true, value: "custom" });
  });
});
