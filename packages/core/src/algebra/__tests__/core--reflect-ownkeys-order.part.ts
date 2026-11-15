/**
 * Bug 1078 回归：`Reflect.ownKeys` 的 **symbol 键排在字符串键之前**——段序错
 * 的 exact 元组（假绿）。
 *
 * 修前（探针实测）：`Reflect.ownKeys(o)`（o 有 symbol 键 + 字符串键 "a"）⇒
 * `"sym,a"`（原生：`"a,sym"`）。
 *
 * 规范依据（ES2024 OrdinaryOwnPropertyKeys）：**字符串键**（整数键升序 +
 * 插入序）→ **symbol 键**（插入序）两段排列。引擎此前按槽插入序把 `@@X`
 * 投影槽与字符串键混排 ⇒ 顺序错。
 *
 * 修后（`builtins/reflect.ts` 的 ownKeys 臂）：先切字符串键段、再接 symbol
 * 键段（各段内部维持既有顺序；与 `Object.getOwnPropertyNames` 的字符串键
 * 顺序口径一致）。
 *
 * oracle：node v26.10.0 实测。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 1078 — Reflect.ownKeys：字符串键段在前、symbol 键段在后", () => {
  it("ownKeys(o) ⇒ \"a,sym\"（native：a 在前、symbol 在后；修前：\"sym,a\"）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol.iterator] = 1; o.a = 2; const ks = Reflect.ownKeys(o); return ks.map(k => typeof k === "symbol" ? "sym" : k).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,sym" });
  });

  it("ownKeys(o)[0] 是字符串 \"a\"、typeof ownKeys(o)[1] 是 \"symbol\"（native 同款）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol.iterator] = 1; o.a = 2; const ks = Reflect.ownKeys(o); return ks[0] + ":" + (typeof ks[1]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:symbol" });
  });

  it("well-known symbol 键同款：\"a,sym\"（native 同款）", () => {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const ks = Reflect.ownKeys(o); return ks.map(k => typeof k === "symbol" ? "sym" : k).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,sym" });
  });
});

describe("Bug 1078 — 负控制（字符串键段内部顺序不变）", () => {
  it("只有字符串键：ownKeys 保持插入序（native：\"b,a\"）", () => {
    expect(val(wrap(`const o = { b: 1, a: 2 }; return Reflect.ownKeys(o).join(",");`))).toEqual({
      ok: true,
      value: "b,a",
    });
  });

  it("整数键升序在前（native：\"0,1\"）", () => {
    expect(val(wrap(`const o = { b: 1, 0: 2, 1: 3 }; return Reflect.ownKeys(o).join(",");`))).toEqual({
      ok: true,
      value: "0,1,b",
    });
  });

  it("无 symbol 键时长度不变（native：1）", () => {
    expect(val(wrap(`return Reflect.ownKeys({ a: 1 }).length;`))).toEqual({ ok: true, value: 1 });
  });
});
