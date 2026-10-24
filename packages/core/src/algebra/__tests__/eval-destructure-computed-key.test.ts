/**
 * Bug 160：对象**解构**的计算键是**裸标识符**时，引擎读的是 `o["<标识符名>"]`
 * 而不是 `o[k]` → 恒读成 `undefined`（精确错值），且 `k` 从未被求值。
 *
 * 根因：transpile/helpers.ts 的 `staticKeyOf` 只看节点的 type/name，**不看
 * computed 标志**——对象**字面量**属性用它是对的（`{ dyn: v }` 标识符名 =
 * 键名），但用在**解构模式**的 ObjectProperty 上时，`prop.key` 是
 * `computed: true` 的**表达式**，`Identifier` 形态必须**求值**。
 * 附带：rest 的排除集只收静态键名 → 计算键仍留在 rest 里（原生按求值后的
 * 键排除）。
 *
 * 修法：解构侧先判 `isComputed`——计算键的裸标识符强制走计算键路径
 * （键表达式绑定临时量：原生求值一次，读与 rest 排除集共用同一值）。
 *
 * 不变量（负控制）：字面量计算键（`{ [1]: v }` / `{ ["x"]: v }`）与普通键
 * （`{ dyn: v }`）仍走静态键路径（原生同：字面量键无副作用）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 160: 解构的计算键（裸标识符）按值读，不按标识符名读", () => {
  it("`{ [k]: v } = o` 读 o[k]（不是 o[\"k\"]）", () => {
    expect(
      v(`export function f() { let k = "dyn"; const o = { dyn: 42 }; const { [k]: v } = o; return v; }`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("计算键**只求值一次**（原生口径：读与 rest 排除集共用同一值）", () => {
    expect(
      v(`export function f() { let n = 0; const k = (n++, "dyn"); const o = { dyn: 42 }; const { [k]: v } = o; return n + "/" + v; }`),
    ).toEqual({ ok: true, value: "1/42" });
  });

  it("rest 排除集按**求值后的键**（原生：k 的值不留在 rest 里）", () => {
    expect(
      v(`export function f() { const k = "a"; const o = { a: 1, b: 2 }; const { [k]: v, ...r } = o; return Object.keys(r).join(","); }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("多个计算键 + rest", () => {
    expect(
      v(`export function f() { const k1 = "a"; const k2 = "b"; const o = { a: 1, b: 2, c: 3 }; const { [k1]: v1, [k2]: v2, ...r } = o; return v1 + "" + v2 + "/" + Object.keys(r).join(","); }`),
    ).toEqual({ ok: true, value: "12/c" });
  });

  it("默认值位：计算键 + AssignmentPattern", () => {
    expect(
      v(`export function f() { const k = "dyn"; const o = {}; const { [k]: v = 5 } = o; return v; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("形参位与赋值位同样按值读", () => {
    expect(
      v(`export function f() { function g({ [k]: v }) { return v; } const k = "dyn"; return g({ dyn: 9 }); }`),
    ).toEqual({ ok: true, value: 9 });
    expect(
      v(`export function f() { const k = "dyn"; const o = { dyn: 42 }; let v; ({ [k]: v } = o); return v; }`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("负控制：字面量计算键与普通键仍走静态键路径", () => {
    expect(v(`export function f() { const o = { 1: 42 }; const { [1]: v } = o; return v; }`)).toEqual({
      ok: true,
      value: 42,
    });
    expect(v(`export function f() { const o = { dyn: 42 }; const { dyn: v } = o; return v; }`)).toEqual({
      ok: true,
      value: 42,
    });
  });

  it("负控制：其它计算键形态不变（调用 / 成员表达式）", () => {
    expect(
      v(`export function f() { const o = { x: 7 }; const { [String("x")]: v } = o; return v; }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`export function f() { const key = { n: "x" }; const o = { x: 7 }; const { [key.n]: v } = o; return v; }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("负控制：无计算键的 rest 排除集不变", () => {
    expect(
      v(`export function f() { const o = { a: 1, b: 2 }; const { a, ...r } = o; return a + "/" + Object.keys(r).join(","); }`),
    ).toEqual({ ok: true, value: "1/b" });
  });
});
