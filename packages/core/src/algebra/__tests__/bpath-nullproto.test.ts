/**
 * B 路径 Object.create(null) 未建模：$invoke(Object, "create") 无 case 落
 * unknown，随后 `in` 对 unknown 形状按「对象含 Object.prototype 成员」回退，
 * "toString" in Object.create(null) 折 true（原生 false）。修复：
 * create(null) → 空 obj + nullProto 标记侧表；$in 对 nullProto 对象只认
 * 自有槽；标记随 $set/$del 不可变更新迁移；$in 对 unknown 形状回 bool()。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path Object.create(null)", () => {
  it("prototype members are absent", () => {
    const r = call(`export function f() { const o = Object.create(null); return "toString" in o; }`);
    expect(litValue(r.result)).toBe(false);
  });

  it("unknown keys are absent", () => {
    const r = call(`export function f() { const o = Object.create(null); return "x" in o; }`);
    expect(litValue(r.result)).toBe(false);
  });

  it("own slot after write is present", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; return "x" in o; }`,
    );
    expect(litValue(r.result)).toBe(true);
  });

  it("prototype members stay absent after write", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; return "toString" in o; }`,
    );
    expect(litValue(r.result)).toBe(false);
  });

  it("prototype members stay absent after delete", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; delete o.x; return "toString" in o; }`,
    );
    expect(litValue(r.result)).toBe(false);
  });

  it("own slot after delete is absent", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; delete o.x; return "x" in o; }`,
    );
    expect(litValue(r.result)).toBe(false);
  });

  it("regression: plain object keeps prototype members", () => {
    const r = call(`export function f() { const o = {}; return "toString" in o; }`);
    expect(litValue(r.result)).toBe(true);
  });
});
