// MERGED (topic-related bug pins): eval-bug-327-json-eff-and-replacer.test.ts + eval-bug-327-json-nested-brand.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, throwsError, effects } from "./eval-helpers.ts";
import { runTranspiled, callTranspiledExportFull, abs } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../diagnostics/may-throw.ts";

describe("[merged] eval-bug-327-json-eff-and-replacer.test.ts", () => {
/**
 * Bug 327 回归：JSON 面的 **eff（Promise / 生成器对象）折叠** 与
 * **不可调用 replacer 被忽略**。
 *
 * 本文件钉的是**主 agent 刚完成的接线**（`packages/core/src/algebra/builtins/json.ts`）：
 * - `absToJsonNative` 新增 `eff` 臂 ⇒ 恒返回 `{}`（原生：Promise / 生成器
 *   对象无自有可枚举属性、无 toJSON ⇒ `JSON.stringify({p: Promise.resolve(1)})`
 *   === `'{"p":{}}'` 且**不抛**）；
 * - `jsonStringifyTotal` 新增 `eff` ⇒ total（恒不抛）；
 * - replacer **可调用性**判定：`brand` **不再一律**记 may-throw——只有
 *   **构造器 brand**（`classNameOfValue(abs) !== undefined` ⇒ class 值 / 内建
 *   构造器）才记 may-throw（可调用）；`brand` **实例**（`new Map()` /
 *   `new Date()` / 用户类实例）与 `eff` 都**不可调用** ⇒ 原生忽略 replacer ⇒
 *   **不抛**。
 *
 * 修前：eff 无臂 ⇒ 落 NOT_LITERAL ⇒ 父层记 may-throw ⇒ **L1/L2 假红**；
 * brand/eff 作 replacer 一律记 may-throw ⇒ 同款假红。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `JSON.stringify({p: Promise.resolve(1)})` === `'{"p":{}}'`（不抛）
 * - `JSON.stringify({m: new Map()})` === `'{"m":{}}'`（不抛）
 * - `JSON.stringify({d: new Date(0)})` === `'{"d":"1970-01-01T00:00:00.000Z"}'`
 * - `JSON.stringify({g: (function*(){})()})` === `'{"g":{}}'`（不抛）
 * - `JSON.stringify({a:1}, new Map())` === `'{"a":1}'`（**不抛**——brand 实例
 *   不可调用 ⇒ replacer 被忽略）
 * - `JSON.stringify({a:1}, Promise.resolve(1))` === `'{"a":1}'`（不抛）
 * - `JSON.stringify({a:1}, {})` === `'{"a":1}'`（不抛）
 * - `JSON.stringify({a:1}, Map)` → **抛 TypeError**（原生
 *   "Constructor Map requires 'new'"——构造器 brand **可调用** ⇒ 逐键调用
 *   ⇒ 抛）★ 本文件的核心区分。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 带 any 实参的入口（effects 面用——抽象接收者才走 may-throw 记账） */
const wrapArg = (body: string) => `export function f(x) { ${body} }`;

describe("Bug 327 — JSON 面的 eff（Promise / 生成器对象）折叠", () => {
  it("Promise 对象 → {}（原生 '{\"p\":{}}'，不抛）", () => {
    const r = call(wrap(`return JSON.stringify({ p: Promise.resolve(1) });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"p":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("Map 实例 → {}（原生 '{\"m\":{}}'，不抛）", () => {
    const r = call(wrap(`return JSON.stringify({ m: new Map() });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"m":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("Date 实例 → ISO 串（原生 '{\"d\":\"1970-01-01T00:00:00.000Z\"}'）", () => {
    const r = call(wrap(`return JSON.stringify({ d: new Date(0) });`), "f");
    expect(litValue(r.result)).toEqual({
      ok: true,
      value: '{"d":"1970-01-01T00:00:00.000Z"}',
    });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("生成器对象 → {}（原生 '{\"g\":{}}'，不抛）", () => {
    const r = call(wrap(`return JSON.stringify({ g: (function* () {})() });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"g":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("eff 臂不记 may-throw（产品面 L1/L2 假红消失）", () => {
    expect(effects(wrap(`return JSON.stringify({ p: Promise.resolve(1) });`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ g: (function* () {})() });`))).not.toContain(
      "TypeError",
    );
  });
});

describe("Bug 327 — replacer 可调用性：构造器 brand 可调用，brand 实例 / eff 不可调用", () => {
  it("★ 构造器 brand 作 replacer → 抛 TypeError（原生 'Constructor Map requires new'）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, Map);`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("★ brand **实例**作 replacer → 不抛（原生 '{\"a\":1}'）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, new Map());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("eff 作 replacer → 不抛（原生 '{\"a\":1}'）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, Promise.resolve(1));`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("普通对象作 replacer → 不抛（原生 '{\"a\":1}'）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, {});`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("brand 实例 / eff 作 replacer 不记 may-throw（负控制：构造器 brand 仍记）", () => {
    // 不可调用的 replacer 被原生忽略 ⇒ 不可能抛 ⇒ 引擎不得记 may-throw。
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, new Map());`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, Promise.resolve(1));`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, {});`))).not.toContain("TypeError");
  });
});

describe("Bug 327 — 负控制（邻近形态不回归）", () => {
  it("可调用 replacer 仍逐键生效（原生同款）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, (k, v) => v);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("普通对象 / 数组序列化不回归（原生 '{\"a\":1,\"b\":[1,2]}'）", () => {
    const r = call(wrap(`return JSON.stringify({ a: 1, b: [1, 2] });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1,"b":[1,2]}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("用户 toJSON 面仍不可折（仍记 may-throw）", () => {
    // 负控制：eff / brand 实例的豁免**不外溢**到「用户面可能抛」的分支。
    expect(effects(wrapArg(`return JSON.stringify(x);`))).toContain("TypeError");
  });

  it("BigInt 元素家族仍记 may-throw TypeError（原生定抛，不在 total 集）", () => {
    // 原生：JSON.stringify({b: new BigInt64Array([1n])}) 定抛 TypeError
    //（"Do not know how to serialize a BigInt64Array"）。引擎按 may-throw
    // 记账（入口 throws 面不落定抛）⇒ 钉 effects 面。
    expect(effects(wrapArg(`return JSON.stringify({ b: new BigInt64Array([1n]) });`))).toContain(
      "TypeError",
    );
  });
});
});

describe("[merged] eval-bug-327-json-nested-brand.test.ts", () => {
/**
 * Bug 327 回归：JSON.stringify 的**内建 brand 折叠是递归的**（顶层与
 * 对象/数组**成员**同款）。
 *
 * 修前：`foldJsonTotalBrand` 只喂**顶层**接收者 ⇒ **嵌套** brand 一律落
 * 「may carry BigInt / circular / throwing toJSON」⇒ **记 may-throw**
 * ⇒ L1/L2 **假红**（native 全部正常返回）；而同一 brand 放在顶层则完全
 * 正确 ⇒「total brand 白名单只对顶层接收者生效」。
 *
 * 修法（json.ts `jsonBrandFold` 单一事实源 + `absToJsonNative` 的 brand
 * 臂 + `jsonStringifyTotal` 的 brand 臂）：
 * - 精确可折：RegExp/Map/Set 族/Error 族 → {}；Date → ISO 串（Invalid →
 *   null）；URL → href；装箱 Number/String/Boolean → 拆箱后的原始值；
 * - total 但值不可知：TypedArray 家族（元素值未建模）——**恒不抛**；
 * - 不可折（仍记 may-throw）：用户 toJSON 面、BigInt 元素家族
 *   （BigInt64Array/BigUint64Array —— 原生**定抛** TypeError）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */





const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

/** 源级求值（带 any 实参）：{ value, throws, effects } 三面 */
function evalSrc(src: string, fnName = "f"): { value: unknown; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, [anyAbs] as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    value: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 327: JSON.stringify 的嵌套内建 brand（不记 may-throw）", () => {
  it("嵌套 Date → 精确折叠（node: {\"when\":\"1970-01-01T00:00:00.000Z\"}）", () => {
    expect(v(`export function f() { return JSON.stringify({ when: new Date(0) }); }`)).toEqual({
      ok: true,
      value: '{"when":"1970-01-01T00:00:00.000Z"}',
    });
  });

  it("嵌套 Map / Set / RegExp / Error → {}（node）", () => {
    expect(v(`export function f() { return JSON.stringify({ m: new Map([[1,2]]) }); }`)).toEqual({
      ok: true,
      value: '{"m":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ s: new Set([1,2]) }); }`)).toEqual({
      ok: true,
      value: '{"s":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ r: /a(b)/g }); }`)).toEqual({
      ok: true,
      value: '{"r":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ e: new Error("x") }); }`)).toEqual({
      ok: true,
      value: '{"e":{}}',
    });
  });

  it("装箱 prim → 拆箱后的原始值（node: {\"s\":\"ab\"}）", () => {
    expect(v(`export function f() { return JSON.stringify({ s: new String("ab") }); }`)).toEqual({
      ok: true,
      value: '{"s":"ab"}',
    });
    expect(v(`export function f() { return JSON.stringify({ n: new Number(5) }); }`)).toEqual({
      ok: true,
      value: '{"n":5}',
    });
    expect(v(`export function f() { return JSON.stringify({ b: new Boolean(true) }); }`)).toEqual({
      ok: true,
      value: '{"b":true}',
    });
  });

  it("嵌套 brand 不再记 may-throw（负控制：BigInt 元素家族仍记）", () => {
    const ok = evalSrc(`export function f(x) { return JSON.stringify({ when: new Date(0) }); }`);
    expect(ok.effects).not.toContain("TypeError");
    const bi = evalSrc(`export function f(x) { return JSON.stringify({ b: new BigInt64Array([1n]) }); }`);
    expect(bi.effects).toContain("TypeError");
  });

  it("嵌套 brand 的入口不记 may-throw（产品面 L2 假红消失）", () => {
    const r = call(`export function f() { return JSON.stringify({ when: new Date(0) }); }`, "f");
    expect((r.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  });

  it("深层嵌套（数组 / 多层对象）同样折叠（node）", () => {
    expect(v(`export function f() { return JSON.stringify([[new Date(0)]]); }`)).toEqual({
      ok: true,
      value: '[["1970-01-01T00:00:00.000Z"]]',
    });
    expect(v(`export function f() { return JSON.stringify({ deep: { deeper: new Date(0) } }); }`)).toEqual({
      ok: true,
      value: '{"deep":{"deeper":"1970-01-01T00:00:00.000Z"}}',
    });
  });

  it("URL 嵌套 → href 串（node）", () => {
    expect(
      v(`export function f() { return JSON.stringify({ url: new URL("https://x.test/") }); }`),
    ).toEqual({ ok: true, value: '{"url":"https://x.test/"}' });
  });

  it("replacer 路径同款：嵌套 brand 走 toJSON 步（先于 replacer，node）", () => {
    expect(
      v(`export function f() { return JSON.stringify({ when: new Date(0) }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"when":"1970-01-01T00:00:00.000Z"}' });
    expect(
      v(`export function f() { return JSON.stringify({ m: new Map() }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"m":{}}' });
  });

  it("负控制：顶层 Date 折叠不回归（node）", () => {
    expect(v(`export function f() { return JSON.stringify(new Date(0)); }`)).toEqual({
      ok: true,
      value: '"1970-01-01T00:00:00.000Z"',
    });
  });

  it("负控制：TypedArray 家族 total 但值不可知（元素值未建模）", () => {
    const r = evalSrc(`export function f(x) { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`);
    expect(r.effects).not.toContain("TypeError");
    const r2 = call(`export function f() { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`, "f");
    expect((r2.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  });

  it("负控制：用户 toJSON 面不折（仍记 may-throw）", () => {
    const r = evalSrc(`export function f(x) { return JSON.stringify(x); }`);
    expect(r.effects).toContain("TypeError");
  });

  it("负控制：普通对象 / 数组序列化不回归", () => {
    expect(v(`export function f() { return JSON.stringify({ a: 1, b: [1, 2] }); }`)).toEqual({
      ok: true,
      value: '{"a":1,"b":[1,2]}',
    });
  });
});
});
