/**
 * Function.prototype.call/apply（P1）：B 路径不得对合法 HOF 形态签 unknown。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
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
});
