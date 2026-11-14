/**
 * 审计批次 2026-11-14 回归钉（固化自 tmp/bug-report.md 的一变量夹具）。
 *
 * 本文件覆盖 ADR 0001 D1「入口名面单一事实来源」闭合的形态：
 * `check` 的 L2 门禁候选由 `names`（SemanticIndex.entries）∪ 旧导出名面
 * 组成，导出槽形态不再是「签名面看得见、门禁不执法」的假绿。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

const run = (path: string, source: string) => checkSource(path, source, pTrue, {});
const errors = (path: string, source: string): string[] =>
  run(path, source)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
const sigs = (path: string, source: string): string[] =>
  run(path, source).signatures.map((s) => s.name);

describe("audit 34 · 入口面单一事实来源（ADR 0001 D1）", () => {
  it("BUG-015 解构导出 export const { a } = … 进普查与 L2 执法", () => {
    const source = `export const { a } = { a: () => null.x };`;
    expect(errors("/t/audit-b015.js", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b015b.js", source)).toContain("a");
    // 一变量对照：标识符导出一直被执法。
    expect(errors("/t/audit-b015c.js", `export const a = () => null.x;`)).toContain(
      "nudo:entry-may-throw",
    );
  });

  it("BUG-016 export default { m(){} } 的对象成员进 L2 执法", () => {
    const source = `export default { m() { return null.x; } };`;
    expect(errors("/t/audit-b016.js", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b016b.js", source)).toContain("m");
  });

  it("BUG-024 ESM 类表达式经 export { C } 导出时方法进 L2 执法", () => {
    const source = `const C = class { m() { return null.x; } };\nexport { C };`;
    expect(errors("/t/audit-b024.js", source)).toContain("nudo:entry-may-throw");
    expect(sigs("/t/audit-b024b.js", source)).toContain("C.m");
  });

  it("控制夹具：普通导出函数仍绿（合并入口名面不制造假红）", () => {
    expect(errors("/t/audit-control.js", `export function f() { return 1; }`)).toEqual([]);
  });
});
