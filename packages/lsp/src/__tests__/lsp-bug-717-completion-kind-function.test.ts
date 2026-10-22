/**
 * Bug 717：模块级函数的补全 kind 串档。
 *
 * 症状：顶层 `function` / 箭头函数绑定在补全面里是 `CompletionItemKind.Method`
 * （2）——它不是任何对象的成员，IDE 会把它渲染成「方法」。
 * 期望：模块级 fn 绑定 → `CompletionItemKind.Function`（3）；成员函数仍是
 * Method（2）；非函数绑定仍是 Variable（6）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

const KIND_METHOD = 2;
const KIND_FUNCTION = 3;
const KIND_VARIABLE = 6;

const SRC = [
  "export function exportedFn(a) { return a; }",
  "export const exportedArrow = (b) => b;",
  "const localFn = (c) => c;",
  "const localConst = 1;",
  "",
].join("\n");

describe("Bug 717 — 模块级函数补全 kind = Function", () => {
  it("顶层 fn 绑定 → Function(3)，非函数绑定 → Variable(6)", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-717/a.js");
    const items = requestCompletion(mock, uri, 4, 0);
    const byLabel = new Map(items.map((i) => [i.label, i.kind]));
    expect(byLabel.get("exportedFn")).toBe(KIND_FUNCTION);
    expect(byLabel.get("exportedArrow")).toBe(KIND_FUNCTION);
    expect(byLabel.get("localFn")).toBe(KIND_FUNCTION);
    expect(byLabel.get("localConst")).toBe(KIND_VARIABLE);
    expect([...byLabel.values()]).not.toContain(KIND_METHOD);
  });

  it("成员函数补全仍是 Method(2)（不能被一起改掉）", async () => {
    const src = "export const obj = { m() { return 1; } };\nobj.\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-717/b.js");
    const items = requestCompletion(mock, uri, 1, 4);
    const byLabel = new Map(items.map((i) => [i.label, i.kind]));
    expect(byLabel.get("m")).toBe(KIND_METHOD);
  });
});
