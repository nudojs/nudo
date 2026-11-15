/**
 * Bug 299 回归：`Reflect.set` 落 [[Set]] 语义——**第 4 实参 receiver** 参与
 * 写语义，且 Proxy 走**反射口径**（ToBoolean(陷阱结果)，失败返 false 不抛）。
 *
 * 原生（node v26 实测，ES2024 13.15.2 OrdinarySetWithOwnDescriptor）：
 * - `Reflect.set(t,"a",2,r)`：t 有自有数据属性 "a" ⇒ **receiver** 建自有
 *   数据属性（t 不变、r.a = 2）；t 无自有 "b" ⇒ 沿原型链上溯后 receiver 建
 *   自有属性（t.b 仍 undefined）；
 * - receiver 自有**访问器**属性 ⇒ 写门失败 → 返 **false**（不抛）；
 * - Proxy 的 set 陷阱返 false / 0 ⇒ `Reflect.set` 返 **false**（不抛）——
 *   抛错是**赋值运算符**（strict）的语义，不是 Reflect 的语义。
 *
 * 修复前：第 4 实参被丢弃（写恒落在 target 上）；Proxy 走 $set 的赋值口径
 * ⇒ 陷阱返 false 时定抛 TypeError、返回值恒 true。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 299 — Reflect.set 的 receiver 语义 + Proxy 反射口径", () => {
  it("第 4 实参 receiver：写落在 receiver，target 不变", () => {
    expect(
      v(
        wrap(
          `const t = { a: 1 }; const r = { a: 9 }; Reflect.set(t, "a", 2, r); return String(t.a) + ":" + String(r.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1:2" });
  });

  it("第 4 实参 receiver：target 无自有键 ⇒ receiver 建自有键，target 不变", () => {
    expect(
      v(
        wrap(
          `const t = { a: 1 }; const r = {}; Reflect.set(t, "b", 2, r); return String(r.b) + ":" + String(t.b);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2:undefined" });
  });

  it("receiver 自有访问器属性 → 写门失败返 false（原生不抛、不改写）", () => {
    expect(
      v(
        wrap(
          `const t = {}; const r = { set v(x){ this._v = x; }, get v(){ return this._v; } }; const ok = Reflect.set(t, "v", 5, r); return String(ok) + ":" + String(r.v);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false:undefined" });
  });

  it("缺省 receiver ≡ target：写在 target 上", () => {
    expect(
      v(wrap(`const o = { a: 1 }; Reflect.set(o, "a", 2); return String(o.a);`)),
    ).toEqual({ ok: true, value: "2" });
  });

  it("Proxy set 陷阱返 false / 0 → Reflect.set 返 false（改前定抛 TypeError）", () => {
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => false }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => 0 }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      thrown(wrap(`const p = new Proxy({}, { set: () => false }); Reflect.set(p, "x", 1);`)),
    ).toBeUndefined();
  });

  it("Proxy set 陷阱返 true → Reflect.set 返 true", () => {
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => true }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "true" });
  });

  it("冻结目标 → 返 false（原生不抛）", () => {
    expect(
      v(wrap(`const o = Object.freeze({ a: 1 }); return String(Reflect.set(o, "a", 2));`)),
    ).toEqual({ ok: true, value: "false" });
  });
});
