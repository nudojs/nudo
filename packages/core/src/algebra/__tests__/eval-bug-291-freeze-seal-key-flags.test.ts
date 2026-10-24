/**
 * Bug 291 回归：Object.freeze / Object.seal 的**键级标志**落地 +
 * isFrozen / isSealed 的**平凡真**判定 + fn 接收者。
 *
 * 原生（node v26 实测）：
 * - `Object.freeze(o)` ⇒ 每个自有键的 writable / configurable 折 false；
 *   `Object.seal(o)` ⇒ configurable 折 false（writable 保持）；
 * - `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结——
 *   规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）；
 * - `Object.isSealed(Object.preventExtensions({}))` === true（空对象同理）；
 * - `Object.isFrozen(Object.preventExtensions({ a: 1 }))` === false；
 * - `Object.getOwnPropertyDescriptors({get a(){}}).a.get` 是**函数**
 *   （访问器描述符是 {get, set, enumerable, configurable}——无 value/writable）。
 *
 * 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结
 * （gOPD(o,"a").writable 仍折 true / configurable 仍折 true）；isFrozen /
 * isSealed 只认标签 ⇒ 平凡真（seal({}) / preventExtensions({})）全折 false。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 291 — freeze / seal 键级标志 + isFrozen/isSealed 平凡真", () => {
  it("freeze：自有键的 writable / configurable 折 false（改前仍折 true）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "false,true,false" });
  });

  it("seal：只折 configurable false，writable 保持 true（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.seal(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "true,true,false" });
  });

  it("gOPDs 同步反映冻结后的键级标志（改前仍折 true/true）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); const d = Object.getOwnPropertyDescriptors(o).a; return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "false,true,false" });
  });

  it("isFrozen：空对象密封即冻结（改前折 false）", () => {
    expect(v(wrap(`const o = {}; Object.seal(o); return Object.isFrozen(o);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("isSealed：空对象 preventExtensions 即密封（改前折 false）", () => {
    expect(
      v(wrap(`const o = {}; Object.preventExtensions(o); return Object.isSealed(o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("isFrozen：preventExtensions + 收紧的键标志 ⇒ true（改前折 false）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { writable: false, configurable: false }); Object.preventExtensions(o); return Object.isFrozen(o);`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("isFrozen：seal 后仍有可写键 ⇒ false（原生同款，负控制）", () => {
    expect(v(wrap(`const o = { a: 1 }; Object.seal(o); return Object.isFrozen(o);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("isSealed：preventExtensions 后仍有可配置键 ⇒ false（负控制）", () => {
    expect(
      v(wrap(`const o = { a: 1 }; Object.preventExtensions(o); return Object.isSealed(o);`)),
    ).toEqual({ ok: true, value: false });
  });

  it("gOPDs：访问器属性折 {get, set} 描述符（改前 .get 折 undefined）", () => {
    expect(
      v(wrap(`const o = { get a() { return 1; } }; return typeof Object.getOwnPropertyDescriptors(o).a.get;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("fn 接收者：冻结后可写键仍折 false + 新键写抛 TypeError（原生同款）", () => {
    // 函数表达式路径（$fnVal 造的稳定 fn Abs）
    expect(v(wrap(`const f = function () {}; Object.freeze(f); return Object.isFrozen(f);`))).toEqual({
      ok: true,
      value: true,
    });
    expect(
      v(
        wrap(
          `const f = function () {}; Object.freeze(f); try { f.x = 4; return "no-throw"; } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });
});
