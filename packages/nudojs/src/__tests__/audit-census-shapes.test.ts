/**
 * 审计批次 2026-11-14 回归钉 · 入口 / 导出槽 / 调用点扫描形态。
 *
 * BUG-002 / 017 / 023 的共同缺口是「本地名 ↔ 导出槽」或「类名 ↔ 导出表」
 * 的映射形态不全，导致必抛的导出函数在 L2 门禁上完全不可见。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

const errors = (path: string, source: string): string[] =>
  checkSource(path, source, pTrue, {})
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
const sigs = (path: string, source: string): string[] =>
  checkSource(path, source, pTrue, {}).signatures.map((s) => s.name);

describe("audit 34 · 导出槽映射形态", () => {
  it("BUG-002 exports.greet = boom（槽名 ≠ 本地名）进 L2 执法", () => {
    const source = `function boom() { throw new Error("boom"); }\nexports.greet = boom;`;
    expect(errors("/t/audit-b002.cjs", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b002b.cjs", source)).toContain("boom");
  });

  it("BUG-002 对照：同名槽 exports.boom = boom 仍被执法", () => {
    const source = `function boom() { throw new Error("boom"); }\nexports.boom = boom;`;
    expect(errors("/t/audit-b002c.cjs", source)).toContain("nudo:entry-may-throw");
  });

  it("BUG-017 匿名 export default class 的实例方法进 L2 执法", () => {
    const source = `export default class { m() { return null.x; } }`;
    expect(errors("/t/audit-b017.js", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b017b.js", source)).toContain("default.m");
  });

  it("BUG-023 CJS module.exports = C 的构造器与方法进 L2 执法", () => {
    const source = `class C { constructor() { throw new TypeError("no ctor"); } m() { return null.x; } }\nmodule.exports = C;`;
    expect(errors("/t/audit-b023.cjs", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b023b.cjs", source)).toContain("C.m");
  });
});
