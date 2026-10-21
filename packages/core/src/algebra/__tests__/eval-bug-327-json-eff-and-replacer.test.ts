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
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, throwsError, effects } from "./eval-helpers.ts";

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
