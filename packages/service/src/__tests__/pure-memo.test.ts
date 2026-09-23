import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { formatAbs, checkSource, pTrue } from "@nudojs/core";

describe("@nudo:pure memoization consumer", () => {
  it("pure function results are identical with/without directive (correctness)", () => {
    const withPure = `
/**
 * @nudo:pure
 */
export function add(a, b) { return a + b; }
export function use() { return add(1, 2) + add(1, 2); }
`;
    const withoutPure = `
export function add(a, b) { return a + b; }
export function use() { return add(1, 2) + add(1, 2); }
`;
    const vals = (src: string) =>
      analyzeFile("/tmp/pure-x.js", src).functions
        .find((f) => f.name === "use")!
        .cases.map((c) => formatAbs(c.abs));
    expect(vals(withPure)).toEqual(vals(withoutPure));
  });

  it("pure fn is marked and $call memoizes same-arg results", () => {
    // 间接验证：纯函数多次同参调用仍得精确结果（缓存不得串味/污染）
    const src = `
/**
 * @nudo:pure
 */
export function double(n) { return n * 2; }
export function use() {
  const a = double(21);
  const b = double(21);
  return a + b;
}
`;
    const r = analyzeFile("/tmp/pure-memo.js", src);
    const use = r.functions.find((f) => f.name === "use");
    const call = use?.cases.find((c) => c.name.startsWith("call@") || c.name.startsWith("entry@"));
    expect(call).toBeDefined();
    expect(formatAbs(call!.abs)).toContain("84");
  });

  it("checkSource pure path stays precise", () => {
    const src = `
/**
 * @nudo:pure
 */
export function id(x) { return x; }
export function f() { return id(5); }
`;
    const r = checkSource("/t/pure.js", src, pTrue);
    const f = r.signatures.find((s) => s.name === "f");
    expect(f).toBeDefined();
    expect(formatAbs(f!.abs)).toContain("5");
  });
});
