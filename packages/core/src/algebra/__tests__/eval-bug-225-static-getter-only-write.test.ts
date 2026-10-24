/**
 * Bug 225 回归：getter-only **静态**访问器的写不抛 strict TypeError。
 *
 * ES 语义（ClassStaticElement / Set）：类定义体恒 strict——`A.g = v`（g 是
 * static getter，无 static setter）原生定抛 TypeError（与实例面
 * `a.g = v` 同款）。getter-only 的静态访问器是**不可写**的（无 setter ⇒
 * Set 走 OrdinarySetWithOwnDescriptor → 描述符无 setter ⇒ 抛）。
 *
 * 修复前：$set 的类值分支 `sacc.set ? sacc.set(o, value) : o`——getter-only
 * 的静态访问器**静默吞写**（`o` 原样返回，写穿无声、读值不变），而实例面
 * 同款访问器是定抛 TypeError（两面不一致）。
 *
 * 不变量（负控制钉住）：
 * - 实例面 getter-only 访问器仍定抛（既有语义）；
 * - static getter **配** setter 时写照常走 setter；
 * - static getter 读仍得 getter 值；
 * - 静态数据属性写照常（`A.x = 1`）。
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

describe("Bug 225 — getter-only 静态访问器的写定抛 strict TypeError", () => {
  it("A.g = 5（static getter-only）→ TypeError（catch 吸收）", () => {
    const src = wrap(`class A { static get g(){ return 1; } } try { A.g = 5; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("A.g = 5 无 catch → 函数抛 TypeError（throws 面）", () => {
    expect(throwName(wrap(`class A { static get g(){ return 1; } } A.g = 5; return "ok";`))).toBe("TypeError");
  });

  it("写抛后 getter 值不变（仍 1）", () => {
    const src = wrap(`class A { static get g(){ return 1; } } try { A.g = 5; } catch (e) {} return A.g;`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 225 — 负控制：实例面 / 带 setter 的静态面 / 静态数据属性不回归", () => {
  it("实例面 getter-only 仍定抛（既有语义）", () => {
    expect(throwName(wrap(`class A { get g(){ return 1; } } const a = new A(); a.g = 5; return "ok";`))).toBe(
      "TypeError",
    );
  });

  it("static getter 配 setter → 写走 setter（不抛）", () => {
    const src = wrap(`class A { static get g(){ return 1; } static set g(v){} } A.g = 5; return "ok";`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: "ok" });
  });

  it("static getter 读仍得 getter 值", () => {
    expect(v(wrap(`class A { static get g(){ return 1; } } return A.g;`))).toEqual({ ok: true, value: 1 });
  });

  it("静态数据属性写照常（A.x = 1）", () => {
    const src = wrap(`class A {} A.x = 1; return A.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("静态方法写照常", () => {
    const src = wrap(`class A { static m(){} } A.m = 1; return A.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});
