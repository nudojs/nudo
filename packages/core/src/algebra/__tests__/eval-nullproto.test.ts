/**
 * 求值引擎 Object.create(null) 未建模：$invoke(Object, "create") 无 case 落
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

describe("evaluator Object.create(null)", () => {
  it("prototype members are absent", () => {
    const r = call(`export function f() { const o = Object.create(null); return "toString" in o; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("unknown keys are absent", () => {
    const r = call(`export function f() { const o = Object.create(null); return "x" in o; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("own slot after write is present", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; return "x" in o; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("prototype members stay absent after write", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; return "toString" in o; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("prototype members stay absent after delete", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; delete o.x; return "toString" in o; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("own slot after delete is absent", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; delete o.x; return "x" in o; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("regression: plain object keeps prototype members", () => {
    const r = call(`export function f() { const o = {}; return "toString" in o; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});

describe("evaluator Object.create(null) instanceof", () => {
  it("instanceof Object is false (null-terminated chain)", () => {
    const r = call(`export function f() { const o = Object.create(null); return o instanceof Object; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("instanceof builtin ctors is false", () => {
    const r = call(`export function f() { const o = Object.create(null); return o instanceof Array; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
    const r2 = call(`export function f() { const o = Object.create(null); return o instanceof Date; }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: false });
  });

  it("instanceof user class is false", () => {
    const r = call(
      `export function f() { class C {} const o = Object.create(null); return o instanceof C; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("stays false after writes migrate the nullProto mark", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; return o instanceof Object; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("stays false after delete", () => {
    const r = call(
      `export function f() { const o = Object.create(null); o.x = 1; delete o.x; return o instanceof Object; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("regression: plain object is instanceof Object", () => {
    const r = call(`export function f() { const o = {}; return o instanceof Object; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("regression: Object.create(C.prototype) is not falsely decided", () => {
    const r = call(
      `export function f() { class C {} const o = Object.create(C.prototype); return o instanceof Object; }`,
    );
    // 对象原型实参不建模（保守 unknown 路径）：不得折成 false
    const r0 = litValue(r.result);
    expect(!r0.ok || r0.value === true || r0.value === undefined).toBe(true);
  });
});
