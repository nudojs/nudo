/**
 * Bug 158 回归：私有名（Private Name）的**类作用域**。
 *
 * ES 语义：Private Name 逐**类定义**——A 的 #x 与 B 的 #x 是两个不同私有名：
 * - 不同类的同名私有互不串值（各自 brand 独立）；
 * - 派生类同名私有不覆盖基类私有（基类槽与派生类槽并存）；
 * - 读/写外类私有抛 TypeError（brand 不匹配）；
 * - `#x in o` 只看**本类**私有的 brand。
 *
 * 修复前：私有名键是裸 "#x" 混淆键（全局共享）——跨类串值、派生覆盖基类、
 * 读外类私有返回别人的值（不抛 TypeError）。
 *
 * 修法（transpile/class-emit.ts）：类体内所有 PrivateName 的 id.name 改写为
 * "<类名>::<私有名>"（声明点与使用点同键）；运行时沿用既有 privateNameGuard
 * （"#" 前缀 brand 校验）——键按类作用域化后，跨类访问命中"非本类槽" ⇒
 * 确定 TypeError。
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
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 158 — 私有名按声明类作用域化", () => {
  it("读外类私有 → TypeError（此前返回外类的值）", () => {
    expect(
      throwName(
        wrap(`class A { #x = 1; read(o){ return o.#x; } } class B { #x = 2; } return new A().read(new B());`),
      ),
    ).toBe("TypeError");
  });

  it("调外类私有方法 → TypeError", () => {
    expect(
      throwName(
        wrap(`class A { #m(){ return 1; } read(o){ return o.#m(); } } class B { #m(){ return 2; } } return new A().read(new B());`),
      ),
    ).toBe("TypeError");
  });

  it("写外类私有 → TypeError", () => {
    expect(
      throwName(
        wrap(`class A { #x = 1; write(o){ o.#x = 5; } } class B { #x = 2; } new A().write(new B()); return 1;`),
      ),
    ).toBe("TypeError");
  });

  it("派生类同名私有不覆盖基类私有（基类 1 / 派生 2）", () => {
    expect(
      v(
        wrap(
          `class A { #x = 1; readA(){ return this.#x; } } class B extends A { #x = 2; readB(){ return this.#x; } } const b = new B(); return b.readA() + "|" + b.readB();`,
        ),
      ),
    ).toEqual({ ok: true, value: "1|2" });
  });

  it("#x in o 只看本类私有 brand（外类实例 → false）", () => {
    expect(
      v(wrap(`class A { #x = 1; static has(o){ return #x in o; } } class B { #x = 2; } return A.has(new B());`)),
    ).toEqual({ ok: true, value: false });
  });

  it("静态私有跨类读 → TypeError", () => {
    expect(
      throwName(
        wrap(`class A { static #c = 1; static read(o){ return o.#c; } } class B { static #c = 2; } return A.read(B);`),
      ),
    ).toBe("TypeError");
  });

  it("负控制：同类私有读写正常", () => {
    expect(
      v(wrap(`class A { #x = 1; read(){ return this.#x; } write(v){ this.#x = v; return this.#x; } } const a = new A(); return a.read() + "|" + a.write(9);`)),
    ).toEqual({ ok: true, value: "1|9" });
  });

  it("负控制：自有私有槽对属性 introspection 不可见（仍是内部槽）", () => {
    expect(
      v(
        wrap(
          `class A { #x = 1; pub = 2; } return Object.getOwnPropertyDescriptor(new A(), "#x") === undefined;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：公有字符串键 '#x' 不受私有名作用域化影响", () => {
    expect(v(wrap(`const o = { "#x": 7 }; return o["#x"];`))).toEqual({ ok: true, value: 7 });
  });
});
