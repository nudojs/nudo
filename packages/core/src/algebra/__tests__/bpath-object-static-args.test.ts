/**
 * Object 静态方法非法参数假精确（原生 THROW，B 路径折出具体值）：
 * - Object.create(5/"x"/1n)：proto 非对象非 null → TypeError，此前折 {}
 * - Object.assign(null/undefined, …)：target nullish → TypeError，此前折 null
 * - Object.defineProperty({}, 'a') 缺描述符 / {get: 5} / {get: null} /
 *   {value+getter|setter} / prim target：TypeError，此前折 {} / {"a":1} / 5
 * - defineProperty 描述符布尔字段未 ToBoolean 化：{writable: 5} 折 false（原生 true）
 * 修复：非法实参 → unknown（THROW 域）；布尔描述符按 truthiness 折叠。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isUnknown(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "unknown";
}

function slotLit(r: unknown, key: string): unknown {
  const a = r as { shape?: { k?: string; slots?: Record<string, { value: unknown }> } };
  const s = a?.shape?.k === "obj" ? a.shape.slots?.[key] : undefined;
  return s ? litValue(s.value as never) : undefined;
}

describe("B-path Object.create proto validation", () => {
  it("primitive proto stays unknown (native THROW)", () => {
    expect(isUnknown(call(`export function f() { return Object.create(5); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.create("x"); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.create(true); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.create(1n); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.create(); }`).result)).toBe(true);
  });

  it("null proto still modeled", () => {
    const r = call(`export function f() { return Object.create(null); }`).result;
    expect(isUnknown(r)).toBe(false);
  });

  it("indirect call shares the fold", () => {
    expect(isUnknown(call(`export function f() { const c = Object.create; return c(5); }`).result)).toBe(true);
  });
});

describe("B-path Object.assign target validation", () => {
  it("nullish target stays unknown (native THROW)", () => {
    expect(isUnknown(call(`export function f() { return Object.assign(null, {a: 1}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.assign(undefined, {a: 1}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.assign(null); }`).result)).toBe(true);
  });

  it("valid target stays exact", () => {
    expect(slotLit(call(`export function f() { return Object.assign({}, {a: 1}); }`).result, "a")).toBe(1);
  });

  it("indirect call shares the fold", () => {
    expect(isUnknown(call(`export function f() { const g = Object.assign; return g(null, {a: 1}); }`).result)).toBe(true);
  });
});

describe("B-path Object.defineProperty descriptor validation", () => {
  it("missing descriptor stays unknown (native THROW)", () => {
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a"); }`).result)).toBe(true);
  });

  it("non-function get/set stays unknown", () => {
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {get: 5}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {get: null}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {set: "x"}); }`).result)).toBe(true);
  });

  it("value mixed with accessor stays unknown", () => {
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {value: 1, get: () => 2}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {value: 1, set: () => {}}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.defineProperty({}, "a", {value: 1, get: 5}); }`).result)).toBe(true);
  });

  it("primitive target stays unknown", () => {
    expect(isUnknown(call(`export function f() { return Object.defineProperty(5, "a", {value: 1}); }`).result)).toBe(true);
    expect(isUnknown(call(`export function f() { return Object.defineProperty(null, "a", {value: 1}); }`).result)).toBe(true);
  });

  it("valid data descriptor stays exact", () => {
    expect(slotLit(call(`export function f() { return Object.defineProperty({}, "a", {value: 1}); }`).result, "a")).toBe(1);
  });

  it("truthy boolean descriptor fields coerce (writable: 5 → true)", () => {
    expect(slotLit(call(`export function f() { return Object.defineProperty({}, "a", {value: 1, writable: 5}); }`).result, "a")).toBe(1);
  });
});
