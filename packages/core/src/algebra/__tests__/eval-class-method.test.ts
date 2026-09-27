/**
 * 类方法桥：generalize("Cls.method") 走 B——模块导出表取类 Abs → $new（构造
 * 参数 any）→ $invoke 实例方法。此前点状名一律解释路径（this 未绑定 →
 * unknown #partial 弱签名）。
 */
import { describe, it, expect } from "vitest";
import { generalizeFromAst, formatAbs } from "@nudojs/core";

describe("class method bridge (B)", () => {
  it("instance method with ctor field gets real field semantics", () => {
    const src = `export class Counter {
  constructor(n) { this.n = n; }
  add(x) { return this.n + x; }
}`;
    const g = generalizeFromAst("Counter.add", src);
    expect(g).toBeDefined();
    // 字段 this.n（any，构造参数未约束）+ x(α) 的 + 并集——不再是 unknown
    expect(formatAbs(g!.symbolic)).not.toContain("unknown");
  });

  it("method writing a field keeps reference semantics", () => {
    const src = `export class C {
  constructor() { this.n = 0; }
  set(x) { this.n = x; return this.n; }
}`;
    const g = generalizeFromAst("C.set", src);
    expect(g).toBeDefined();
    expect(formatAbs(g!.symbolic)).not.toContain("unknown");
  });

  it("class without explicit constructor bridges with empty args", () => {
    const src = `export class C { get() { return 1; } }`;
    const g = generalizeFromAst("C.get", src);
    expect(g).toBeDefined();
    expect(formatAbs(g!.symbolic)).toContain("1");
  });

  it("dotted name whose class is missing falls back to interpreter", () => {
    const src = `export class C { get() { return 1; } }`;
    const g = generalizeFromAst("Missing.get", src);
    expect(g).toBeUndefined();
  });
});
