/**
 * Bug 206 回归：类值的 `prototype` 是**不可写** own property——
 * `A.prototype = {}` 在 strict 下原生定抛 TypeError。
 *
 * ES 语义（ClassDefinitionEvaluation）：类定义的 `prototype` 属性是
 * `{writable: false, enumerable: false, configurable: false}` 的 own
 * property——给类重新指派原型在 strict 下抛 TypeError（模块/类体恒 strict）。
 *
 * 修复前：类值走通用槽写（brand inner 落一个 "prototype" 槽）——写穿无声，
 * 类照常工作，「换原型」这件事在引擎侧完全无感（既不抛，也不改行为面）。
 *
 * 不变量（负控制钉住）：
 * - 类实例面 / 原型面照常可写（`A.prototype.m = 1` 是原型对象的普通写）；
 * - `Object.defineProperty(C.prototype, ...)` 的**就地改原型**写回不受本门影响；
 * - 类的静态成员写照常（`A.x = 1`）；
 * - 子类 `extends` 的类值同样不可写原型。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 206 — 类值的 prototype 不可写：写必抛 strict TypeError", () => {
  it("A.prototype = {} → TypeError（catch 吸收）", () => {
    const src = wrap(`class A {} try { A.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("A.prototype = {} 无 catch → 函数抛 TypeError（throws 面）", () => {
    expect(throwName(wrap(`class A {} A.prototype = {}; return "ok";`))).toBe("TypeError");
  });

  it("写穿后类的实例方法仍在（写没生效）", () => {
    const src = wrap(
      `class A { m(){} } try { A.prototype = {}; const a = new A(); return typeof a.m; } catch (e) { return "threw:" + e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "threw:TypeError" });
  });

  it("子类（extends）同样不可写原型", () => {
    const src = wrap(`class B {} class S extends B {} try { S.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("有体类表达式的原型同样不可写", () => {
    const src = wrap(`const C = class { m(){} }; try { C.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });
});

describe("Bug 206 — 负控制：原型对象面 / 静态面 / defineProperty 写回不回归", () => {
  it("原型对象上的普通写不受影响（A.prototype.m = 1 → 读回 1）", () => {
    const src = wrap(`class A {} A.prototype.m = 1; return A.prototype.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("类的静态成员写照常（A.x = 1）", () => {
    const src = wrap(`class A {} A.x = 1; return A.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("静态方法写不受影响", () => {
    const src = wrap(`class A { static m(){} } A.m = 1; return A.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("Object.defineProperty(C.prototype, ...) 的就地改原型写回不受本门影响", () => {
    const src = wrap(`class C {} Object.defineProperty(C.prototype, "m", { value: 4 }); return C.prototype.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 4 });
  });

  it("读 A.prototype 仍是原型对象（读面不受写门影响）", () => {
    const src = wrap(`class A {} return typeof A.prototype;`);
    expect(v(src)).toEqual({ ok: true, value: "object" });
  });

  it("实例字段写不受影响", () => {
    const src = wrap(`class A { constructor(){ this.n = 1; } } return new A().n;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});
