/**
 * BUG-058 —— `String(x)` / 模板插值用 **default hint** 调 ToPrimitive 钩子
 * ⇒ 原生**根本不调** `valueOf`，nudo 调了 ⇒ 用户可见副作用凭空多出。
 *
 * 根因：`objects.ts` 的 `isNullProtoWithoutCoercer`（ToPrimitive 前置闸门的
 * 统一调用面）把 hint **写死成 `"default"`**；`String()` 面复用它却没传
 * `"string"`。原生规则：ToPrimitive(**string hint**) 先试 `toString`；对象
 * 没有自有 `toString` ⇒ 继承 `Object.prototype.toString` ⇒ 恒返回原语 ⇒
 * **再也不会回退 `valueOf`**（`String({valueOf(){n++}})` 原生 `n` 保持 0）。
 * `+` 走 default hint ⇒ `valueOf` 先 ⇒ 调 1 次（正确）。
 *
 * 修后：`isNullProtoWithoutCoercer(a, hint = "default")` 参数化，hint 随运算
 * 面走——
 * - `builtins/global.ts` 的 `String()` 面传 `"string"`；
 * - `methods.ts` 的 `String.prototype.concat` 传 `"string"`；
 * - 模板插值：降级点（`exec/transpile/expr/atom.ts` 的 TemplateLiteral）给
 *   每个插值位包 `$toStr(...)`（`exec/runtime/ops.ts`），值面沿用既有拼接臂
 *   `concatString`（纯判定，不重调钩子）⇒ `${o}` 与用户手写的 `"" + o`
 *   **不再同形**，`+` 保持 default hint。
 * string hint 下无自有 toString 钩子 ⇒ `invokeToPrimitiveHook` 直接返回
 * undefined，**不回退 valueOf**；用户 toString 返回非原语时仍回退（ES
 * OrdinaryToPrimitive 规定，node 实测）。
 *
 * oracle：node v26 实测。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("BUG-058 · `String(o)` 走 string hint（不调 valueOf）", () => {
  it("`String({valueOf})`：valueOf 不调用（native：0）", () => {
    expect(
      val(
        `export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; String(o); return c; }`,
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("`String({valueOf, toString})`：toString 先、valueOf 不调用（native：1 → 编码 1）", () => {
    expect(
      val(
        `export function f() { let v = 0, t = 0; const o = { valueOf(){ v += 1; return 1; }, toString(){ t += 1; return "s"; } }; String(o); return v * 10 + t; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("`String(o)` 的返回值面仍是 string（值折叠不在本条范围，副作用面已修复）", () => {
    const r = val(
      `export function f() { const o = { valueOf(){ return 1; }, toString(){ return "s"; } }; return String(o); }`,
    );
    // 修前也是非字面量；此处只钉住「不是 number 1」——string hint 下绝不用 valueOf 的结果
    expect(r.ok === false || typeof r.value === "string").toBe(true);
  });
  it("用户 toString 返回非原语 ⇒ 原生回退 valueOf（ES OrdinaryToPrimitive；native:1）", () => {
    expect(
      val(
        `export function f() { let v = 0; const o = { toString(){ return {}; }, valueOf(){ v += 1; return 1; } }; String(o); return v; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("null-proto 无 coercer ⇒ 仍定抛 TypeError（String(Object.create(null))）", () => {
    const r = call(
      `export function f() { return String(Object.create(null)); }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

describe("BUG-058 · `+` 运算符面保持 default hint（回归）", () => {
  it("`o + 1`：valueOf 调一次（native：1）", () => {
    expect(
      val(
        `export function f() { let v = 0; const o = { valueOf(){ v += 1; return 1; } }; o + 1; return v; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("`o + \"\"`：default hint 下 valueOf 先（无自有 valueOf ⇒ toString 一次，native：1）", () => {
    expect(
      val(
        `export function f() { let t = 0; const o = { toString(){ t += 1; return "s"; } }; o + ""; return t; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("`[Symbol.toPrimitive]` 优先于 hint（两种面各调一次）", () => {
    expect(
      val(
        `export function f() { let n = 0; const o = { [Symbol.toPrimitive](){ n += 1; return "s"; } }; String(o); o + 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("BUG-058 · 模板插值走 string hint（`$toStr` 降级位）", () => {
  it("`${o}`：valueOf 不调用（native：0）", () => {
    expect(
      val(
        "export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; const s = `${o}`; return c; }",
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("`${o}` + toString：toString 先、valueOf 不调用（native：编码 1）", () => {
    expect(
      val(
        "export function f() { let v = 0, t = 0; const o = { valueOf(){ v += 1; return 1; }, toString(){ t += 1; return \"s\"; } }; `${o}`; return v * 10 + t; }",
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("两次插值 ⇒ 每次各调一次 toString（native：2）", () => {
    expect(
      val(
        "export function f() { let t = 0; const o = { toString(){ t += 1; return \"s\"; } }; const s = `${o}${o}`; return t; }",
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("`${Symbol()}` ⇒ 原生 TypeError（`String(sym)` 不抛，模板抛）", () => {
    const r = call("export function f() { return `${Symbol()}`; }");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("字面量插值仍折叠（`a${\"b\"}c` ⇒ \"abc\"；`${1}` ⇒ \"1\"）", () => {
    expect(val('export function f() { return `a${"b"}c`; }')).toEqual({
      ok: true,
      value: "abc",
    });
    expect(val("export function f() { return `${1}`; }")).toEqual({
      ok: true,
      value: "1",
    });
  });

  it("bigint / null / undefined 字面量插值恒 total（`${1n}` ⇒ \"1\"，不记 may-throw）", () => {
    expect(val("export function f() { return `${1n}`; }")).toEqual({
      ok: true,
      value: "1",
    });
    expect(call("export function f() { return `${1n}`; }").throws.shape.k).toBe("never");
    expect(val("export function f() { return `${null}`; }")).toEqual({
      ok: true,
      value: "null",
    });
    expect(val("export function f() { return `${undefined}`; }")).toEqual({
      ok: true,
      value: "undefined",
    });
  });

  it("`'x'.concat(o)`：String.prototype.concat 同口径（valueOf 不调用）", () => {
    expect(
      val(
        `export function f() { let c = 0; const o = { valueOf(){ c += 10; return 1; } }; "x".concat(o); return c; }`,
      ),
    ).toEqual({ ok: true, value: 0 });
  });
});
