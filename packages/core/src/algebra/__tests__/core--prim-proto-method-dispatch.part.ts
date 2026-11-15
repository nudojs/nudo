/**
 * BUG-007 回归：`number` / `boolean` 原型方法不得落 `Object.prototype` 泛型版。
 *
 * 根因（`packages/core/src/algebra/exec/runtime/containers/member.ts`
 * `getProtoMethodMember` 的 prim 通道例外清单）：`toString` / `toLocaleString`
 * / `valueOf` 三者都在 `OBJECT_PROTO_METHOD_NAMES` 里，prim 通道必须**显式**
 * 例外才能进；例外清单此前只列了 string（Bug 49）、bigint（Bug 105）、
 * symbol（独立臂，member.ts 的 `symbolProtoMethodAbs`）⇒ **number / boolean
 * 从未被加入** ⇒ 落 `objectProtoMethodAbs(key)` ⇒
 *   - **错值**：`[object Number]` / `[object Boolean]`（原生是 "5" / "true"）；
 *   - **丢 brand check**：`(5).toString.call("x")` 原生定抛 TypeError，引擎
 *     照常返回值 ⇒ L2 `nudo:entry-may-throw` 闸门**假绿**。
 *
 * 修法：prim 通道例外补 number（toString / toLocaleString / valueOf）与
 * boolean（toString / valueOf）；`PRIM_HOME_BRAND`（number→Number /
 * boolean→Boolean）已就位 ⇒ 借用调用的 brand check 生效。
 */
import { describe, it, expect } from "vitest";
import { call, val, throwsError } from "./eval-helpers.ts";

/** litValue 结果解包（ok 时取字面量值） */
const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;

describe("BUG-007：number / boolean 原型方法走自己的原型面", () => {
  it("(5).toString.call(5) ⇒ \"5\"（不是 \"[object Number]\"）", () => {
    expect(lit(wrap("return (5).toString.call(5);"))).toBe("5");
  });

  it("true.toString.call(true) ⇒ \"true\"（不是 \"[object Boolean]\"）", () => {
    expect(lit(wrap("return true.toString.call(true);"))).toBe("true");
  });

  it("(5).toString.call(\"x\") ⇒ 定抛 TypeError（brand check）", () => {
    const rec = call(wrap("return (5).toString.call(\"x\");"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("(5).toString.call(5n) ⇒ 定抛 TypeError（brand check）", () => {
    const rec = call(wrap("return (5).toString.call(5n);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("(5).toString.call(true) ⇒ 定抛 TypeError（brand check）", () => {
    const rec = call(wrap("return (5).toString.call(true);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("true.toString.call(0) ⇒ 定抛 TypeError（brand check）", () => {
    const rec = call(wrap("return true.toString.call(0);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("(5).valueOf.call(5) ⇒ 5（自身）", () => {
    expect(lit(wrap("return (5).valueOf.call(5);"))).toBe(5);
  });

  it("true.valueOf.call(true) ⇒ true（自身）", () => {
    expect(lit(wrap("return true.valueOf.call(true);"))).toBe(true);
  });

  it("对照：string / bigint / symbol 三条 prim 通道仍与原生一致", () => {
    expect(lit(wrap("return \"a\".toString.call(\"a\");"))).toBe("a");
    expect(lit(wrap("return (5n).toString.call(5n);"))).toBe("5");
    expect(lit(wrap("return Symbol(\"x\").toString.call(Symbol(\"x\"));"))).toBe("Symbol(x)");
  });
});
