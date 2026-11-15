/**
 * Bug 715 回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本
 * 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字
 * —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   rename `x` → `y`，返回
 *     [1:8-1:9]  -> "y"   （声明）
 *     [2:11-2:12] -> "y"  （**简写属性** ⇒ 变成 `{ y }`，key 被改掉 ❌）
 *
 * 根因：babel 8 里简写属性的 key 与 value 是**两个节点、同一段源码**
 * （实测 `{ x }` 的 `prop.key` 与 `prop.value` 相等位置但不同节点）⇒ 把这段
 * 源码替换成新名字，key 与 value 一起变。
 *
 * 修法：引用/声明位识别出「简写属性的 value」⇒ 位置带上 `shorthandKey`
 * 元数据，`buildRenameEdits` 据此生成 `x: <新名>`。
 * 解构模式（`function f({ x })`）同理：key 是被解构出来的属性名，必须保留。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { collectBindingReferences, buildRenameEdits } from "../symbols.ts";
import { withLspServer } from "./helpers.ts";

const SHORT_SRC = `export function mk() {
  const x = 1;
  return { x };
}
`;

describe("Bug 715 — 简写属性改名必须保留 key（`{ x }` → `{ x: y }`）", () => {
  it("collectBindingReferences：简写属性的引用位带上 key 元数据", () => {
    const ast = parse(SHORT_SRC);
    const refs = collectBindingReferences(ast, "x", { line: 2, column: 9 }, "file:///t/s.js");
    const shorthand = refs.find((r) => r.loc.start.line === 3);
    expect(shorthand, "简写属性的引用位必须在").toBeDefined();
    expect((shorthand!.loc as any).shorthandKey).toBe("x");
  });

  it("buildRenameEdits：简写属性的编辑文本是 `x: <新名>`", () => {
    const ast = parse(SHORT_SRC);
    const refs = collectBindingReferences(ast, "x", { line: 2, column: 9 }, "file:///t/s.js");
    const edits = buildRenameEdits("y", refs.map((r) => ({ uri: "file:///t/s.js", loc: r.loc })));
    const list = edits["file:///t/s.js"]!;
    expect(list.length).toBe(2);
    // 声明位：普通改名
    expect(list[0]!.newText).toBe("y");
    // 简写属性位：保留 key
    expect(list[1]!.newText).toBe("x: y");
    expect(list[1]!.range).toEqual({
      start: { line: 2, character: 11 },
      end: { line: 2, character: 12 },
    });
  });

  it("解构模式的简写属性同样保留 key（`function f({ x })` → `{ x: y }`）", () => {
    const ast = parse(`export function f({ x }) {\n  return x;\n}\n`);
    const refs = collectBindingReferences(ast, "x", { line: 1, column: 20 }, "file:///t/p.js");
    const decl = refs.find((r) => r.loc.start.line === 1);
    expect(decl).toBeDefined();
    expect((decl!.loc as any).shorthandKey).toBe("x");
    const edits = buildRenameEdits("y", refs.map((r) => ({ uri: "file:///t/p.js", loc: r.loc })));
    expect(edits["file:///t/p.js"]![0]!.newText).toBe("x: y");
  });

  it("协议面：rename 简写属性产出 `x: y`，key 不被改掉", async () => {
    await withLspServer({ "short.js": SHORT_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("short.js") },
        position: { line: 1, character: 8 },
        newName: "y",
      });
      const edits = (res as any)?.changes?.[uri("short.js")] as any[] | undefined;
      expect(edits, "rename 必须有编辑").toBeDefined();
      expect(edits!.length).toBe(2);
      expect(edits![0]!.newText).toBe("y");
      expect(edits![0]!.range).toEqual({
        start: { line: 1, character: 8 },
        end: { line: 1, character: 9 },
      });
      // 简写属性：编辑文本保留 key
      expect(edits![1]!.newText).toBe("x: y");
      expect(edits![1]!.range).toEqual({
        start: { line: 2, character: 11 },
        end: { line: 2, character: 12 },
      });
    });
  });
});
