/**
 * 评审修复：$instanceof 的 sum 分支必须传 rightVal，@@hasInstance 对成员同样适用。
 * 修复前 members.map((m) => $instanceof(m, rightName)) 丢掉第三参。
 * 必须传入抽象参数触发 fork join 成 sum——无参时 x 缺失已折 unknown。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { abs } from "../abs.ts";

function callFork(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", [
    abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
  ]);
}

describe("B-path instanceof sum + @@hasInstance", () => {
  it("sum left still consults RHS hasInstance", () => {
    const r = callFork(
      `export function f(x) { const v = x ? 1 : 2; const o = { [Symbol.hasInstance]() { return true; } }; return v instanceof o; }`,
    );
    expect(litValue(r.result)).toBe(true);
  });

  it("sum left hasInstance returning false", () => {
    const r = callFork(
      `export function f(x) { const v = x ? 1 : 2; const o = { [Symbol.hasInstance]() { return false; } }; return v instanceof o; }`,
    );
    expect(litValue(r.result)).toBe(false);
  });
});
