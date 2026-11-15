/**
 * Bug 1075 回归：`Object.getOwnPropertyDescriptors` **丢弃 symbol 键**的自有属性
 * ——结果对象少一个自有属性、键数少 1（exact 结构 ⇒ 假绿）。
 *
 * 修前（探针实测）：
 * - `Reflect.ownKeys(Object.getOwnPropertyDescriptors(o)).length` ⇒ **1**
 *   （原生 2）；
 * - `Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(o)).length`
 *   ⇒ **0**（原生 1）。
 *
 * 根因：gOPDs 面按 `symbolKey` 过滤掉了 symbol 投影槽。但原生 gOPDs 走
 * [[OwnPropertyKeys]]——**含** symbol 键（结果对象带**真 symbol** 键 ⇒
 * `Object.getOwnPropertySymbols` 看得到、`Object.keys` /
 * `Object.getOwnPropertyNames` 看不到）。
 *
 * 修后：gOPDs 保留 symbol 投影槽并带 `symbolKey` 标记 ⇒
 * - ownKeys / getOwnPropertySymbols 看得见（数量与原生一致）；
 * - 字符串键面（Object.keys / getOwnPropertyNames）仍只看字符串键（原生同款）。
 *
 * 附注：`builtins/invariants.ts` 的文件头不变量此前把 gOPDs 列进「只枚举
 * 字符串键」清单——与原生不符，已一并修正（该清单仍管 for-in / keys 家族 /
 * gOPN / JSON.stringify 面）。
 *
 * oracle：node v26.10.0 实测。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 1075 — gOPDs 保留 symbol 键（原生走 [[OwnPropertyKeys]]）", () => {
  it("Reflect.ownKeys(gOPDs(o)).length ⇒ 2（native：2；修前：1）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("Object.getOwnPropertySymbols(gOPDs(o)).length ⇒ 1（native：1；修前：0）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertySymbols(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("well-known symbol 键同款：ownKeys 2 条 / getOwnPropertySymbols 1 条（native 同款）", () => {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertySymbols(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("symbol 键的描述符值可读（native：d[Symbol.toStringTag].value === 2）", () => {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return d[Symbol.toStringTag].value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 1075 — 负控制（字符串键面不受影响）", () => {
  it("Object.keys(gOPDs(o)) ⇒ \"a\"（native：symbol 键不进字符串键面）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.keys(d).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.getOwnPropertyNames(gOPDs(o)) ⇒ \"a\"（native：同款）", () => {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertyNames(d).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("无 symbol 键的对象：gOPDs 只有一个字符串键（native 同款）", () => {
    expect(
      val(wrap(`const d = Object.getOwnPropertyDescriptors({ a: 1 }); return Reflect.ownKeys(d).length;`)),
    ).toEqual({ ok: true, value: 1 });
  });
});
