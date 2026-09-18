/**
 * Function.prototype.call/apply/bind（P1）：B 路径不得对合法 HOF 形态签 unknown。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
} from "@nudojs/core";

function call(src: string, fnName: string, ...args: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    args.map((a) => $lit(a as never)),
  );
}

describe("Function.prototype.call/apply on B-path", () => {
  it("g.call(null, 41) resolves through $invoke", () => {
    const r = call(
      `
export function g(x) { return x + 1; }
export function f() { return g.call(null, 41); }
`,
      "f",
    );
    expect(litValue(r.result)).toBe(42);
  });

  it("g.apply(null, [41]) expands args array", () => {
    const r = call(
      `
export function g(x) { return x * 2; }
export function f() { return g.apply(null, [21]); }
`,
      "f",
    );
    expect(litValue(r.result)).toBe(42);
  });

  it("g.bind works; B-path params fall back to arity names not _rest", () => {
    const r = call(
      `
export function g(x, y) { return x + y; }
export function f() { const h = g.bind(null, 1); return h(41); }
`,
      "f",
    );
    expect(litValue(r.result)).toBe(42);
    const exports = runTranspiled(
      `
export function g(x, y) { return x + y; }
export const h = g.bind(null, 1);
`,
      { mode: "analyze" },
    );
    const bound = exports.h;
    expect(bound && typeof bound === "object" && "shape" in bound).toBe(true);
    const shape = (bound as { shape: { k: string; params?: string[] } }).shape;
    expect(shape.k).toBe("fn");
    expect(shape.params).toEqual(["_a1"]);
    expect(shape.params).not.toEqual(["_rest"]);
  });
});
