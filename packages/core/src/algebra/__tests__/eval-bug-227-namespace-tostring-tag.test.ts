/**
 * Bug 227 回归：内建命名空间对象（Math / JSON / Reflect / Intl / Atomics）的
 * `Symbol.toStringTag` 必须读到**原生标签**。
 *
 * ES 语义：命名空间对象把 `Symbol.toStringTag` 挂在**自己**上（自有数据属性）
 * —— `Math[Symbol.toStringTag] === "Math"`、`Atomics[Symbol.toStringTag] ===
 * "Atomics"`；`Object.prototype.toString.call(Math)` → "[object Math]"。
 *
 * 修复前：符号键投影（"@@toStringTag"）在宿主对象上按**投影串**裸读 ⇒ 恒
 * undefined（wrong-exact：自信的错值）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 227 — 内建命名空间对象的 Symbol.toStringTag", () => {
  it("命名空间对象的 Symbol.toStringTag 是原生标签", () => {
    for (const [ns, tag] of [
      ["Math", "Math"],
      ["JSON", "JSON"],
      ["Reflect", "Reflect"],
      ["Intl", "Intl"],
      ["Atomics", "Atomics"],
    ] as const) {
      expect(v(wrap(`return String(${ns}[Symbol.toStringTag]);`))).toEqual({
        ok: true,
        value: tag,
      });
    }
  });

  it("标签面：Object.prototype.toString.call(命名空间) → [object X]", () => {
    for (const [ns, tag] of [
      ["Math", "Math"],
      ["JSON", "JSON"],
      ["Reflect", "Reflect"],
      ["Intl", "Intl"],
      ["Atomics", "Atomics"],
    ] as const) {
      expect(v(wrap(`return Object.prototype.toString.call(${ns});`))).toEqual({
        ok: true,
        value: `[object ${tag}]`,
      });
    }
  });

  it("负控制：字面量串键 \"@@toStringTag\" 仍是字符串键（不被当成 symbol）", () => {
    expect(v(wrap(`const o = { "@@toStringTag": 1 }; return String(o["@@toStringTag"]);`))).toEqual({
      ok: true,
      value: "1",
    });
  });

  it("负控制：普通对象无 Symbol.toStringTag（标签仍是 [object Object]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });

  it("负控制：函数值的标签面不变", () => {
    expect(v(wrap(`return Object.prototype.toString.call(Math.max);`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  });
});
