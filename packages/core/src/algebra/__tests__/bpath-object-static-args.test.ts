/**
 * Object 静态方法非法实参该抛不抛（此前折 unknown/arr 且 throws=never，
 * check L2 漏报 entry-may-throw、catch 分支不可达）+ 字面量折叠缺口：
 * - Object.keys/values/entries(null|undefined)：原生 TypeError
 * - Object.hasOwn(null, k) / Object.getPrototypeOf(null)：原生 TypeError
 * - Object.create()/create(undefined)/create(prim)：原生 TypeError
 * - Object.assign(null|undefined, src)：原生 TypeError
 * - Object.defineProperty(prim|null, …)：原生 TypeError
 * - Object.keys('abc') → ['0','1','2']、values('abc') → ['a','b','c']：
 *   此前折 arr（精度缺口）
 * 修复：evalObjectMethod（+ B-path runtimeAssignObject）nullish/prim 字面量
 * 硬抛 NudoThrow(TypeError)——B 路径经 $catchVal 吸收、ast-eval 在
 * namespace 调用点吸收为 EvalResult{threw}；字符串字面量折叠索引键/字符。
 * hasOwn/getPrototypeOf 新增字面量折叠与 nullish 硬抛。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

function tupleEls(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const els = a.shape.elements!.map((e) => litValue(e as never));
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

describe("B-path Object.keys/values/entries", () => {
  it("folds object slots", () => {
    expect(tupleEls(call(`export function f() { return Object.keys({a:1,b:2}); }`).result)).toEqual(["a", "b"]);
    expect(tupleEls(call(`export function f() { return Object.values({a:1,b:2}); }`).result)).toEqual([1, 2]);
    const er = call(`export function f() { return Object.entries({a:1}); }`).result as {
      shape?: { elements?: Array<{ shape?: { elements?: unknown[] } }> };
    };
    const e0 = er.shape?.elements?.[0]?.shape?.elements;
    expect([litValue(e0?.[0] as never), litValue(e0?.[1] as never)]).toEqual(["a", 1]);
  });

  it("folds string target index keys", () => {
    expect(tupleEls(call(`export function f() { return Object.keys('abc'); }`).result)).toEqual(["0", "1", "2"]);
    expect(tupleEls(call(`export function f() { return Object.values('abc'); }`).result)).toEqual(["a", "b", "c"]);
    expect(tupleEls(call(`export function f() { return Object.keys(5); }`).result)).toEqual([]);
    expect(tupleEls(call(`export function f() { return Object.values(5); }`).result)).toEqual([]);
  });

  it("null/undefined target throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.keys(null); }`,
      `export function f() { return Object.values(null); }`,
      `export function f() { return Object.entries(null); }`,
      `export function f() { return Object.keys(undefined); }`,
      `export function f() { return Object.values(undefined); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("null target caught by try/catch", () => {
    for (const src of [
      `export function f() { try { Object.keys(null); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.values(null); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.entries(undefined); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });
});

describe("B-path Object.hasOwn", () => {
  it("folds own-key presence", () => {
    expect(litValue(call(`export function f() { return Object.hasOwn({a:1}, 'a'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return Object.hasOwn({a:1}, 'b'); }`).result)).toBe(false);
    expect(litValue(call(`export function f() { return Object.hasOwn(Object.create(null), 'a'); }`).result)).toBe(false);
  });

  it("null target throws TypeError", () => {
    const r = call(`export function f() { return Object.hasOwn(null, 'a'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("null target caught by try/catch", () => {
    expect(
      litValue(call(`export function f() { try { Object.hasOwn(null, 'a'); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toBe("caught");
  });
});

describe("B-path Object.getPrototypeOf", () => {
  it("null/undefined target throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.getPrototypeOf(null); }`,
      `export function f() { return Object.getPrototypeOf(undefined); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("non-nullish stays sound (unknown)", () => {
    const r = call(`export function f() { return Object.getPrototypeOf(5); }`);
    expect(isNever(r.result)).toBe(false);
    expect(litValue(r.result)).toBeUndefined();
  });
});

describe("B-path Object.create/assign/defineProperty nullish hard throw", () => {
  it("create() / create(undefined) / create(prim) throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.create(); }`,
      `export function f() { return Object.create(undefined); }`,
      `export function f() { return Object.create(5); }`,
      `export function f() { return Object.create("x"); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("assign nullish target throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.assign(null, {a: 1}); }`,
      `export function f() { return Object.assign(undefined, {a: 1}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("defineProperty prim/null target throws TypeError", () => {
    for (const src of [
      `export function f() { return Object.defineProperty(5, "a", {value: 1}); }`,
      `export function f() { return Object.defineProperty(null, "a", {value: 1}); }`,
      `export function f() { return Object.defineProperty("x", "a", {value: 1}); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("caught by try/catch", () => {
    for (const src of [
      `export function f() { try { Object.create(5); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.assign(null, {a: 1}); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { Object.defineProperty(null, "a", {value: 1}); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("valid targets still fold", () => {
    const r = call(`export function f() { return Object.create(null); }`);
    expect(isNever(r.result)).toBe(false);
    const r2 = call(`export function f() { return Object.assign({}, {a: 1}); }`);
    expect(litValue((r2.result as { shape?: { slots?: Record<string, { value: unknown }> } }).shape?.slots?.a?.value as never)).toBe(1);
    const r3 = call(`export function f() { return Object.defineProperty({}, "a", {value: 1}); }`);
    expect(litValue((r3.result as { shape?: { slots?: Record<string, { value: unknown }> } }).shape?.slots?.a?.value as never)).toBe(1);
  });
});

describe("ast-eval Object statics nullish hard throw", () => {
  it("keys(null) interrupts with never", () => {
    expect(isNever(analyzeFn(`function f() { return Object.keys(null); }`, "f", []))).toBe(true);
  });

  it("keys('abc') folds index keys", () => {
    expect(tupleEls(analyzeFn(`function f() { return Object.keys('abc'); }`, "f", []))).toEqual(["0", "1", "2"]);
  });

  it("hasOwn folds and null target caught", () => {
    expect(litValue(analyzeFn(`function f() { return Object.hasOwn({a:1}, 'a'); }`, "f", []))).toBe(true);
    expect(
      litValue(
        analyzeFn(
          `function f() { try { Object.hasOwn(null, 'a'); } catch(e) { return 'caught'; } return 'missed'; }`,
          "f",
          [],
        ),
      ),
    ).toBe("caught");
  });
});
