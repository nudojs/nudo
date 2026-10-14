/**
 * Bug 19 回归：语句位 `Object.defineProperties(o, props)` 不回写 o。
 * 根因：描述符安装是「不可变更新 + 返回 target」的单一机器
 * （applyPropertyDescriptor，object.ts），语句位置必须由 transpile 的
 * rebind 通道把返回容器写回第一实参绑定——emitArrMutatorRebinds 原本只
 * 特判 defineProperty（单数），defineProperties 掉进两条变更通道的缝隙：
 * 表达式位走返回值、Reflect.defineProperty 走内建就地写回，唯独
 * Object.defineProperties 语句位两者都不沾 → 安装落在被丢弃的副本上，
 * o.a 折 exact undefined。修复：rebind 条件扩为
 * defineProperty || defineProperties（同第一实参 Identifier 形态）。
 *
 * node 实测 ground truth（见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue, type Abs } from "../abs.ts";

function evalAbs(src: string, fnName = "f"): Abs | undefined {
  const run = runTranspiled(src, { mode: "analyze" });
  try {
    const out = callTranspiledExportFull(run, fnName, []) as {
      result?: Abs;
      throws?: unknown;
    };
    return out.result;
  } catch {
    return undefined;
  }
}

function litOf(a: Abs | undefined): unknown {
  const r = a ? litValue(a) : undefined;
  return r?.ok ? r.value : undefined;
}

/** tuple 结果逐元素折字面量（litValue 不折 tuple 形态） */
function tupleLitsOf(a: Abs | undefined): unknown[] | undefined {
  if (a?.shape.k !== "tuple") return undefined;
  return a.shape.elements.map((e) => litOf(e));
}

describe("Bug 19: statement-level Object.defineProperties writes back to target", () => {
  it("语句位数据描述符：o.a → 1（native 1，修复前 exact undefined）", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.defineProperties(o, { a: { value: 1 } }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("语句位多键描述符：[o.a,o.b] → [1,2]（native [1,2]，修复前 imprecise）", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.defineProperties(o, { a: { value: 1 }, b: { value: 2 } }); return [o.a, o.b]; }`,
    );
    expect(tupleLitsOf(r)).toEqual([1, 2]);
  });

  it("语句位 getter 描述符：o.a → 1（native 1，修复前 undefined）", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.defineProperties(o, { a: { get() { return 1; } } }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("getter/setter 描述符面：o.x=3 → [o.x, o._v] = [5,3]（native [5,3]）", () => {
    const r = evalAbs(
      `function f() {
        const o = {};
        Object.defineProperties(o, { x: { get() { return 5; }, set(v) { this._v = v; } } });
        o.x = 3;
        return [o.x, o._v];
      }`,
    );
    expect(tupleLitsOf(r)).toEqual([5, 3]);
  });

  it("语句位 writable 数据描述符可写：o.a=2 → 2（native 2）", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.defineProperties(o, { a: { value: 1, writable: true } }); o.a = 2; return o.a; }`,
    );
    expect(litOf(r)).toBe(2);
  });

  it("控制组：Object.defineProperty（单数）语句位 o.a → 1", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.defineProperty(o, "a", { value: 1 }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("控制组：Reflect.defineProperty 语句位 o.a → 1", () => {
    const r = evalAbs(
      `function f() { const o = {}; Reflect.defineProperty(o, "a", { value: 1 }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("控制组：表达式位 const o = Object.defineProperties({}, …) → o.a = 1", () => {
    const r = evalAbs(
      `function f() { const o = Object.defineProperties({}, { a: { value: 1 } }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("控制组：表达式位直接点读 Object.defineProperties({}, …).a → 9（native 9）", () => {
    const r = evalAbs(
      `function f() { return Object.defineProperties({}, { a: { value: 9 } }).a; }`,
    );
    expect(litOf(r)).toBe(9);
  });

  it("控制组：Object.assign 语句位 o.a → 1", () => {
    const r = evalAbs(
      `function f() { const o = {}; Object.assign(o, { a: 1 }); return o.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });

  it("语句位调用返回值另存：const p = Object.defineProperties(o, …) → p.a = 1（native 1）", () => {
    const r = evalAbs(
      `function f() { const o = {}; const p = Object.defineProperties(o, { a: { value: 1 } }); return p.a; }`,
    );
    expect(litOf(r)).toBe(1);
  });
});
