/**
 * 类 A 调用位派发缺口回归（Bug 1/2/5/7/8/11/12/24/26/38/50/51/55）：
 * - Bug 1：Number.isSafeInteger 缺 case → unknown（env 声明被硬编码表遮蔽）。
 * - Bug 2：抽象字符串接收者 search/match/matchAll 派发表缺臂 → unknown。
 * - Bug 5：宿主全局 encodeURIComponent 等 8 个（抽象 string 实参）→ unknown。
 * - Bug 7：Date.parse / Date.UTC 静态缺 case → unknown（含全字面量）。
 * - Bug 8：Object.defineProperties / getOwnPropertyDescriptors 缺 case → unknown。
 * - Bug 11：trimLeft/trimRight（ES2019 别名）→ 假 unknown + 假 may-throw。
 * - Bug 12：String.raw 标签模板 → unknown。
 * - Bug 24：Array.fromAsync / Promise.withResolvers / URL.canParse → unknown。
 * - Bug 26：宿主全局函数值的一等公民面（return parseInt / map(Number) /
 *   .call / obj 槽 / then 回调）→ unknown。
 * - Bug 38：字符串 pattern 的 match/search/matchAll（字面量接收者）→ unknown
 *  （语料 batch1.ts:48,50 钉住却静默漏网）。
 * - Bug 50：s.at(n) 抽象接收者缺 undefined 臂（欠近似）。
 * - Bug 51：Array.from(<obj>) array-like 索引槽不读 + 非具体 length →
 *   假 unknown / 错误值 undefined[]。
 * - Bug 55：Annex B HTML 字符串方法（bold/anchor/…）→ 假 unknown。
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

/** formatAbs 渲染 + conf 后缀剥离（evalWithArgs.norm 同款） */
function fmt(a: unknown): string {
  return formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
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

describe("Bug 1: Number.isSafeInteger", () => {
  it("字面量精确折叠（与 isInteger 同族同款）", () => {
    expect(litValue(call(`export function f() { return Number.isSafeInteger(1); }`).result))
      .toEqual({ ok: true, value: true });
    expect(
      litValue(call(`export function f() { return Number.isSafeInteger(Number.MAX_SAFE_INTEGER + 1); }`).result),
    ).toEqual({ ok: true, value: false });
  });

  it("非 number 实参恒 false；抽象实参 → boolean", () => {
    expect(litValue(call(`export function f() { return Number.isSafeInteger("5"); }`).result))
      .toEqual({ ok: true, value: false });
    expect(litValue(call(`export function f() { return Number.isSafeInteger(); }`).result))
      .toEqual({ ok: true, value: false });
    const r = evalWithArgs(`export function f(n) { return Number.isSafeInteger(n); }`, [numAbs]);
    expect(r.value).toBe("boolean");
    expect(r.effects).toEqual([]);
  });
});

describe("Bug 2: 抽象字符串接收者 search/match/matchAll", () => {
  it("search → number（值域与接收者具体性无关）", () => {
    const r = evalWithArgs(`export function f(s) { return s.search(/a/); }`, [strAbs]);
    expect(r.value).toBe("number");
    expect(r.effects).toEqual([]);
  });

  it("match → null | 匹配数组（保守并，与 execRegexBrand 抽象 subject 臂同域）", () => {
    const r = evalWithArgs(`export function f(s) { return s.match(/a/); }`, [strAbs]);
    expect(r.value).toContain("null");
    expect(r.value).toContain("[]");
  });

  it("matchAll：/g → RegExpMatchIterator；无 g → 定抛 TypeError", () => {
    const ok = evalWithArgs(`export function f(s) { return s.matchAll(/a/g); }`, [strAbs]);
    expect(ok.value).toBe("RegExpMatchIterator");
    const bad = evalWithArgs(`export function f(s) { return s.matchAll(/a/); }`, [strAbs]);
    expect(bad.value).toBe("never");
    expect(bad.throws).toContain("TypeError");
  });

  it("模板接收者同臂（模板段派发）", () => {
    const r = evalWithArgs(`export function f(s) { return \`x\${s}\`.search(/a/); }`, [strAbs]);
    expect(r.value).toBe("number");
  });
});

describe("Bug 5: 宿主全局 URI/escape 族（抽象 string 实参）", () => {
  it("值域恒 string（env 声明 prim.str()→prim.str() 不再被遮蔽）", () => {
    for (const g of [
      "encodeURIComponent",
      "decodeURIComponent",
      "encodeURI",
      "decodeURI",
      "btoa",
      "atob",
      "escape",
      "unescape",
    ]) {
      const r = evalWithArgs(`export function f(s) { return ${g}(s); }`, [strAbs]);
      expect(r.value, g).toBe("string");
    }
  });

  it("may-throw 面按函数记：decode* URIError、btoa/atob InvalidCharacterError、encode*/escape* total", () => {
    expect(evalWithArgs(`export function f(s) { return decodeURIComponent(s); }`, [strAbs]).effects)
      .toEqual(["URIError"]);
    expect(evalWithArgs(`export function f(s) { return decodeURI(s); }`, [strAbs]).effects)
      .toEqual(["URIError"]);
    expect(evalWithArgs(`export function f(s) { return btoa(s); }`, [strAbs]).effects)
      .toEqual(["InvalidCharacterError"]);
    expect(evalWithArgs(`export function f(s) { return atob(s); }`, [strAbs]).effects)
      .toEqual(["InvalidCharacterError"]);
    expect(evalWithArgs(`export function f(s) { return encodeURIComponent(s); }`, [strAbs]).effects)
      .toEqual([]);
    expect(evalWithArgs(`export function f(s) { return encodeURI(s); }`, [strAbs]).effects)
      .toEqual([]);
    expect(evalWithArgs(`export function f(s) { return escape(s); }`, [strAbs]).effects)
      .toEqual([]);
    expect(evalWithArgs(`export function f(s) { return unescape(s); }`, [strAbs]).effects)
      .toEqual([]);
  });

  it("字面量实参精确折叠；非法字面量定抛进 throws 域", () => {
    expect(litValue(call(`export function f() { return encodeURIComponent("a b"); }`).result))
      .toEqual({ ok: true, value: "a%20b" });
    expect(litValue(call(`export function f() { return unescape("a%20b"); }`).result))
      .toEqual({ ok: true, value: "a b" });
    expect(litValue(call(`export function f() { return btoa("ab"); }`).result))
      .toEqual({ ok: true, value: "YWI=" });
    const bad = evalWithArgs(`export function f() { return decodeURIComponent("%"); }`, []);
    expect(bad.throws).toContain("URIError");
    const badB64 = evalWithArgs(`export function f() { return atob("!"); }`, []);
    expect(badB64.throws).toContain("InvalidCharacterError");
  });
});

describe("Bug 7: Date.parse / Date.UTC", () => {
  it("全字面量 → 精确时间戳（node 实测折叠）", () => {
    expect(litValue(call(`export function f() { return Date.parse("2020-01-01"); }`).result))
      .toEqual({ ok: true, value: 1577836800000 });
    expect(litValue(call(`export function f() { return Date.UTC(2020, 1, 1); }`).result))
      .toEqual({ ok: true, value: 1580515200000 });
    // 无效输入 → NaN（非 throw）
    expect(litValue(call(`export function f() { return Date.parse("x"); }`).result))
      .toEqual({ ok: true, value: NaN });
  });

  it("抽象实参 → number（值域恒可判定）", () => {
    expect(evalWithArgs(`export function f(s) { return Date.parse(s); }`, [strAbs]).value)
      .toBe("number");
    expect(evalWithArgs(`export function f(y) { return Date.UTC(y, 0, 1); }`, [numAbs]).value)
      .toBe("number");
  });

  it("bigint/symbol 实参 → ToNumber/ToString 定抛 TypeError", () => {
    const bi = evalWithArgs(`export function f() { return Date.UTC(1n); }`, []);
    expect(bi.value).toBe("never");
    expect(bi.throws).toContain("TypeError");
    const sym = evalWithArgs(`export function f(k) { return Date.parse(k); }`, [
      abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
    ]);
    expect(sym.throws).toContain("TypeError");
  });
});

describe("Bug 8: Object.defineProperties / getOwnPropertyDescriptors", () => {
  it("defineProperties 返回 target（描述符逐键安装，defineProperty 机器共用）", () => {
    const r = call(`export function f() { return Object.defineProperties({ a: 1 }, { b: { value: 2 } }); }`);
    const s = fmt(r.result) ?? "";
    expect(s).toContain("a: 1");
    expect(s).toContain("b: 2");
    // 非枚举描述符默认：b 不进 keys 视图（native JSON.stringify 只见 a）
    const keys = call(
      `export function f() { return Object.keys(Object.defineProperties({ a: 1 }, { b: { value: 2 } })); }`,
    );
    expect(fmt(keys.result)).toContain("[");
    expect(fmt(keys.result)).not.toContain("\"b\"");
  });

  it("getOwnPropertyDescriptors：closed obj 逐槽 exact（mkDesc 口径）", () => {
    const r = call(`export function f() { return Object.getOwnPropertyDescriptors({ a: 1 }); }`);
    expect(fmt(r.result)).toBe(
      '{ a: { value: 1, writable: true, enumerable: true, configurable: true } }',
    );
  });

  it("getOwnPropertyDescriptors：tuple → 索引 + length 描述符（native 对齐）", () => {
    const r = call(`export function f() { return Object.getOwnPropertyDescriptors(["a", "b"]); }`);
    const s = fmt(r.result) ?? "";
    expect(s).toContain('"0": { value: "a", writable: true, enumerable: true, configurable: true }');
    expect(s).toContain("length: { value: 2, writable: true, enumerable: false, configurable: false }");
  });

  it("target/props 非对象 → 定抛 TypeError（IsObject/ToObject 口径）", () => {
    const primTarget = evalWithArgs(`export function f() { return Object.defineProperties(1, {}); }`, []);
    expect(primTarget.throws).toContain("TypeError");
    const primProps = evalWithArgs(`export function f() { return Object.defineProperties({}, null); }`, []);
    expect(primProps.throws).toContain("TypeError");
    const primDesc = evalWithArgs(
      `export function f() { return Object.defineProperties({ a: 1 }, { b: 5 }); }`,
      [],
    );
    expect(primDesc.throws).toContain("TypeError");
  });
});

describe("Bug 11: trimLeft / trimRight（ES2019 别名）", () => {
  it("字面量接收者精确折叠（≡ trimStart/trimEnd）", () => {
    expect(litValue(call(`export function f() { return " ab ".trimLeft(); }`).result))
      .toEqual({ ok: true, value: "ab " });
    expect(litValue(call(`export function f() { return " ab ".trimRight(); }`).result))
      .toEqual({ ok: true, value: " ab" });
  });

  it("抽象/模板接收者 → string，恒 total（假 may-throw 消除）", () => {
    const r1 = evalWithArgs(`export function f(s) { return s.trimLeft(); }`, [strAbs]);
    expect(r1.value).toBe("string");
    expect(r1.effects).toEqual([]);
    expect(r1.throws).toBe("never");
    const r2 = evalWithArgs(`export function f(s) { return \` \${s}\`.trimRight(); }`, [strAbs]);
    expect(r2.value).toBe("string");
  });
});

describe("Bug 12: String.raw 标签模板", () => {
  it("全字面量 → 精确拼接", () => {
    expect(litValue(call("export function f() { return String.raw`a${1}b`; }").result))
      .toEqual({ ok: true, value: "a1b" });
    expect(litValue(call("export function f() { return String.raw`xy`; }").result))
      .toEqual({ ok: true, value: "xy" });
  });

  it("抽象 sub → string（raw 片不转义语义由 $tpl raw 槽承载）", () => {
    const r = evalWithArgs("export function f(s) { return String.raw`a${s}b`; }", [strAbs]);
    expect(r.value).toBe("string");
    expect(r.effects).toEqual([]);
  });

  it("symbol sub → ToString 定抛 TypeError", () => {
    const r = evalWithArgs("export function f(k) { return String.raw`a${k}b`; }", [
      abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
    ]);
    expect(r.throws).toContain("TypeError");
  });
});

describe("Bug 24: ES2024 命名空间静态", () => {
  it("Array.fromAsync → promise<元素域>（from 同步投影 + thenable 解包）", () => {
    expect(formatAbs(call(`export function f() { return Array.fromAsync([1]); }`).result))
      .toContain("promise<1[]");
    expect(formatAbs(call(`export function f() { return Array.fromAsync([Promise.resolve(1)]); }`).result))
      .toContain("promise<1[]");
  });

  it("Promise.withResolvers → { promise, resolve, reject } 三槽", () => {
    const s = formatAbs(call(`export function f() { return Promise.withResolvers(); }`).result) ?? "";
    expect(s).toContain("promise: promise<unknown>");
    expect(s).toContain("resolve:");
    expect(s).toContain("reject:");
  });

  it("URL.canParse：字面量精确 / 抽象 → boolean（解析恒 total）", () => {
    expect(litValue(call(`export function f() { return URL.canParse("https://x.com"); }`).result))
      .toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return URL.canParse("not-a-url"); }`).result))
      .toEqual({ ok: true, value: false });
    const r = evalWithArgs(`export function f(s) { return URL.canParse(s); }`, [strAbs]);
    expect(r.value).toBe("boolean");
    expect(r.effects).toEqual([]);
  });
});

describe("Bug 26: 宿主全局函数值的一等公民面", () => {
  it("return 位 → fn Abs（不再弃成 unknown）", () => {
    expect(fmt(call(`export function f() { return parseInt; }`).result)).toBe("(arg0, arg1) => ?");
    expect(fmt(call(`export function f() { return Number; }`).result)).toBe("(arg0) => ?");
  });

  it("HOF 回调位：map(parseInt) → [1, NaN, NaN]（radix=index 原生语义）", () => {
    expect(fmt(call(`export function f() { return [1, 2, 3].map(parseInt); }`).result))
      .toBe("[1, NaN, NaN]");
    expect(fmt(call(`export function f() { return [1, 2].map(Number); }`).result))
      .toBe("[1, 2]");
    expect(fmt(call(`export function f() { return [1, 2].map(isNaN); }`).result))
      .toBe("[false, false]");
  });

  it(".call / .apply 接收者位 → 桥分派精确折叠", () => {
    expect(litValue(call(`export function f() { return parseInt.call(null, "1"); }`).result))
      .toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return parseInt.apply(null, ["1"]); }`).result))
      .toEqual({ ok: true, value: 1 });
  });

  it("obj 槽方法位（asAbsVal apply 钩子桥）", () => {
    expect(
      litValue(call(`export function f() { const o = { m: parseInt }; return o.m("1"); }`).result),
    ).toEqual({ ok: true, value: 1 });
  });

  it("then 回调位 → promise<折叠值>", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(1).then(parseInt); }`).result))
      .toContain("promise<1>");
  });
});

describe("Bug 38: 字符串 pattern 的 match/search/matchAll（字面量接收者）", () => {
  it("search(\"c\") ≡ search(/c/) 精确折叠（RegExpCreate 语义）", () => {
    expect(litValue(call(`export function f() { return "abc123".search("c"); }`).result))
      .toEqual({ ok: true, value: 2 });
  });

  it("match(\"b\") → 匹配数组（index/input/groups 槽与 regex 路径同构）", () => {
    const s = formatAbs(call(`export function f() { return "abc".match("b"); }`).result) ?? "";
    expect(s).toContain('"0": "b"');
    expect(s).toContain("index: 1");
    expect(s).toContain('input: "abc"');
  });

  it("matchAll(字符串) → 恒无 g 定抛 TypeError（非保守 unknown）", () => {
    const r = evalWithArgs(`export function f() { return "ab".matchAll("a"); }`, []);
    expect(r.value).toBe("never");
    expect(r.throws).toContain("TypeError");
  });
});

describe("Bug 50: s.at(n) 抽象接收者缺 undefined 臂", () => {
  it("抽象接收者 / 非折叠位置 → string | undefined（与 codePointAt 同款）", () => {
    const r1 = evalWithArgs(`export function f(s) { return s.at(0); }`, [strAbs]);
    expect(r1.value).toContain("undefined");
    expect(r1.value).toContain("string");
    const r2 = evalWithArgs(`export function f(s, i) { return "hello".at(i); }`, [strAbs, numAbs]);
    expect(r2.value).toContain("undefined");
  });

  it("字面量接收者路径维持精确（OOB → undefined / 命中 → 字符）", () => {
    expect(litValue(call(`export function f() { return "hello".at(10); }`).result))
      .toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return "hello".at(-1); }`).result))
      .toEqual({ ok: true, value: "o" });
  });
});

describe("Bug 51: Array.from(<obj>) array-like 面", () => {
  it("closed obj + 具体 length → 逐索引槽精确元组（不再错误值 undefined[]）", () => {
    const r = call(`export function f() { return Array.from({ 0: "a", 1: "b", length: 2 }); }`);
    expect(fmt(r.result)).toBe('["a", "b"]');
  });

  it("字符串 length 字面量 → ToLength 折叠后走字面量路径", () => {
    const r = call(`export function f() { return Array.from({ length: "2" }); }`);
    expect(fmt(r.result)).toBe("[undefined, undefined]");
  });

  it("缺失 length 槽 → []（ToLength(undefined) = 0）", () => {
    const r = call(`export function f() { return Array.from({ a: 1 }); }`);
    expect(fmt(r.result)).toBe("[]");
  });

  it("抽象 number length → undefined[]（元素域与 length 无关）", () => {
    const r = evalWithArgs(`export function f(n) { return Array.from({ length: n }); }`, [numAbs]);
    expect(r.value).toBe("undefined[]");
  });
});

describe("Bug 55: Annex B HTML 字符串方法", () => {
  it("字面量接收者按原生模板精确折叠", () => {
    expect(litValue(call(`export function f() { return "ab".bold(); }`).result))
      .toEqual({ ok: true, value: "<b>ab</b>" });
    expect(litValue(call(`export function f() { return "5".big(); }`).result))
      .toEqual({ ok: true, value: "<big>5</big>" });
    expect(litValue(call(`export function f() { return "ab".anchor("x"); }`).result))
      .toEqual({ ok: true, value: '<a name="x">ab</a>' });
    expect(litValue(call(`export function f() { return "ab".link("u"); }`).result))
      .toEqual({ ok: true, value: '<a href="u">ab</a>' });
    expect(litValue(call(`export function f() { return "ab".fontcolor("red"); }`).result))
      .toEqual({ ok: true, value: '<font color="red">ab</font>' });
    expect(litValue(call(`export function f() { return "ab".fontsize(3); }`).result))
      .toEqual({ ok: true, value: '<font size="3">ab</font>' });
    expect(litValue(call(`export function f() { return "ab".fixed(); }`).result))
      .toEqual({ ok: true, value: "<tt>ab</tt>" });
    expect(litValue(call(`export function f() { return "ab".blink(); }`).result))
      .toEqual({ ok: true, value: "<blink>ab</blink>" });
  });

  it("抽象/模板接收者 → string（纯拼接，total）", () => {
    const r1 = evalWithArgs(`export function f(s) { return s.bold(); }`, [strAbs]);
    expect(r1.value).toBe("string");
    expect(r1.throws).toBe("never");
    const r2 = evalWithArgs(`export function f(s) { return \` \${s}\`.italics(); }`, [strAbs]);
    expect(r2.value).toBe("string");
  });

  it("抽象实参（带参方法）→ string；symbol 实参定抛", () => {
    const r = evalWithArgs(`export function f(s) { return "ab".anchor(s); }`, [strAbs]);
    expect(r.value).toBe("string");
    expect(r.effects).toEqual([]);
    const sym = evalWithArgs(`export function f(k) { return "ab".anchor(k); }`, [
      abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
    ]);
    expect(sym.throws).toContain("TypeError");
  });
});
