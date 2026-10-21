/**
 * Bug 188 回归：箭头 / 函数表达式**表达式体**的成员目标写回被排在
 * `return <表达式>` 之前 ⇒ `() => o.n++` 返回**写后**值（原生是写前值）。
 *
 * 修复前（表达式体发射，expr/function.ts）：先发 rebinds（写回），再
 * `return <表达式>` ⇒ 表达式读到的是**写后**状态。
 *
 * 现状说明：成员臂自增（`o.n++`）此前已被「写回下沉到求值点」的批次改成
 * 自洽（表达式自身捕获写前值），本条缺陷在**值面**已不可见；残留的是
 * **发射顺序**缺陷——写回（转译侧补正）仍排在宿主表达式求值**之前**，且表达
 * 式体没有像语句级 `emitRet` 那样「先捕获表达式值 → 再写回 → 返回捕获值」。
 * 本回归钉住该口径：捕获在写回**之前**，返回的是捕获值。
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

  it("发射顺序：先捕获表达式值 → 再写回 → 返回捕获值", () => {
    const js = transpileSource(`export function f() {
      const o = { a: 1 };
      const g = () => delete o?.a;
      return g();
    }`);
    const cap = js.indexOf("let __mutRet =");
    const rebind = js.indexOf("$fork($nullishTest(o)");
    const ret = js.indexOf("return __mutRet;");
    expect(cap).toBeGreaterThan(-1);
    expect(rebind).toBeGreaterThan(-1);
    expect(ret).toBeGreaterThan(-1);
    // 捕获 < 写回 < 返回捕获值
    expect(cap).toBeLessThan(rebind);
    expect(rebind).toBeLessThan(ret);
  });

  it("async 表达式体的捕获与写回同在 $async thunk 内（写回不逸出 thunk）", () => {
    const js = transpileSource(`export function f() {
      const o = { a: 1 };
      const g = async () => delete o?.a;
      return g();
    }`);
    const thunk = js.indexOf("$async(() => {");
    const cap = js.indexOf("let __mutRet =");
    const rebind = js.indexOf("$fork($nullishTest(o)");
    expect(thunk).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(thunk);
    expect(rebind).toBeGreaterThan(cap);
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
