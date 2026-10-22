/**
 * Bug 708：指令补全的假阳性——乘号之后也弹 `@nudo:` 指令。
 *
 * 症状：光标在 `x * ` 之后（乘法运算符）时，补全面给出 11 条 `@nudo:` 指令；
 * 旧口径是「前面出现过 `*` 或 `nudo`」的子串匹配（`@?n?u?d?o?:?` 全可选）。
 *
 * 期望：指令面**只在光标确实落在注释里**时出；代码区（乘号之后）⇒ 走变量/
 * 成员补全；字符串字面量里的 `@nudo:` 也不是注释 ⇒ 不出指令。
 * 反向护栏：注释里（`// @nudo:ca`）**仍然**要出指令项。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

const isDirective = (label: string): boolean => label.startsWith("@nudo:");

describe("Bug 708 — 指令补全只在注释里出", () => {
  it("乘号之后：不出指令项（出的是变量补全）", async () => {
    const src = "export function f(x, y) {\n  return x * y;\n}\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/a.js");
    // 光标在 `* ` 之后、`y` 之前（行内第 13 列）
    const items = requestCompletion(mock, uri, 1, 13);
    expect(items.filter((i) => isDirective(i.label))).toEqual([]);
    expect(items.map((i) => i.label)).toContain("f");
  });

  it("字符串字面量里的 @nudo: 不是注释 ⇒ 不出指令项", async () => {
    const src = 'export const k = 1;\nconst s2 = "@nudo:ca";\n';
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/b.js");
    const items = requestCompletion(mock, uri, 1, 19);
    expect(items.filter((i) => isDirective(i.label))).toEqual([]);
  });

  it("注释里：仍然出指令项（不误伤）", async () => {
    const src = "// @nudo:ca\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/c.js");
    const items = requestCompletion(mock, uri, 0, 11);
    expect(items.map((i) => i.label)).toEqual(["@nudo:case"]);
  });

  it("JSDoc 多行注释里：仍然出指令项（跨行块注释词法上下文）", async () => {
    const src = "/**\n * @nudo:ca\n */\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/d.js");
    const items = requestCompletion(mock, uri, 1, 10);
    expect(items.map((i) => i.label)).toContain("@nudo:case");
    expect(items.every((i) => isDirective(i.label))).toBe(true);
  });
});
