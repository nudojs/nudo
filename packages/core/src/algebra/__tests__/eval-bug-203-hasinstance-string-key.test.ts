/**
 * Bug 203 回归：普通字符串键 `"@@hasInstance"` 与 `Symbol.hasInstance` **不得**
 * 混同——前者是用户自有的普通属性（原生不参与 instanceof 判定），后者才是
 * instanceof 的钩子。
 *
 * ES 语义：
 * - `o["@@hasInstance"] = fn` → 普通字符串键；`1 instanceof o` → RHS 非
 *   callable → **TypeError**（钩子缺席）；
 * - `A["@@hasInstance"] = fn`（类值）→ 普通字符串键；`1 instanceof A` →
 *   OrdinaryHasInstance → **false**（不抛、不当钩子）；
 * - `o[Symbol.hasInstance] = fn` → 符号键钩子 → 调 fn → ToBoolean 结果；
 * - `class A { static [Symbol.hasInstance](x){…} }` → 类体符号键钩子。
 *
 * 修复前：字符串键槽被当钩子调用（`1 instanceof o` 折 true、类值折钩子结果），
 * 且闭 obj RHS 的 callable 校验也认它 → 该抛不抛 / 不该抛却抛。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

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

describe("Bug 203 — 普通字符串键 \"@@hasInstance\" 不是 Symbol.hasInstance 钩子", () => {
  it("obj 的字符串键钩子 → TypeError（RHS 非 callable）", () => {
    const src = wrap(
      `const o={}; o["@@hasInstance"]=function(){return false;}; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("obj 的字符串键钩子（返回 true 也一样）→ TypeError", () => {
    const src = wrap(
      `const o={}; o["@@hasInstance"]=function(){return true;}; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("obj 的字符串键槽值不可调用 → TypeError", () => {
    const src = wrap(
      `const o={}; o["@@hasInstance"]=1; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("类值的字符串键钩子 → false（不当钩子、不抛）", () => {
    expect(v(wrap(`class A{} A["@@hasInstance"]=function(){return true;}; return 1 instanceof A;`))).toEqual({
      ok: true,
      value: false,
    });
    expect(v(wrap(`class A{} A["@@hasInstance"]=function(){return false;}; return 1 instanceof A;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("类值的字符串键槽值不可调用 → 不抛（原生走 OrdinaryHasInstance → false）", () => {
    const src = wrap(`class A{} A["@@hasInstance"]=1; try { return 1 instanceof A; } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: false });
  });
});

describe("Bug 203 — 负控制：真 Symbol.hasInstance 钩子不回归", () => {
  it("obj 的符号键钩子 → 调 fn 并 ToBoolean", () => {
    expect(v(wrap(`const o={}; o[Symbol.hasInstance]=function(){return true;}; return 1 instanceof o;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`const o={}; o[Symbol.hasInstance]=function(){return 0;}; return 1 instanceof o;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("类体 static [Symbol.hasInstance] → 钩子生效", () => {
    expect(
      v(wrap(`class A{ static [Symbol.hasInstance](x){ return true; } } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("类体 static [Symbol.hasInstance] 的继承（D extends C）→ 钩子生效", () => {
    expect(
      v(
        wrap(
          `class C{ static [Symbol.hasInstance](x){ return true; } } class D extends C{} return 1 instanceof D;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("类体 static [Symbol.hasInstance] = fn（静态字段形态）→ 钩子生效", () => {
    expect(
      v(wrap(`class A{ static [Symbol.hasInstance] = function(){ return true; }; } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("普通对象 RHS（无钩子）→ TypeError（原生 RHS 非 callable）", () => {
    const src = wrap(`const o={}; o.foo=1; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
    expect(throwsError(call(wrap(`const o={}; return 1 instanceof o;`)).throws, "TypeError")).toBe(true);
  });
});
