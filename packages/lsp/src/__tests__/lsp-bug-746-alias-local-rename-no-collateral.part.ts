/**
 * Bug 746 —— 跨文件改名：改**本地别名**却把**导出符号**与**其它 importer**一起改掉。
 *
 * 报告说的症状（**假阳性 —— 不复现**）：
 *   在 `xf-use.js`（导入方）把**本地别名** `alias` 改名 ⇒ 报告实测：
 *   `xf-def.js` 的导出符号 + `xf-use2.js` 的 import 与用法**被一起改掉**。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 *   在 `xf-use.js` 改本地别名 ⇒ 编辑集**只有**
 *     `xf-use.js:0:20-0:25`（import 说明符的 **local** 侧）+ `xf-use.js:3:9-3:14`（用法处）；
 *   `xf-def.js` 与 `xf-use2.js` **零编辑**。
 *   反向（从**定义方**改导出名）⇒ 正确改 `xf-def.js` 的导出名 + 各 importer 的
 *   **imported** 侧，**别名 `alias` 不动**。
 *
 * ⇒ 症状已被**更早的族**修掉：**族 22（lsp-signature）的 Bug 710**
 *   （`lsp-bug-710-alias-import-cross-file-rename.test.ts`）的修复面覆盖本条
 *   （`isLocalAliasSymbol` / `resolveReferences` 的「本地别名」分支）。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸，与其它片「必须大面积失败」的口径相反）⇒ 任何人把「本地别名」
 *   与「被导入符号」再混为一谈，本钉立刻变红。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

/** 导出方：`oldName` 在 0:16-0:23 */
const DEF = `export function oldName() { return 1; }
`;
/** 导入方（别名形态）：imported 侧 `oldName` 在 0:9-0:16，local 侧 `alias` 在 0:20-0:25，用法在 3:9-3:14 */
const USE = `import { oldName as alias } from "./xf-def.js";

export function use() {
  return alias();
}
`;
/** 另一个 importer（无别名形态）：`oldName` 在 0:9-0:16，用法在 3:9-3:16 */
const USE2 = `import { oldName } from "./xf-def.js";

export function use2() {
  return oldName();
}
`;

type Edit = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  newText: string;
};

/** WorkspaceEdit.changes ⇒ 可断言的编辑列表（按 file/line/character 排序） */
function editsOf(result: unknown): Edit[] {
  const changes = (result as any)?.changes;
  if (!changes) return [];
  const out: Edit[] = [];
  for (const [uri, list] of Object.entries(changes as Record<string, any[]>)) {
    for (const e of list as any[]) {
      out.push({
        file: String(uri).split("/").pop() ?? "",
        line: e.range.start.line,
        character: e.range.start.character,
        endLine: e.range.end.line,
        endCharacter: e.range.end.character,
        newText: e.newText,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
  );
}

describe("Bug 746 — 改本地别名不得连坐导出符号与其它 importer", () => {
  it("在别名用法处改名：只改 importer 的本地侧 + 用法处", async () => {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-use.js") },
            position: { line: 3, character: 9 }, // alias() 的用法处
            newName: "z",
          }),
        );
        expect(edits).toEqual([
          {
            file: "xf-use.js",
            line: 0,
            character: 20,
            endLine: 0,
            endCharacter: 25,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 14,
            newText: "z",
          },
        ]);
      },
    );
  });

  it("在 import 说明符的 local 侧改名：同样零连坐（导出方与其它 importer 不动）", async () => {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-use.js") },
            position: { line: 0, character: 21 }, // alias（local 侧）
            newName: "z",
          }),
        );
        // 导出方（xf-def.js）与另一个 importer（xf-use2.js）零编辑
        expect(
          edits.filter((e) => e.file === "xf-def.js" || e.file === "xf-use2.js"),
          "改本地别名不得连坐导出符号与其它 importer",
        ).toEqual([]);
        expect(edits).toEqual([
          {
            file: "xf-use.js",
            line: 0,
            character: 20,
            endLine: 0,
            endCharacter: 25,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 14,
            newText: "z",
          },
        ]);
      },
    );
  });

  it("反向：从导出方改导出名 ⇒ 改导出方 + 各 importer 的 imported 侧，别名不动", async () => {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-def.js") },
            position: { line: 0, character: 16 }, // oldName（定义方）
            newName: "z",
          }),
        );
        expect(edits).toEqual([
          {
            file: "xf-def.js",
            line: 0,
            character: 16,
            endLine: 0,
            endCharacter: 23,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 0,
            character: 9,
            endLine: 0,
            endCharacter: 16,
            newText: "z",
          },
          {
            file: "xf-use2.js",
            line: 0,
            character: 9,
            endLine: 0,
            endCharacter: 16,
            newText: "z",
          },
          {
            file: "xf-use2.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 16,
            newText: "z",
          },
        ]);
        // 别名 `alias`（local 侧）与其用法处都不该被改（本地名没变）
        expect(
          edits.filter((e) => e.file === "xf-use.js" && e.line === 3),
          "别名 import 的本地名不得被改",
        ).toEqual([]);
      },
    );
  });
});
