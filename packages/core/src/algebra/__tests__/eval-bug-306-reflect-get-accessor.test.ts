/**
 * Bug 306 回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter
 * （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位）
 * 此前被折成 exact undefined，getter **从不执行**。
 *
 * 原生（node v26 实测）：`Reflect.get` ≡ [[Get]] ⇒ 访问器属性走 getter，
 * `this` = receiver（第 3 实参；缺省 ≡ target）；只有 setter 的键读值恒
 * undefined（原生同款）。
 *
 * 修复前：只读槽占位 ⇒ 折 exact undefined（假精确——比真值更窄）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 306 — Reflect.get 查访问器侧表（getter 不再被忽略）", () => {
  it("getter 值被取到（原生 42，改前 undefined）", () => {
    expect(
      v(wrap(`const o = { get x() { return 42; } }; return String(Reflect.get(o, "x"));`)),
    ).toEqual({ ok: true, value: "42" });
  });

  it("getter 副作用真实发生（原生 1，改前 0）", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { get x() { n = n + 1; return 42; } }; Reflect.get(o, "x"); return String(n);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("receiver（第 3 实参）作为 getter 的 this（原生 7）", () => {
    expect(
      v(
        wrap(
          `const o = { get x() { return this.v; } }; const r = { v: 7 }; return String(Reflect.get(o, "x", r));`,
        ),
      ),
    ).toEqual({ ok: true, value: "7" });
  });

  it("只有 setter 的键读值恒 undefined（原生同款，负控制）", () => {
    expect(
      v(wrap(`const o = { set x(v) {} }; return String(Reflect.get(o, "x"));`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("数据属性读值不受影响（负控制）", () => {
    expect(
      v(wrap(`const o = { a: 1 }; return String(Reflect.get(o, "a"));`)),
    ).toEqual({ ok: true, value: "1" });
  });
});
