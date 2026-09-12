import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $await,
  litValue,
  absToString,
} from "@nudojs/core";

describe("B-path async / await", () => {
  it("await async call unwraps to concrete", () => {
    const src = `
export async function f(n) {
  return n + 1;
}
export async function go(n) {
  return await f(n);
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", [$lit(1)]);
    // go 是 async → 外层 promise
    expect(absToString(r.result)).toContain("promise");
    expect(litValue($await(r.result))).toBe(2);
  });

  it("async wraps return as promise", () => {
    const src = `
export async function f() {
  return 42;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(absToString(r.result)).toContain("promise");
    expect(litValue($await(r.result))).toBe(42);
  });

  it("transpiles async and await", async () => {
    const { transpile } = await import("@nudojs/core");
    const out = transpile(`export async function f(n) { return await g(n); }`);
    expect(out).toContain("$async(");
    expect(out).toContain("$await(");
  });
});
