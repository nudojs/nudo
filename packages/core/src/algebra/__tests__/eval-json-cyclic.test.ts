/**
 * Bug 20：JSON.stringify 环形值——totality 预检 jsonStringifyTotal 对
 * obj 槽/tuple 元素递归无环守卫，而成员写 $set 就地改槽（引用语义，
 * `o.self = o` 产出真 Abs 环）→ 预检无限递归引擎栈溢出：用户 catch 面
 * 观察到 RangeError（原生 TypeError: Converting circular structure to
 * JSON），无 catch 面整评退化 internal eval-error → unknown + RangeError
 * throws 品牌。修复：预检带 seen 集（与 absToJsonNative 同构），环 →
 * not total → 既有软 may-throw 臂（记 may TypeError + partial 值域不变，
 * Bug 46 同源设计）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

function call(
  src: string,
  fnName = "f",
): { result: unknown; throws: unknown; effects: string[] } {
  const exports = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(exports, fnName, []) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("JSON.stringify cyclic receivers (Bug 20)", () => {
  it("self-referencing object: no engine crash, may TypeError, string partial", () => {
    const r = call(
      `export function f() { const o = {}; o.self = o; return JSON.stringify(o); }`,
    );
    // 原生定抛 TypeError；引擎软 may-throw：值域 string partial（不伪装精确），
    // 不再栈溢出退化 unknown / RangeError 品牌
    expect(formatShape(r.result as never)).toBe("string");
    expect(r.effects).toContain("TypeError");
  });

  it("user catch arm no longer observes RangeError identity", () => {
    const r = call(
      `export function f() {
        const o = {}; o.self = o;
        try { return JSON.stringify(o); } catch (e) { return e.constructor.name; }
      }`,
    );
    // 此前：引擎自身 RangeError 泄入用户 catch（原生 "TypeError"）。
    // 修复后软 may-throw 不实际抛出 → 返回 string partial（不进 catch）
    expect(formatShape(r.result as never)).toBe("string");
    const lv = litValue(r.result as never);
    expect(lv.ok).toBe(false); // 非 never/RangeError 字面量
  });

  it("circular array (a.push(a)) records may TypeError without crash", () => {
    const r = call(
      `export function f() { const a = []; a.push(a); return JSON.stringify(a); }`,
    );
    expect(formatShape(r.result as never)).toBe("string");
    expect(r.effects).toContain("TypeError");
  });

  it("nested circular structure (o.a.b.c = o.a) records may TypeError", () => {
    const r = call(
      `export function f() { const o = { a: { b: {} } }; o.a.b.c = o.a; return JSON.stringify(o); }`,
    );
    expect(formatShape(r.result as never)).toBe("string");
    expect(r.effects).toContain("TypeError");
  });

  it("control: non-cyclic o.self = {} folds exactly, no may-throw", () => {
    const r = call(
      `export function f() { const o = {}; o.self = {}; return JSON.stringify(o); }`,
    );
    expect(litValue(r.result as never)).toEqual({ ok: true, value: '{"self":{}}' });
    expect(r.effects).toEqual([]);
  });

  it("control: closed all-prim object stays total (no may-throw, partial fold)", () => {
    const r = call(
      `export function f() { const o = {}; o.a = 1; o.b = "x"; return JSON.stringify(o); }`,
    );
    expect(litValue(r.result as never)).toEqual({ ok: true, value: '{"a":1,"b":"x"}' });
    expect(r.effects).toEqual([]);
  });
});
