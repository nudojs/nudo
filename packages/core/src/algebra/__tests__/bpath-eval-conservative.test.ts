/**
 * eval 假精确：宿主 eval 按 JS 语义对非字符串实参原样返回——B-path 把
 * strLit("1+2") Abs 对象喂给宿主 eval，得到 Abs 对象原样返回，concrete
 * 提取出字符串 "1+2"（假精确，原生 eval 真执行得 3）。
 * 修复：eval 动态代码语义不可静态建模——evalGlobalFn 折 unknown（B-path
 * 经 GLOBAL_FNS 身份校验路由，ast-eval 直接分派），不再调用宿主 eval。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path eval is conservative unknown", () => {
  it("direct eval does not fold the code string", () => {
    const r = call(`export function f() { return eval('1+2'); }`);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("direct eval of expression code stays unknown", () => {
    const r = call(`export function f() { return eval('Math.max(1,2)'); }`);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("eval result feeding arithmetic stays unknown, not precise", () => {
    const r = call(`export function f() { return eval('2') + 1; }`);
    expect(litValue(r.result)).toBeUndefined();
  });

  it("indirect eval stays unknown", () => {
    // (0, eval)(...) 走表达式 callee → $call 宿主函数路径，同样保守
    const r = call(`export function f() { return (0, eval)('1+2'); }`);
    expect(litValue(r.result)).toBeUndefined();
  });
});

describe("ast-eval eval is conservative unknown", () => {
  it("direct eval does not fold", () => {
    expect(litValue(analyzeFn(`function f() { return eval('1+2'); }`, "f", []))).toBeUndefined();
  });
});
