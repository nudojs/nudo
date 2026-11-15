/**
 * BUG-164 回归：`Object.prototype` 的 **legacy 四访问器**
 * （`__defineGetter__` / `__defineSetter__` / `__lookupGetter__` /
 * `__lookupSetter__`）在**值读面**不得折 exact undefined。
 *
 * 根因：引擎有**两张** `Object.prototype` 名单——
 * - `exec/member-diag.ts` 的 `OBJECT_PROTO_NAMES`（**11** 个，含 legacy 四件）
 *   —— 被 **`in` 判定**与不可调用判定使用；
 * - `builtins/ctor.ts` 的 `OBJECT_PROTO_METHOD_NAMES`（此前**只有 6** 个，
 *   无 legacy 四件）—— 被**值读面**使用。
 * ⇒ 同一个成员 `in` 面说有、值读面说没有 ⇒ **同一引擎两面结论相反** +
 * 假绿（`({}).__defineGetter__ === undefined` 恒 true）。
 *
 * 修法：值读面那张表补 legacy 四件（两张表同口径）；`__proto__` /
 * `constructor` 走专门臂，不在此列。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

/** litValue 结果解包（ok 时取字面量值） */
const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
import { OBJECT_PROTO_METHOD_NAMES } from "../builtins/ctor.ts";
import { OBJECT_PROTO_NAMES } from "../exec/member-diag.ts";

const wrap = (body: string): string => `export function f() { ${body} }`;

const LEGACY = [
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
] as const;

describe("BUG-164：Object.prototype legacy 四访问器（值读面与 `in` 面同口径）", () => {
  it("legacy 四件的 `=== undefined` 恒 false（原生恒是函数）", () => {
    for (const k of LEGACY) {
      expect(lit(wrap(`return ({}).${k} === undefined;`))).toBe(false);
      expect(lit(wrap(`return typeof ({}).${k};`))).toBe("function");
    }
  });

  it("legacy 四件的 `in` 面仍为 true（与值读面同结论）", () => {
    for (const k of LEGACY) {
      expect(lit(wrap(`return "${k}" in {};`))).toBe(true);
    }
  });

  it("对照组：既有六件两表都有 ⇒ 值读面仍正确", () => {
    for (const k of ["toString", "valueOf", "toLocaleString", "hasOwnProperty",
      "isPrototypeOf", "propertyIsEnumerable"]) {
      expect(lit(wrap(`return ({}).${k} === undefined;`))).toBe(false);
    }
  });

  it("同步守卫：`in` 面名单 ⊆ 值读面名单 ∪ {constructor, __proto__}", () => {
    const special = new Set(["constructor", "__proto__"]);
    for (const n of OBJECT_PROTO_NAMES) {
      if (special.has(n)) continue;
      expect(
        OBJECT_PROTO_METHOD_NAMES.has(n),
        `OBJECT_PROTO_NAMES 里的 ${n} 未登记进值读面名单（两张表必须同口径）`,
      ).toBe(true);
    }
  });
});
