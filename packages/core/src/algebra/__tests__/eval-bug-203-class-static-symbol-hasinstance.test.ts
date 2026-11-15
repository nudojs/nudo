// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-203-class-static-symbol-hasinstance.test.ts + eval-bug-203-hasinstance-string-key.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue, type Abs } from "../abs.ts";
import { runTranspiled } from "../exec/run.ts";
import { call, throwsError } from "./eval-helpers.ts";

describe("[merged] eval-bug-203-class-static-symbol-hasinstance.test.ts", () => {
/**
 * Bug 203 回归（**类体静态成员**形态）：普通字符串键 `static "@@hasInstance"`
 * 不是 `Symbol.hasInstance` 钩子——原生 `instanceof` 只看**符号键**；
 * 符号键形态 `static [Symbol.hasInstance](v){…}` 仍是钩子，且其类值同名槽
 * 带 **symbolKey 标记**（读面据此把符号键槽与普通字符串键槽分开——同族 01
 * 的 Bug 149「符号键投影 → "@@X" 槽 + symbolKey 标记」同机制）。
 *
 * ES 语义（原生）：
 * - `class A { static "@@hasInstance"(){…} }` → 一个**普通静态属性**（键是
 *   字符串 "@@hasInstance"）：`A["@@hasInstance"]` 读得到该方法；`1 instanceof
 *   A` 走 OrdinaryHasInstance → **false**（不当钩子）；
 * - `class A { static [Symbol.hasInstance](v){…} }` → **符号键**静态成员：
 *   `1 instanceof A` 调该钩子（首参 = 左操作数）；`A[Symbol.hasInstance]`
 *   读得到该方法。
 *
 * 修复前：两者在类 spec 里同键（"@@hasInstance"）⇒ 字符串键形态被当钩子
 * 调用（`1 instanceof A` 折 true），且 `A["@@hasInstance"]` 读到的是钩子
 * 适配器而非用户方法。
 *
 * 修法（transpile/class-emit.ts）：
 * - 字符串键形态**不进** spec 的 staticMethods/statics（进了则
 *   members.ts 的 classDeclaresHasInstance 判「类声明了钩子」）→ 改以类值
 *   **自有槽**安装（$set 写 own slot，槽无 symbolKey 标记 ⇒ 不是钩子）；
 * - 符号键形态仍进 spec（$class 侧造钩子适配器），并在类定义后置一步给
 *   类值同名槽打 **symbolKey 标记**。
 */





const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 203 — 类体 static \"@@hasInstance\"（字符串键）不是 Symbol.hasInstance 钩子", () => {
  it("字符串键静态方法 → 1 instanceof A 折 false（不当钩子）", () => {
    expect(v(wrap(`class A { static "@@hasInstance"() { return true; } } return 1 instanceof A;`))).toEqual({
      ok: true,
      value: false,
    });
    expect(v(wrap(`class A { static "@@hasInstance"() { return false; } } return 1 instanceof A;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("字符串键静态字段 → 1 instanceof A 折 false（不当钩子）", () => {
    expect(
      v(wrap(`class A { static "@@hasInstance" = () => true; } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("字符串键静态 getter → 1 instanceof A 折 false（不当钩子）", () => {
    expect(
      v(wrap(`class A { static get "@@hasInstance"() { return true; } } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("字符串键静态方法仍是可读可调的普通静态成员", () => {
    expect(v(wrap(`class A { static "@@hasInstance"() { return "u"; } } return typeof A["@@hasInstance"];`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class A { static "@@hasInstance"() { return "u"; } } return A["@@hasInstance"]();`))).toEqual({
      ok: true,
      value: "u",
    });
    // 同一函数对象（读面每次读回同一 Abs）
    expect(
      v(wrap(`class A { static "@@hasInstance"() {} } return A["@@hasInstance"] === A["@@hasInstance"];`)),
    ).toEqual({ ok: true, value: true });
    // this = 类值（成员调用接收者）
    expect(
      v(wrap(`class A { static "@@hasInstance"() { return this === A; } } return A["@@hasInstance"]();`)),
    ).toEqual({ ok: true, value: true });
    // 继承面：B 的静态读走到 A 的槽
    expect(
      v(
        wrap(
          `class A { static "@@hasInstance"() { return "A"; } } class B extends A {} return B["@@hasInstance"]();`,
        ),
      ),
    ).toEqual({ ok: true, value: "A" });
    // 静态字段初始化器可读该静态方法（原生：方法先于静态元素定义）
    expect(
      v(
        wrap(
          `class A { static "@@hasInstance"() { return "u"; } static x = A["@@hasInstance"](); } return A.x;`,
        ),
      ),
    ).toEqual({ ok: true, value: "u" });
  });

  it("字符串键形态不破坏普通 instanceof 链（new A() instanceof A 仍为 true）", () => {
    expect(
      v(wrap(`class A { static "@@hasInstance"() { return true; } } return new A() instanceof A;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("类表达式形态同样成立（const K = class {…}）", () => {
    expect(
      v(wrap(`const K = class { static "@@hasInstance"() { return true; } }; return 1 instanceof K;`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`const K = class { static "@@hasInstance"() { return "u"; } }; return K["@@hasInstance"]();`)),
    ).toEqual({ ok: true, value: "u" });
    // 命名类表达式的自引用（类体词法绑到类自身）
    expect(
      v(
        wrap(
          `const K = class Named { static "@@hasInstance"() { return Named; } }; return K["@@hasInstance"]() === K;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("字符串键静态方法的实参与 arguments 口径不变", () => {
    expect(
      v(wrap(`class A { static "@@hasInstance"(a, b) { return a + b; } } return A["@@hasInstance"](1, 2);`)),
    ).toEqual({ ok: true, value: 3 });
    expect(
      v(wrap(`class A { static "@@hasInstance"(...a) { return a.length; } } return A["@@hasInstance"](1, 2, 3);`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it("符号键静态方法仍是钩子（左操作数进钩子）", () => {
    expect(
      v(wrap(`class A { static [Symbol.hasInstance](v) { return true; } } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: true });
    expect(
      v(wrap(`class A { static [Symbol.hasInstance](v) { return v === 5; } } return 5 instanceof A;`)),
    ).toEqual({ ok: true, value: true });
    expect(
      v(wrap(`class A { static [Symbol.hasInstance](v) { return v === 5; } } return 3 instanceof A;`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`class A { static [Symbol.hasInstance](v) { return false; } } return new A() instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("符号键静态字段仍是钩子", () => {
    expect(
      v(wrap(`class A { static [Symbol.hasInstance] = () => true; } return 1 instanceof A;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("符号键静态成员的可读面（Symbol 键）仍是一等函数", () => {
    expect(
      v(wrap(`class A { static [Symbol.hasInstance](v) { return true; } } return typeof A[Symbol.hasInstance];`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("符号键静态成员的类值槽带 symbolKey 标记（读面据此区分符号键槽）", () => {
    const src = `export class A { static [Symbol.hasInstance](v) { return true; } }`;
    const exports = runTranspiled(src, { mode: "analyze" }) as Record<string, Abs>;
    const cls = exports.A!;
    const inner = (cls.shape as { k: "brand"; name: string; shape: Abs }).shape;
    const objShape = inner.shape as { k: string; slots: Record<string, { symbolKey?: boolean }> };
    expect(objShape.k).toBe("obj");
    const slot = objShape.slots["@@hasInstance"]!;
    expect(slot).toBeDefined();
    expect(slot.symbolKey).toBe(true);
  });

  it("字符串键静态成员的类值槽不带 symbolKey 标记（不是符号键槽）", () => {
    const src = `export class A { static "@@hasInstance"() { return true; } }`;
    const exports = runTranspiled(src, { mode: "analyze" }) as Record<string, Abs>;
    const cls = exports.A!;
    const inner = (cls.shape as { k: "brand"; name: string; shape: Abs }).shape;
    const objShape = inner.shape as { k: string; slots: Record<string, { symbolKey?: boolean }> };
    expect(objShape.k).toBe("obj");
    const slot = objShape.slots["@@hasInstance"]!;
    expect(slot).toBeDefined();
    expect(slot.symbolKey).toBeUndefined();
  });
});
});

describe("[merged] eval-bug-203-hasinstance-string-key.test.ts", () => {
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




const wrap = (body: string) => `export function f() { ${body} }`;

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
});
