/**
 * BUG-181 回归：`Reflect.set(target, key, value, receiver)` 的 receiver 为
 * **原始值**时不得判 TypeError——规范返回面是 `false`（不抛）。
 *
 * 原生（node v26，ES2024 10.1.9.2 OrdinarySetWithOwnDescriptor）：data 臂
 * 「If Receiver is not an Object, return false」；accessor 臂照常派发 setter
 * （this = 原始值）⇒ true。两条臂都不抛 ⇒ 引擎返回面必须是 boolean。
 *
 * 修复前：字面量原始值臂与抽象 prim 臂**定抛** TypeError（`never throws
 * TypeError`）⇒ L2 假红；而 null（同样非对象）因 `!== null` 例外偶然判
 * boolean ⇒ 同一函数内三种 receiver 两种结论。也直接违反本文件头不变量
 * 「Reflect.* 的写面失败一律返 false 不抛」。
 */
import { describe, it, expect } from "vitest";
import { call, effects, isNever, throwsError } from "./eval-helpers.ts";
import { formatShape } from "../format.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果面字符串（formatShape）：boolean / true / false / never / … */
function face(src: string): string {
  return formatShape(call(src).result);
}

describe("BUG-181 — Reflect.set 的非对象 receiver 返 boolean 不抛", () => {
  it("数字字面量 receiver → boolean，定抛面消失", () => {
    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, 1);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(isNever(call(src).result)).toBe(false);
  });

  it("显式 undefined receiver → boolean（此前「never throws TypeError」）", () => {
    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, undefined);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
  });

  it("null receiver 控制组结论不变 → boolean", () => {
    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, null);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
  });

  it("三种非对象 receiver 均不记 may-throw（规范返回面是 false 不是异常）", () => {
    for (const recv of ["1", "undefined", "null", `"s"`]) {
      expect(
        effects(wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, ${recv});`)),
      ).not.toContain("TypeError");
    }
  });

  it("非对象 receiver ⇒ 写门失败，target 不变（原生 [[Set]] 不落写）", () => {
    expect(face(wrap(`const o = { k: 0 }; Reflect.set(o, "k", 1, 1); return String(o.k);`)))
      .toEqual('"0"');
    expect(face(wrap(`const o = { k: 0 }; Reflect.set(o, "k", 1, null); return String(o.k);`)))
      .toEqual('"0"');
  });

  it("对象 receiver 的既有语义不受影响（写落 receiver）", () => {
    expect(
      face(
        wrap(
          `const t = { a: 1 }; const r = { a: 9 }; Reflect.set(t, "a", 2, r); return String(t.a) + ":" + String(r.a);`,
        ),
      ),
    ).toEqual('"1:2"');
  });
});
