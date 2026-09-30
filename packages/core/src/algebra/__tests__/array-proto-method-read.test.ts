/**
 * Array.prototype 一等方法读取不得劫持 $invoke。
 * 回归背景：$get 对 concat/sort 等返回 absFunction([], {body: noBody})，
 * $invoke 的 getFnImpl 路径把它当对象方法 $call，折成 undefined #exact
 * （假精确）——Array.reduce+concat 折 never/TypeError，filter/map/sort 管线
 * 折 undefined。typeof a.push 仍须是 "function"。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "../index.ts";

function call(src: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", args as never);
}

describe("array proto method reads do not hijack $invoke", () => {
  it("a.concat(b) stays unknown, not exact undefined", () => {
    const r = call(`export function f(a, b) { return a.concat(b); }`, [
      { shape: { k: "tuple", elements: [{ shape: { k: "prim", type: "number" }, conf: "exact" } as never] }, conf: "exact" },
      { shape: { k: "tuple", elements: [{ shape: { k: "prim", type: "number" }, conf: "exact" } as never] }, conf: "exact" },
    ]);
    expect(litValue(r.result)).toEqual({ ok: false });
    expect(r.result.conf).not.toBe("exact");
  });

  it("arr.sort() stays unknown, not never/undefined", () => {
    const r = call(`export function f(arr) { return arr.sort(); }`, [
      { shape: { k: "arr", element: { shape: { k: "prim", type: "number" }, conf: "path" } as never }, conf: "path" },
    ]);
    expect(litValue(r.result)).toEqual({ ok: false });
    expect(formatShape(r.result)).not.toBe("undefined");
    expect(formatShape(r.result)).not.toBe("never");
  });

  it("reduce + concat pipeline stays unknown (not never/TypeError)", () => {
    const r = call(`export function f(arrays) { return arrays.reduce((acc, arr) => acc.concat(arr), []); }`, [
      {
        shape: {
          k: "tuple",
          elements: [
            { shape: { k: "tuple", elements: [{ shape: { k: "prim", type: "number" }, conf: "exact" } as never] }, conf: "exact" },
          ],
        },
        conf: "exact",
      },
    ]);
    expect(litValue(r.result)).toEqual({ ok: false });
    expect(formatShape(r.result)).not.toBe("never");
  });

  it("typeof a.push is still function (first-class read)", () => {
    const r = call(`export function f(a) { return typeof a.push; }`, [
      { shape: { k: "tuple", elements: [] }, conf: "exact" },
    ]);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });
});
