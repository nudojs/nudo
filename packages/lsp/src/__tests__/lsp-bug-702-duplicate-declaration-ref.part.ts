/**
 * Bug 702 回归钉：LSP `textDocument/references` 不得把**声明位点返回两次**，
 * 也不得混入语句级伪引用。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   references on `score`（`export function score(row) {...}` 的声明位）
 *     → [0:16-0:21]（声明）、[0:16-0:21]（**同一个声明再来一次**）、
 *       [0:0-2:1]（**整条 export 声明**）、…（跨文件引用）
 *   ⇒ 同一个位置出现两次；客户端按位置高亮会出现重影。
 *
 * 根因（两条）：
 *   1) `resolveReferences` 把「符号表里的声明位」与「引用集合里的声明位」
 *      各推一次（两处坐标相同）⇒ 重复；
 *   2) 导出绑定的 `referencePaths` 里混着 `ExportNamedDeclaration` **语句
 *      节点** ⇒ 变成一条覆盖整条声明的伪引用（与 Bug 699 同源）。
 *
 * 修法：① 引用集合按 (uri, 位置) 去重；② `collectBindingReferences` 的
 * referencePaths 只收 Identifier 节点（语句级目标不再进引用集合）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { collectBindingReferences } from "../symbols.ts";
import { withLspServer } from "./helpers.ts";

const C_SRC = `export function score(row) {
  return row.id;
}
`;

describe("Bug 702 — references 不得重复声明位 / 混入语句级伪引用", () => {
  it("collectBindingReferences：导出绑定不产生语句级伪引用", () => {
    const ast = parse(C_SRC);
    const refs = collectBindingReferences(ast, "score", { line: 1, column: 17 }, "file:///t/c.js");
    expect(refs.length).toBe(1);
    expect(refs[0]!.loc.start.line).toBe(1);
    expect(refs[0]!.loc.start.column).toBe(16);
    expect(refs[0]!.loc.end.column).toBe(21);
    // 不得出现覆盖整条声明的「引用」
    for (const r of refs) {
      expect(r.loc.end.line).toBe(r.loc.start.line);
    }
  });

  it("协议面：references 的每个位置只出现一次", async () => {
    await withLspServer(
      {
        "c.js": C_SRC,
        "d.js": `import { score } from "./c.js";\nexport function use(row) {\n  return score(row);\n}\n`,
      },
      async ({ req, uri }) => {
        const res = req("textDocument/references")({
          textDocument: { uri: uri("c.js") },
          position: { line: 0, character: 16 },
          context: { includeDeclaration: true },
        });
        const locs = res as any[];
        expect(Array.isArray(locs)).toBe(true);
        const keys = locs.map((l) => `${l.uri}:${l.range.start.line}:${l.range.start.character}`);
        // 同一位置不得出现两次
        expect(new Set(keys).size).toBe(keys.length);
        // 声明位恰好一次
        const decls = locs.filter(
          (l) => l.uri === uri("c.js") && l.range.start.line === 0 && l.range.start.character === 16,
        );
        expect(decls.length).toBe(1);
        // 不得混入覆盖整条 export 声明的伪引用
        for (const l of locs) {
          const width =
            l.range.start.line === l.range.end.line
              ? l.range.end.character - l.range.start.character
              : Number.MAX_SAFE_INTEGER;
          expect(width).toBeLessThanOrEqual(21);
        }
      },
      "nudo-lsp-702-",
    );
  });
});
