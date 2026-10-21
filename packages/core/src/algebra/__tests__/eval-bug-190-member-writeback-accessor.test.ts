/**
 * Bug 190：成员路径写回链在「中间层是访问器」时仍把写回打到**根对象** ⇒
 * `o.a.b = 2`（`a` 是 getter）写错了对象（原生只改 getter 返回的对象，
 * **永不**对 `o.a` 做 [[Set]]）。
 *
 * 根因（转译层，core/src/algebra/exec/transpile/member-path.ts）：写回链把
 * 每层都当**写入目标**——`o.a.b = v` 发射成
 * `o = $set(o, "a", $set($get(o, "a"), "b", v))`：末层写在了 getter 返回的
 * 对象上（对），但**中间层**又被打了一次 [[Set]]（错）——访问器层因此：
 * - 只读访问器 ⇒ strict 定抛 TypeError（L2 门禁假红，原生永不抛）；
 * - 有 setter ⇒ setter 被误调（原生不调）。
 *
 * 修法：[[Set]] 只落**末层**——中间层只**取值**（原生语义）；引擎的不可变
 * 更新（$set 返回新 Abs）才把新值补写回上层（原生是就地改，补写只是引擎
 * 建模的可见性补偿）。
 *
 * 负控制：单层路径的 Put 仍走原生访问器语义（setter 被调 / 只读访问器定抛）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错面（brand 名 = 错误构造器名） */
function throwsName(src: string): string | null {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t || !t.shape || t.shape.k === "never") return null;
  return t.shape.k === "brand" ? (t.shape.name ?? "brand") : t.shape.k;
}

describe("Bug 190: 成员路径写回不得打到根（中间层是访问器时）", () => {
  it("D1 o.a.b = 2：写在 getter 返回的对象上（原生 1——getter 每次新对象）", () => {
    expect(
      v(`export function f() { const o = { get a() { return { b: 1 }; } }; o.a.b = 2; return o.a.b; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("D2 h.inner.c += 1：写在 getter 返回的对象上（原生 2——同一对象）", () => {
    expect(
      v(
        `export function f() { class Holder { constructor(){ this._inner = {c:1}; } get inner(){ return this._inner; } } const h = new Holder(); h.inner.c += 1; return h._inner.c; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("D3 o.a.b = 2 不得触发中间层 a 的 setter（原生 0）", () => {
    expect(
      v(
        `export function f() { const o = { _a:{b:1}, calls:0, get a(){ return this._a; }, set a(v){ this.calls++; } }; o.a.b = 2; return o.calls; }`,
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("D4 冻结根的内层仍可写（原生 2——原生不对中间层做 [[Set]]）", () => {
    expect(
      v(`export function f() { const o = Object.freeze({a:{b:1}}); o.a.b = 2; return o.a.b; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("D5 o.a.b += 2（a 是 getter）→ 原生 1，且不抛", () => {
    expect(
      v(`export function f() { const o = { get a() { return { b: 1 }; } }; o.a.b += 2; return o.a.b; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("D6 o.a.b = 2（a 是只读 getter）不抛 TypeError（原生 ok）", () => {
    expect(
      v(
        `export function f() { const o = { get a() { return { b: 1 }; } }; try { o.a.b = 2; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`,
      ),
    ).toEqual({ ok: true, value: "ok" });
  });

  it("D7 delete o.a.b（a 是 getter）不抛（原生 ok）", () => {
    expect(
      v(
        `export function f() { const o = { get a() { return { b: 1 }; } }; try { delete o.a.b; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`,
      ),
    ).toEqual({ ok: true, value: "ok" });
  });

  it("D8 o.a.b++（a 是 getter）不抛（原生 ok）", () => {
    expect(
      v(
        `export function f() { const o = { get a() { return { b: 1 }; } }; try { o.a.b++; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`,
      ),
    ).toEqual({ ok: true, value: "ok" });
  });

  // —— 负控制：单层 Put 仍走原生访问器语义 ——
  it("E1 负控制：单层写 o.a = {b:5}（数据属性）→ 5", () => {
    expect(v(`export function f() { const o = {a:{b:1}}; o.a = {b:5}; return o.a.b; }`)).toEqual({
      ok: true,
      value: 5,
    });
  });

  it("E2 负控制：单层写 o.a = 5 仍触发 setter → 5", () => {
    expect(
      v(`export function f() { const o = { get a(){ return 1; }, set a(v){ this._v = v; } }; o.a = 5; return o._v; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("E3 负控制：单层写 o.a = 5（只读访问器）仍定抛 TypeError", () => {
    expect(
      throwsName(`export function f() { const o = { get a(){ return 1; } }; o.a = 5; return "no-throw"; }`),
    ).toBe("TypeError");
  });

  it("E4 负控制：数据属性链 o.a.b = 2 → 2", () => {
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b = 2; return o.a.b; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("E5 负控制：数据属性链 o.a.b += 2 → 3", () => {
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b += 2; return o.a.b; }`)).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("E6 负控制：数据属性链 o.a.b++ → 2", () => {
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b++; return o.a.b; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("E7 负控制：delete o.a.b（数据属性链）→ gone", () => {
    expect(
      v(`export function f() { const o={a:{b:1}}; delete o.a.b; return "b" in o.a ? "still" : "gone"; }`),
    ).toEqual({ ok: true, value: "gone" });
  });
});
