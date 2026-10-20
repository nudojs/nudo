/**
 * String 方法的**模式实参是自由标识符**（179）+ 访问器里的 `arguments`（151）
 * 回归。
 *
 * Bug 179：语句位 `String.prototype.match/replace/replaceAll` 的正则状态写回
 * 给**任意标识符实参**生成赋值（`re = $reStateCall(re, …)`）：
 *  - `eval` / `arguments` ⇒ strict 模式 **SyntaxError**（整模块中止 ⇒ 契约从
 *    ERROR 降级成 WARNING ⇒ 门禁假绿）；
 *  - `undefined` / `NaN` ⇒ strict TypeError（凭空抛 ⇒ L2 假红）；
 *  - 实参还按**标识符文本**传给运行时（宿主全局值而非 Abs）⇒ `.shape` 上抛。
 * 修法：写回改为**就地**更新 lastIndex（`$reStateCall` 就地改槽）——不再需要
 * 赋值，也不需要重绑根绑定；实参走**求值源**；非 RegExp 模式按 RegExpCreate
 * / ToString 语义处理，不记抛。
 *
 * Bug 151：访问器（对象字面量 / 类）是**普通函数**——原生 `arguments` 天然
 * 存在（getter 长度 0 / setter 长度 1）。此前访问器 thunk 不发 `__nudoArgs`
 * 槽绑定 ⇒ 体里的 `arguments` 定抛 ReferenceError（原生返回 0）。
 *
 * 锚定值均为 node 原生实测（各断言注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { transpileSource } from "../exec/transpile.ts";

describe("String 方法的模式实参是自由标识符（179）", () => {
  it("replaceAll(undefined) → \"abc\"（修前 unknown throws TypeError）", () => {
    const r = call(`export function f() { return 'abc'.replaceAll(undefined, 'x'); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "abc" });
  });

  it("replace(undefined) → \"abc\"（修前 unknown throws TypeError）", () => {
    const r = call(`export function f() { return 'abc'.replace(undefined, 'x'); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "abc" });
  });

  it("RegExpCreate 语义：match(undefined) 命中空模式（非 null）", () => {
    const r = call(`export function f() { return 'abc'.match(undefined) === null; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("模式实参是 eval → 不记抛（结果仍是字符串）", () => {
    const r = call(`export function f() { return typeof 'abc'.replaceAll(eval, 'x'); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("模式实参是 arguments → 不记抛（结果仍是字符串）", () => {
    const r = call(`export function f() { return typeof 'abc'.replaceAll(arguments, 'x'); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("模式实参是 Math → 不记抛（结果仍是字符串）", () => {
    const r = call(`export function f() { return typeof 'abc'.replaceAll(Math, 'x'); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("局部正则的 lastIndex 仍推进 → 1", () => {
    const r = call(`export function f() { const re = /a/g; re.test('aa'); return re.lastIndex; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("全局正则的 replaceAll 后 lastIndex 归零 → 0", () => {
    const r = call(
      `export function f() { const re = /a/g; 'abc'.replaceAll(re, 'x'); return re.lastIndex; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("转译产物不得给自由标识符生成赋值（eval / arguments / undefined）", () => {
    for (const pat of ["eval", "arguments", "undefined", "Math"]) {
      const src = transpileSource(`export function __run() {\nreturn 'abc'.replaceAll(${pat}, 'x');\n}`, {
        mode: "exec",
      });
      expect(/\b(eval|arguments|undefined|Math)\s*=[^=]/.test(src)).toBe(false);
    }
  });
});

describe("访问器里的 arguments（151）", () => {
  it("对象字面量 getter → 0（修前定抛 ReferenceError）", () => {
    const r = call(
      `export function f() { const o = { get x(){ return arguments.length; } }; return o.x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("类 getter → 0（修前定抛 ReferenceError）", () => {
    const r = call(
      `export function f() { class A { get x(){ return arguments.length; } } return new A().x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("对象字面量 setter → 1（修前定抛 ReferenceError）", () => {
    const r = call(
      `export function f() { const o = { set x(v){ this.n = arguments.length; } }; o.x = 1; return o.n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("类 setter → 1（修前定抛 ReferenceError）", () => {
    const r = call(
      `export function f() { class A { set x(v){ this.n = arguments.length; } } const a = new A(); a.x = 1; return a.n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("getter 里的 typeof arguments → \"object\"（修前 \"undefined\"）", () => {
    const r = call(
      `export function f() { const o = { get x(){ return typeof arguments; } }; return o.x; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });

  it("普通方法的 arguments 不受影响 → 3", () => {
    const r = call(`export function f() { const o = { m(){ return arguments.length; } }; return o.m(1,2,3); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("类方法的 arguments 不受影响 → 2", () => {
    const r = call(`export function f() { class A { m(){ return arguments.length; } } return new A().m(1,2); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
