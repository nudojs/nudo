/**
 * 审计批次 2026-11-14 回归钉 · 事实 / 符号模型（设计类）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

const codes = (path: string, source: string): string[] =>
  checkSource(path, source, pTrue, {}).issues.map((i) => `${i.severity}:${i.code}`);

describe("audit 34 · typeof 合取守卫进 if 体（）", () => {
  const SIMPLE = `export function simple(x) { if (typeof x === "string") return x.length; return 0; }`;
  const COMPOUND = `export function compound(x) { if (typeof x === "string" && true) return x.length; return 0; }`;

  it("单守卫本来就不假红（一变量对照）", () => {
    expect(codes("/t/audit-b011-simple.js", SIMPLE)).not.toContain("error:nudo:entry-may-throw");
  });

  it("typeof x === \"string\" && true 与单守卫等价，不报 entry-may-throw", () => {
    expect(codes("/t/audit-b011-compound.js", COMPOUND)).not.toContain(
      "error:nudo:entry-may-throw",
    );
  });

  it("合取项本身也带 typeof 事实：&& 两侧都进 cons 臂", () => {
    const src = `export function both(x, y) {
      if (typeof x === "string" && typeof y === "string") return x.length + y.length;
      return 0;
    }`;
    expect(codes("/t/audit-b011-both.js", src)).not.toContain("error:nudo:entry-may-throw");
  });

  it("负控制：无守卫仍按既有 any 规则判红", () => {
    const src = `export function plain(x) { return x.length; }`;
    expect(codes("/t/audit-b011-plain.js", src)).toContain("error:nudo:entry-may-throw");
  });
});
