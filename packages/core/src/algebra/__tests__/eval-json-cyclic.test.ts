/**
 * Bug 20 → Bug 60：JSON.stringify 环形值。Bug 20 修复了 jsonStringifyTotal
 * 预检无环守卫的栈溢出（软 may-throw + partial 值域）；Bug 60 进一步把
 * **可判定环**（$set 就地写槽的引用语义，`o.self = o` 产出真 Abs 环；
 * seen 集改「在栈」语义——重入即真环，共享非环引用 `{x:t,y:t}` 不误伤）
 * 升级为原生同面硬抛 TypeError「Converting circular structure to JSON」
 * （catch 可吸收）；extract 模式（replacer 白名单）环不抛，保持
 * NOT_LITERAL。
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

function isThrowsBrand(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

describe("JSON.stringify cyclic receivers (Bug 20 / Bug 60)", () => {
  it("self-referencing object: definite TypeError (native parity)", () => {
    const r = call(
      `export function f() { const o = {}; o.self = o; return JSON.stringify(o); }`,
    );
    // 原生定抛 TypeError（Converting circular structure to JSON）
    expect(isThrowsBrand(r.throws, "TypeError")).toBe(true);
  });

  it("user catch arm observes TypeError identity", () => {
    const r = call(
      `export function f() {
        const o = {}; o.self = o;
        try { return JSON.stringify(o); } catch (e) { return e.constructor.name; }
      }`,
    );
    expect(litValue(r.result as never)).toEqual({ ok: true, value: "TypeError" });
  });

  it("circular array (a.push(a)) throws TypeError", () => {
    const r = call(
      `export function f() { const a = []; a.push(a); return JSON.stringify(a); }`,
    );
    expect(isThrowsBrand(r.throws, "TypeError")).toBe(true);
  });

  it("nested circular structure (o.a.b.c = o.a) throws TypeError", () => {
    const r = call(
      `export function f() { const o = { a: { b: {} } }; o.a.b.c = o.a; return JSON.stringify(o); }`,
    );
    expect(isThrowsBrand(r.throws, "TypeError")).toBe(true);
  });

  it("shared (non-cyclic) reference serializes both sides like native", () => {
    // seen 在栈语义：兄弟位共享引用不是环——原生 {"x":{"n":1},"y":{"n":1}}
    const r = call(
      `export function f() { const t = { n: 1 }; const o = { x: t, y: t }; return JSON.stringify(o); }`,
    );
    expect(litValue(r.result as never)).toEqual({
      ok: true,
      value: '{"x":{"n":1},"y":{"n":1}}',
    });
    expect(r.effects).toEqual([]);
  });

  it("replacer-array cycle does not throw (extract mode stays conservative)", () => {
    // 原生 replacer 数组展开自带去重（propertyList 空 → "{}"，不抛）；
    // 引擎值域保守 partial 字符串（注册 skip），但**不得抛**
    const r = call(
      `export function f() { const r = []; r.push(r); try { return JSON.stringify({a:1}, r); } catch (e) { return "THROW"; } }`,
    );
    // 不抛：throws 面 never，结果停在 string 值域（partial 占位）
    expect((r.throws as { shape?: { k?: string } })?.shape?.k).toBe("never");
    expect(formatShape(r.result as never)).toBe("string");
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
