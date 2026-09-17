import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, strLit } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { formatAbs, formatShape } from "../format.ts";
import { analyzeFn } from "../ast-eval.ts";

describe("C2.4 join pathNote", () => {
  it("join of number|string carries join note", () => {
    const r = joinAbs(num(), str());
    expect(r.shape.k).toBe("sum");
    expect(r.pathNote).toContain("join(");
    expect(r.pathNote).toContain("number");
    expect(r.pathNote).toContain("string");
    const fmt = formatAbs(r);
    expect(fmt).toContain("#");
    expect(fmt).toContain("join(number | string)");
  });

  it("same-shape join does not annotate", () => {
    const r = joinAbs(numLit(1), numLit(2));
    expect(r.pathNote).toBeUndefined();
  });

  it("formatShape stays clean (dts/projection surface)", () => {
    const r = joinAbs(num(), str());
    expect(formatShape(r)).toBe("number | string");
  });

  it("unknown-condition ternary result is explainable", () => {
    const src = `
      function pick(flag, x) {
        return flag ? x : "none";
      }
    `;
    const r = analyzeFn(src, "pick", [
      abs({ k: "unknown" }, undefined, undefined, "partial"),
      num(),
    ]);
    const fmt = formatAbs(r);
    // 两支：number 与 string（或字面量 "none" → string）
    expect(fmt).toMatch(/join\(/);
  });

  it("pathNote does not change leq / shape", () => {
    const plain = abs({ k: "sum", members: [num(), str()] }, undefined, undefined, "path");
    const noted = joinAbs(num(), str());
    expect(noted.shape.k).toBe(plain.shape.k);
    expect(formatShape(noted)).toBe(formatShape(plain));
  });
});
