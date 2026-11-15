/**
 * Bug 381 —— 用户转换钩子（`valueOf` / `toString` / `@@toPrimitive` / `toJSON`）
 * 从不被调用：确定 `no-throw` 假阴性 + 状态确折错值。
 *
 * 修前（HEAD）：隐式强转路径对 user obj 的钩子槽**只做存在性判定**（探到槽就
 * 不折默认标签）⇒ 钩子体**从不执行** ⇒
 *   - 钩子副作用（计数器 / 捕获变量写）全丢：`valueOfCounter() => 0`
 *   - 钩子体**确定抛错**的代码被折成**确定不抛**：`hookThrowerCall() => "no-throw"`
 *     （native "threw"）——L2 `entry-may-throw` 对必然抛错的入口完全无感。
 *
 * 修后：钩子体**真调用**（`$invoke` 调用面：objects.ts 的
 * `coercionHookOf` / `invokeToPrimitiveHook` / `invokeCoercionHook`）——
 * 副作用发生、throw 域随之而来（钩子体抛错 → NudoThrow 传播 ⇒ 用户 try/catch
 * 可吸收 ⇒ 原生同款）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 381 · `+` 运算符面的用户转换钩子真调用", () => {
  it("`o + o`：valueOf 被调两次（native：每个操作数各一次）", () => {
    expect(
      val(`export function f() { let n = 0; const o = { valueOf(){ n++; return 1; } }; o + o; return n; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("`o + \"\"`：toString 被调一次（native：1）", () => {
    expect(
      val(`export function f() { let n = 0; const o = { toString(){ n++; return "s"; } }; o + ""; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("`o + 1`：[Symbol.toPrimitive] 被调一次（native：1）", () => {
    expect(
      val(
        `export function f() { let n = 0; const o = { [Symbol.toPrimitive](){ n++; return 1; } }; o + 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("模板串面：`${o}` 走同一条 ToPrimitive 闸门（native：1）", () => {
    expect(
      val(`export function f() { let n = 0; const o = { toString(){ n++; return "s"; } }; const s = \`\${o}\`; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 381 · 钩子体抛错 ⇒ 抛错域不再被折成 no-throw", () => {
  it("`o + 1` 的 valueOf 抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        `export function f() { const o = { valueOf(){ throw new Error("v"); } }; try { o + 1; } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("`o + \"\"` 的 toString 抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        `export function f() { const o = { toString(){ throw new Error("s"); } }; try { o + ""; } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("入口 throws 面记下钩子体的错误类型（钩子体必然抛错 ⇒ 入口不再折 never）", () => {
    const rec = call(
      `export function f() { const o = { valueOf(){ throw new Error("v"); } }; o + 1; return 1; }`,
    );
    // 原生：钩子体抛的 Error 直接传播 ⇒ 入口的 throws 面就是用户的 Error
    expect(throwsError(rec.throws, "Error")).toBe(true);
  });
});

describe("Bug 381 · JSON.stringify 的 toJSON 步真调用", () => {
  it("toJSON 钩子被调一次（native：1）", () => {
    expect(
      val(`export function f() { let n = 0; const o = { toJSON(){ n++; return 1; } }; JSON.stringify(o); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("toJSON 钩子抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）", () => {
    expect(
      val(
        `export function f() { const o = { toJSON(){ throw new Error("j"); } }; try { JSON.stringify(o); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  });
});

describe("Bug 381 · new Error(对象实参) 走 ToString ⇒ 钩子真调用", () => {
  it("toString 钩子抛错 ⇒ 构造面抛（native：throw Error: boom）", () => {
    const rec = call(
      `export function f() { return new Error({ toString(){ throw new Error("boom"); } }).message; }`,
    );
    expect(throwsError(rec.throws, "Error")).toBe(true);
  });
});

describe("Bug 381 · 对照组（无钩子 / 直接调用）不得回归", () => {
  it("无钩子的对象不产生任何钩子副作用", () => {
    expect(val(`export function f() { let n = 0; const o = {}; o + ""; return n; }`)).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("直接调用 o.valueOf() 仍调一次（对照组）", () => {
    expect(
      val(`export function f() { let n = 0; const o = { valueOf(){ n++; return 1; } }; o.valueOf(); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("`{a:1} + ''` 仍折 \"[object Object]\"（无钩子 → 缺省 toString）", () => {
    expect(val(`export function f() { return {a:1} + ''; }`)).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });
});
