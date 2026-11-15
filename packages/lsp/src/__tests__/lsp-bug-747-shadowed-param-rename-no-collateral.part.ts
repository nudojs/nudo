/**
 * Bug 747 —— `rename` 重命名**形参**时，把**同名遮蔽的顶层变量**一起改了。
 *
 * 报告说的症状（**假阳性 —— 不复现**）：
 *   夹具 `const x = 1;` / `export function f(x) { return x + 1; }`
 *   重命名**形参** ⇒ 编辑集**多出一条**真改动（顶层 `const x`）。
 *   报告还指出两个方向**不对称**（形参方向多改、顶层方向正确）。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 *   · 形参声明位（1:18）改名 ⇒ 编辑集**只有** `1:18-1:19` + `1:30-1:31`
 *     （顶层 `0:6-0:7` **零编辑**）；
 *   · 形参引用位（1:30）改名 ⇒ 同上；
 *   · 顶层 `x`（0:6）改名 ⇒ 编辑集**只有** `0:6-0:7`（形参零编辑）。
 *   ⇒ **两个方向都不连坐**。
 *   `definition`@形参 ⇒ `renfx.js:1:18-1:19`；`references`@形参 ⇒
 *     `["1:18-1:19","1:30-1:31"]`（**作用域感知**）。
 *
 * ⇒ 症状已被**更早的族**修掉：**族 22（lsp-signature）的 Bug 709**
 *   （`lsp-bug-709-shadowed-binding.test.ts`）的修复面覆盖本条 ——
 *   符号表按**作用域路径**存同名绑定（`name@行:列`），`findDefinition` /
 *   `findReferences` / `resolveDefinitionLocations` 取**最内层**那条。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸）⇒ 任何人把符号表退回「按名字索引」，本钉立刻变红。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

/**
 * 夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31）
 * —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。
 */
const SHADOW = `const x = 1;
export function f(x) { return x + 1; }
`;

type Loc = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

type Edit = Loc & { newText: string };

/** Location[] ⇒ 可断言的位点列表 */
function locsOf(result: unknown): Loc[] {
  if (!Array.isArray(result)) return [];
  return (result as any[]).map((l) => ({
    file: String(l?.uri ?? "").split("/").pop() ?? "",
    line: l?.range?.start?.line ?? -1,
    character: l?.range?.start?.character ?? -1,
    endLine: l?.range?.end?.line ?? -1,
    endCharacter: l?.range?.end?.character ?? -1,
  }));
}

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

const PARAM_DECL: Loc = {
  file: "renfx.js",
  line: 1,
  character: 18,
  endLine: 1,
  endCharacter: 19,
};
const PARAM_USE: Loc = {
  file: "renfx.js",
  line: 1,
  character: 30,
  endLine: 1,
  endCharacter: 31,
};
const TOP_LEVEL: Loc = {
  file: "renfx.js",
  line: 0,
  character: 6,
  endLine: 0,
  endCharacter: 7,
};

describe("Bug 747 — 形参与同名遮蔽的顶层变量：两个方向都不连坐", () => {
  it("重命名形参声明位：编辑集只有形参声明 + 形参引用，顶层零编辑", async () => {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([
        { ...PARAM_DECL, newText: "y" },
        { ...PARAM_USE, newText: "y" },
      ]);
      expect(
        edits.filter((e) => e.line === 0),
        "重命名形参不得连坐顶层同名变量",
      ).toEqual([]);
    });
  });

  it("重命名形参体内的引用位：同样不连坐顶层变量", async () => {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 30 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([
        { ...PARAM_DECL, newText: "y" },
        { ...PARAM_USE, newText: "y" },
      ]);
      expect(
        edits.filter((e) => e.line === 0),
        "重命名形参不得连坐顶层同名变量",
      ).toEqual([]);
    });
  });

  it("反向：重命名顶层变量：只改顶层那处，形参零编辑（两个方向对称）", async () => {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 0, character: 6 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([{ ...TOP_LEVEL, newText: "y" }]);
    });
  });

  it("definition / references 走作用域：形参只认形参那一处绑定", async () => {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const defs = locsOf(
        await req("textDocument/definition")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
        }),
      );
      expect(defs).toEqual([PARAM_DECL]);

      const refs = locsOf(
        await req("textDocument/references")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
          context: { includeDeclaration: true },
        }),
      );
      expect(refs).toEqual([PARAM_DECL, PARAM_USE]);
    });
  });
});
