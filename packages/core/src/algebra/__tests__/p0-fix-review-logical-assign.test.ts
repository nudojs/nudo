import { describe, it, expect } from "vitest";
import { analyzeFn, formatAbs } from "@nudojs/core";

describe("P0 ast-eval logical assignment on non-lit LHS", () => {
  it("||= keeps truthy abstract LHS via join (not RHS-only)", () => {
    const src = `
      function f(a) {
        let x = a; // abstract
        x ||= 0;
        return x;
      }
    `;
    const r = analyzeFn(src, "f", []);
    const text = formatAbs(r as never);
    // join(a, 0) — 不得只剩 RHS 0
    expect(text).not.toBe("0");
  });

  it("??= keeps non-nullish abstract LHS via join", () => {
    const src = `
      function f(a) {
        let x = { n: a };
        x ??= null;
        return x;
      }
    `;
    const r = analyzeFn(src, "f", []);
    const text = formatAbs(r as never);
    // 对象 shape 非 nullish → 应保留 x，不是只留 null
    expect(text).not.toBe("null");
  });

  it("concrete null ??= still assigns RHS", () => {
    const src = `
      function f(a) {
        let x = null;
        x ??= a;
        return x;
      }
    `;
    const r = analyzeFn(src, "f", []);
    const text = formatAbs(r as never);
    expect(text).not.toBe("null");
  });
});
