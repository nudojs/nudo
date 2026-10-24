/**
 * Bug 189 回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其
 * 属性位置求值（原生按源码序），不得被推迟到字面量末尾。
 *
 * ES 语义（PropertyDefinitionEvaluation）：`{ a: A, __proto__: P, b: B }` 的
 * 求值序是 A → P → B；`__proto__` 是**原型设定**（不是自有键），值表达式
 * 与普通属性值一样按源码序求值。
 *
 * 修复前：转译层把 `__proto__` 的值从字面量里摘出来、在整段 `$obj({...})`
 * 构造完成后才 `$setProto` ⇒ 值表达式被移到**最后**（副作用顺序颠倒：
 * 原生 "a,p,b" / 引擎 "a,b,p"）。
 *
 * 不变量（负控制钉住）：无 `__proto__` 的字面量发射形态不变（不引入
 * IIFE/盒子）；`__proto__` 仍不是自有键；原型设定本身仍生效；primitive
 * 原型值仍被忽略；`__proto__` 方法名仍是自有键。
 */
import { describe, it, expect } from "vitest";
import { litValue, transpileSource } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 189 — __proto__ 值表达式在其属性位置求值（原生源码序）", () => {
  it("{ __proto__: P, b: B } → 副作用序 P → B", () => {
    expect(
      v(wrap(`const log = []; const o = { __proto__: (log.push("a"), null), b: log.push("b") }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("{ b: B, __proto__: P } → 副作用序 B → P", () => {
    expect(
      v(wrap(`const log = []; const o = { b: log.push("b"), __proto__: (log.push("a"), null) }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "b,a" });
  });

  it("{ a: A, __proto__: P, b: B } → 副作用序 A → P → B", () => {
    expect(
      v(
        wrap(
          `const log = []; const o = { a: log.push("a"), __proto__: (log.push("p"), null), b: log.push("b") }; return log.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,p,b" });
  });

  it("只有 __proto__ 的字面量 → 值表达式仍求值一次", () => {
    expect(
      v(wrap(`const log = []; const o = { __proto__: (log.push("a"), null) }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("__proto__ 的值表达式只求值一次", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { __proto__: (n++, null), b: 1 }; return n;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("原型设定仍生效（getPrototypeOf 命中该原型）", () => {
    expect(
      v(wrap(`const p = { q: 1 }; const o = { __proto__: p, x: 1 }; return Object.getPrototypeOf(o) === p;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("__proto__ 仍不是自有键（Object.keys 不含它）", () => {
    expect(
      v(wrap(`const o = { __proto__: null, x: 1 }; return Object.keys(o).join(",") + "/" + (Object.getPrototypeOf(o) === null);`)),
    ).toEqual({ ok: true, value: "x/true" });
  });
});

describe("Bug 189 — 负控制：既有语义不回归", () => {
  it("primitive 原型值被忽略（原型仍是 Object.prototype）", () => {
    expect(
      v(wrap(`const o = { __proto__: 5, x: 1 }; return Object.getPrototypeOf(o) === Object.prototype;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("普通字面量的属性求值序不变（无 __proto__ 时不插 IIFE）", () => {
    const src = transpileSource(`const o = { a: 1, b: 2 };`, {});
    expect(src.includes("__nudoProtoBox")).toBe(false);
  });

  it("带 __proto__ 的字面量才引入盒子 IIFE（求值序载体）", () => {
    const src = transpileSource(`const o = { __proto__: p, a: 1 };`, {});
    expect(src.includes("__nudoProtoBox")).toBe(true);
  });

  it("无 __proto__ 的字面量：属性值求值序不变", () => {
    expect(
      v(wrap(`const log = []; const o = { a: log.push("a"), b: log.push("b") }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("方法名 __proto__ 仍是自有键（不是原型设定）", () => {
    expect(
      v(wrap(`const o = { __proto__(){ return 1; } }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "__proto__" });
  });

  it("字面量里的 this 仍指向外层（IIFE 不得改 this 绑定）", () => {
    expect(
      v(wrap(`function g(){ const t = this; const o = { t2: this === t }; return o.t2; } return g();`)),
    ).toEqual({ ok: true, value: true });
  });

  it("带 __proto__ 的字面量里 this 绑定同样不变（IIFE 路径）", () => {
    expect(
      v(
        wrap(
          `function g(){ const t = this; const o = { __proto__: null, t2: this === t }; return o.t2; } return g();`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });
});
