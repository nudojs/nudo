/**
 * Bug 699 回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把
 * 声明本身毁掉。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   rename `total` → `renamed`，返回两条编辑
 *     [0:13-0:18] -> "renamed"   （标识符）
 *     [0:0-0:24]  -> "renamed"   （**整条 `export const total = 42;` 声明**）
 *   ⇒ 两条 range 重叠（LSP 规定同一份 edit 列表里 range 不得重叠），
 *     且第二条会把整条声明替换成一个标识符 ⇒ 文件被改坏。
 *
 * 根因：babel 把 `ExportNamedDeclaration` **语句节点**放进导出绑定的
 * `referencePaths`（实测：`export const total = 42;` 的 binding.referencePaths
 * = [ExportNamedDeclaration@1:0-1:24]），`collectBindingReferences` 把它当
 * 引用收进来 ⇒ 变成一个「宽于单个标识符」的编辑目标。
 *
 * 修法：
 *   1) `collectBindingReferences` 的 referencePaths **只收 Identifier 节点**；
 *   2) `buildRenameEdits` 兜底：编辑范围宽于一个标识符 ⇒ 挡掉；编辑区间
 *      互相重叠 ⇒ 只留窄的一条。不得把协议非法的 edit 列表发给客户端。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { collectBindingReferences, buildRenameEdits } from "../symbols.ts";
import { withLspServer } from "./helpers.ts";

const DEF_SRC = `export const total = 42;\n`;

describe("Bug 699 — rename 导出绑定不得毁掉声明（编辑范围 / 重叠）", () => {
  it("collectBindingReferences：导出绑定的 referencePaths 只收标识符（语句节点不进）", () => {
    const ast = parse(DEF_SRC);
    const refs = collectBindingReferences(ast, "total", { line: 1, column: 14 }, "file:///t/d.js");
    // 声明位保留；语句级节点（ExportNamedDeclaration）不得出现
    expect(refs.length).toBe(1);
    expect(refs[0]!.loc.start.line).toBe(1);
    expect(refs[0]!.loc.start.column).toBe(13);
    expect(refs[0]!.loc.end.column).toBe(18);
  });

  it("buildRenameEdits：宽于单个标识符的编辑被挡掉（语句级目标）", () => {
    const edits = buildRenameEdits("renamed", [
      // 标识符（合法）
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 13 }, end: { line: 1, column: 18 } } },
      // 整条 export 声明（非法：宽于标识符）
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 24 } } },
    ]);
    expect(edits["file:///t/d.js"]!.length).toBe(1);
    expect(edits["file:///t/d.js"]![0]!.newText).toBe("renamed");
    expect(edits["file:///t/d.js"]![0]!.range).toEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 18 },
    });
  });

  it("buildRenameEdits：重叠的编辑只留窄的一条（协议合法性兜底）", () => {
    const edits = buildRenameEdits("renamed", [
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 24 } } },
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 13 }, end: { line: 1, column: 18 } } },
    ]);
    expect(edits["file:///t/d.js"]!.length).toBe(1);
    expect(edits["file:///t/d.js"]![0]!.range.start.character).toBe(13);
  });

  it("协议面：rename 导出绑定只产出标识符编辑，且无重叠", async () => {
    await withLspServer(
      { "def.js": DEF_SRC, "use.js": `import { total } from "./def.js";\n\nexport function read() {\n  return total;\n}\n` },
      async ({ req, uri }) => {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("def.js") },
          position: { line: 0, character: 13 },
          newName: "renamed",
        });
        const edits = (res as any)?.changes?.[uri("def.js")] as any[] | undefined;
        expect(edits, "rename 必须有编辑").toBeDefined();
        // 只有标识符一处：声明不得被整段替换
        expect(edits!.length).toBe(1);
        expect(edits![0]!.range).toEqual({
          start: { line: 0, character: 13 },
          end: { line: 0, character: 18 },
        });
        expect(edits![0]!.newText).toBe("renamed");
        // 负控制：不得出现宽于标识符 / 与上面重叠的编辑
        for (const e of edits!) {
          const width =
            e.range.start.line === e.range.end.line
              ? e.range.end.character - e.range.start.character
              : Number.MAX_SAFE_INTEGER;
          expect(width).toBe(5);
        }
      },
      "nudo-lsp-699-",
    );
  });
});
