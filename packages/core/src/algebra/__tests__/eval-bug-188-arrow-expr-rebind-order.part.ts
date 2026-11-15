/**
 * Bug 188 回归：箭头 / 函数表达式**表达式体**的成员目标写回被排在
 * `return <表达式>` 之前 ⇒ `() => o.n++` 返回**写后**值（原生是写前值）。
 *
 * 修复前（表达式体发射，expr/function.ts）：先发 rebinds（写回），再
 * `return <表达式>` ⇒ 表达式读到的是**写后**状态。
 *
 * 现状说明：成员臂自增（`o.n++`）与可选链 delete 的写回都已「下沉到求值
 * 点」——表达式自身捕获写前值 / 完成删除与写回，不再有语句级补正排在
 * 表达式求值之后或之前。本回归钉住该口径：可选链 delete 的箭头表达式体
 * 直接返回自包含 IIFE，不再出现 `__mutRet` 语句级捕获与二次 `$fork` 写回；
 * async 表达式体的删除/写回仍在 `$async` thunk 内。
 *
 * 不变量（负控制钉住）：块体箭头的写回照旧发生；只读箭头取值不变；函数
 * 表达式的块体体不受影响；捕获临时名避让用户标识符（用户自己有
 * `__mutRet` 时不得 TDZ）。
 */
import { describe, it, expect } from "vitest";
import { litValue, transpileSource } from "@nudojs/core";
import { callLit } from "./eval-helpers.ts";

/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

describe("Bug 188 — 表达式体的写回排在表达式取值之后", () => {
  it("`() => o.n++` 返回写前值 0（原生同），写回仍发生（o.n = 1）", () => {
    const src = `export function f() {
      const o = { n: 0 };
      const g = () => o.n++;
      const r = g();
      return r * 100 + o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("可选链 delete 的写回已下沉到表达式内（无语句级二次发射）", () => {
    const js = transpileSource(`export function f() {
      const o = { a: 1 };
      const g = () => delete o?.a;
      return g();
    }`);
    // 表达式体直接返回自包含删除/写回 IIFE；不再有 __mutRet 捕获与
    // 独立的语句级 $fork 写回（那会二次求值计算键 / 二次派发 Proxy 陷阱）。
    expect(js).not.toContain("let __mutRet =");
    const del = js.indexOf("$del(");
    const write = js.indexOf("o = __nudoDelN");
    expect(del).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(del);
  });

  it("async 表达式体的删除/写回同在 $async thunk 内（写回不逸出 thunk）", () => {
    const js = transpileSource(`export function f() {
      const o = { a: 1 };
      const g = async () => delete o?.a;
      return g();
    }`);
    const thunk = js.indexOf("$async(() =>");
    const del = js.indexOf("$del(");
    const write = js.indexOf("o = __nudoDelN");
    expect(thunk).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(thunk);
    expect(write).toBeGreaterThan(del);
  });
});

describe("Bug 188 — 负控制：写回 / 取值语义不被改写", () => {
  it("块体箭头的写回照旧发生", () => {
    const src = `export function f() {
      const o = { n: 0 };
      const g = () => { o.n++; };
      g();
      return o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("只读箭头取值不变", () => {
    const src = `export function f() {
      const o = { n: 7 };
      const g = () => o.n;
      return g();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 7 });
  });

  it("函数表达式的块体体不受影响（返回写前值）", () => {
    const src = `export function f() {
      const o = { n: 0 };
      const g = function () { return o.n++; };
      const r = g();
      return r * 100 + o.n;
    }`;
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("捕获临时名避让用户标识符（用户自己有 __mutRet 不得 TDZ）", () => {
    const src = `export function f() {
      const __mutRet = 5;
      const o = { a: 1 };
      const g = () => delete o?.a;
      const r = g();
      return r + ":" + __mutRet;
    }`;
    expect(v(src)).toEqual({ ok: true, value: "true:5" });
  });
});
