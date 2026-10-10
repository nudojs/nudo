import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  transpileSource,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("Bug 42：同作用域同一行 try 临时名唯一化", () => {
  it("同一行两个 try/catch：能求值且返回正常值（此前重复 const → new Function SyntaxError 整模块失败）", () => {
    const src = `export function f() { try { 1; } catch (e) {} try { 2; } catch (e) {} return "done"; }`;
    const r = call(src);
    expect(litValue(r.result)).toEqual({ ok: true, value: "done" });
  });

  it("同一行 try/catch + try/finally 组合", () => {
    const src = `export function f() { try { 1; } catch (e) {} try { 2; } finally { 3; } return "done"; }`;
    const r = call(src);
    expect(litValue(r.result)).toEqual({ ok: true, value: "done" });
  });

  it("同一行 3 个 try/catch", () => {
    const src = `export function f() { try { 1; } catch (e) {} try { 2; } catch (e) {} try { 3; } catch (e) {} return "done"; }`;
    const r = call(src);
    expect(litValue(r.result)).toEqual({ ok: true, value: "done" });
  });

  it("模块顶层同一行两个 try/catch 也唯一", () => {
    const src = `try { 1; } catch (e) {} try { 2; } catch (e) {} export function f() { return "top"; }`;
    const r = call(src);
    expect(litValue(r.result)).toEqual({ ok: true, value: "top" });
  });

  it("不同作用域同一行（if 块 / 嵌套 try）仍正常", () => {
    const src = `export function f(x) { if (x) { try { 1; } catch (e) {} } { try { 2; } catch (e) {} } try { try { 3; } catch (e2) {} } catch (e3) {} return "done"; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", [$lit(1)]);
    expect(litValue(r.result)).toEqual({ ok: true, value: "done" });
  });

  it("产物中 __nudoTm_ 临时名跨 try 单调不重复（含嵌套）", () => {
    const js = transpileSource(
      `export function f() { try { 1; } catch (e) {} try { 2; } finally { 3; } try { try { 4; } catch (e2) {} } catch (e3) {} return 5; }`,
    );
    const names = [...js.matchAll(/const (__nudoTm_\d+) =/g)].map((m) => m[1]);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(names.length);
  });

  // 既有 try/catch/finally 语义不回退（复跑 exec-trycatch / catch-binding 口径）
  it("catch 吸收 $throw 并绑定 Abs 值", () => {
    const src = `
export function go(n) {
  try {
    if (n > 0) {
      return n;
    } else {
      throw "neg";
    }
  } catch (e) {
    return e;
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "go", [$lit(3)]);
    expect(litValue(ok.result)).toEqual({ ok: true, value: 3 });
    expect(ok.throws.shape.k).toBe("never");
    const bad = callTranspiledExportFull(exports, "go", [$lit(-1)]);
    expect(litValue(bad.result)).toEqual({ ok: true, value: "neg" });
  });

  it("finally 在 catch 后执行", () => {
    const src = `
export function go() {
  let t = 0;
  try {
    throw "x";
  } catch (e) {
    t = 1;
  } finally {
    t = t + 10;
  }
  return t;
}
`;
    const r = call(src, "go");
    expect(litValue(r.result)).toEqual({ ok: true, value: 11 });
  });

  it("catch 绑定 thrown Error.message 为精确字符串字面量", () => {
    const src = `
export function caught() {
  try {
    throw new Error("boom");
  } catch (err) {
    return err.message;
  }
}
`;
    const r = call(src, "caught");
    expect(litValue(r.result)).toEqual({ ok: true, value: "boom" });
  });
});
