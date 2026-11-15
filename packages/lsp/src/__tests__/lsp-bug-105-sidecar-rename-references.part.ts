/**
 * BUG-105 —— `textDocument/rename` / `textDocument/references` 漏掉**侧车契约绑定**
 * （而 `textDocument/definition` 把它报成定义位）
 *
 * 现象：对带侧车契约的导出函数改名 ⇒ 只改源码、侧车契约成孤儿
 * （仍绑定旧名）⇒ 契约档 `hw`→`imp`，**已报的 L1 `nudo:constraint-violated`
 * 诊断静默消失**（门禁结论被 LSP 自己的编辑改掉）。
 *
 * 钉（协议面，同一符号三面必须同口径）：
 * 1. `definition` 报出两个定义位（源码声明 + 侧车契约绑定）；
 * 2. `references` 包含侧车契约绑定位；
 * 3. `rename` 的编辑集包含侧车契约绑定位（= definition 定义位全集的超集）；
 * 4. 把 rename 编辑落到两侧文件后，侧车契约**跟随改名**（不再是孤儿）；
 * 5. 负控制：没有侧车时 references / rename 不产生侧车文件（不凭空造文件）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { defaultLoadModule } from "@nudojs/service";
import { checkToLspDiagnostics } from "../validation.ts";
import { applyEdits, type CodeActionEdit } from "./lsp-bug-r90a-harness.ts";
import { withLspServer, withTempDir } from "./helpers.ts";

const LIB_JS = `export function add(user) {
  return user.name;
}
export function caller() {
  return add({ id: 1 });
}
`;
const LIB_SC = `import { fn, shape, string } from "@nudojs/core";

export const add = fn({ user: shape({ name: string() }) }, string());
`;

type Loc = { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } };

const asLocations = (res: unknown): Loc[] => (Array.isArray(res) ? (res as Loc[]) : res ? [res as Loc] : []);

/** uri → 文件名（测试只关心"哪个文件"） */
const fileOf = (uri: string): string => basename(decodeURIComponent(uri));

/** `file:line:character` 形态，便于集合断言 */
const keyOf = (l: Loc): string =>
  `${fileOf(l.uri)}:${l.range.start.line}:${l.range.start.character}`;

describe("Bug 105 · 侧车契约绑定参与 references / rename", () => {
  it("definition / references / rename 对同一符号同口径（含侧车契约绑定）", async () => {
    await withLspServer(
      { "lib.js": LIB_JS, "lib.nudo.js": LIB_SC },
      async ({ req, uri }) => {
        const pos = { textDocument: { uri: uri("lib.js") }, position: { line: 0, character: 16 } };
        const defs = asLocations(req("textDocument/definition")(pos));
        const defKeys = defs.map(keyOf).sort();
        // 侧车契约绑定（`export const add = fn(…)` 的 add，line 2 char 13）
        expect(defKeys).toContain("lib.nudo.js:2:13");

        const refs = asLocations(
          req("textDocument/references")({ ...pos, context: { includeDeclaration: true } }),
        );
        const refKeys = refs.map(keyOf);
        // 源码侧：声明 + 调用点；侧车侧：契约绑定
        expect(refKeys).toContain("lib.js:0:16");
        expect(refKeys).toContain("lib.js:4:9");
        expect(refKeys).toContain("lib.nudo.js:2:13");

        const rename = req("textDocument/rename")({ ...pos, newName: "plus" }) as {
          changes?: Record<string, CodeActionEdit[]>;
        };
        const changes = rename?.changes ?? {};
        const files = Object.keys(changes).map(fileOf).sort();
        // rename 改**两个**文件：侧车不得成孤儿
        expect(files).toEqual(["lib.js", "lib.nudo.js"]);

        // 侧车编辑 = 契约绑定标识符本身（line 2, char 13..16 → "plus"）
        const scKey = Object.keys(changes).find((u) => fileOf(u) === "lib.nudo.js")!;
        const scEdits = changes[scKey]!;
        expect(scEdits).toHaveLength(1);
        expect(scEdits[0]!.range.start).toEqual({ line: 2, character: 13 });
        expect(scEdits[0]!.range.end).toEqual({ line: 2, character: 16 });
        expect(scEdits[0]!.newText).toBe("plus");

        // definition 的定义位全集 ⊆ rename 的编辑集（同一符号不得两套答案）
        const renameKeys = new Set<string>(
          Object.entries(changes).flatMap(([u, edits]) =>
            edits.map((e) => `${fileOf(u)}:${e.range.start.line}:${e.range.start.character}`),
          ),
        );
        for (const k of defKeys) expect(renameKeys).toContain(k);

        // 落盘（内存）：两侧同时改名 ⇒ 契约跟随源码，不成孤儿
        const libEdits = changes[Object.keys(changes).find((u) => fileOf(u) === "lib.js")!]!;
        const landedJs = applyEdits(LIB_JS, libEdits);
        expect(landedJs).toContain("export function plus(user)");
        expect(landedJs).toContain("return plus({ id: 1 });");
        expect(landedJs).not.toContain("function add(");

        const landedSc = applyEdits(LIB_SC, scEdits);
        expect(landedSc).toContain("export const plus = fn({ user: shape({ name: string() }) }, string());");
        expect(landedSc).not.toContain("export const add");
      },
      "nudo-lsp-105-",
    );
  });

  it("落盘后契约仍在生效（L1 违约诊断不因改名静默消失）", () => {
    withTempDir("nudo-lsp-105-recheck-", (dir) => {
      const jsPath = join(dir, "lib.js");
      const scPath = join(dir, "lib.nudo.js");
      writeFileSync(jsPath, LIB_JS, "utf-8");
      writeFileSync(scPath, LIB_SC, "utf-8");

      const before = checkToLspDiagnostics(jsPath, LIB_JS, defaultLoadModule);
      expect(before.some((d) => d.code === "nudo:constraint-violated")).toBe(true);

      const renamedJs = LIB_JS.replace(/\badd\b/g, "plus");
      const renamedSc = readFileSync(scPath, "utf-8").replace("export const add =", "export const plus =");

      // 旧行为（对照）：只改源码 ⇒ 契约成孤儿 ⇒ 已报的 L1 违约诊断**消失**
      writeFileSync(jsPath, renamedJs, "utf-8");
      const orphan = checkToLspDiagnostics(jsPath, renamedJs, defaultLoadModule);
      expect(orphan.some((d) => d.code === "nudo:constraint-violated")).toBe(false);

      // 修复后的 rename 编辑集（源码 + 侧车）⇒ 契约仍绑定 ⇒ 违约诊断仍在
      writeFileSync(scPath, renamedSc, "utf-8");
      const synced = checkToLspDiagnostics(jsPath, renamedJs, defaultLoadModule);
      expect(synced.some((d) => d.code === "nudo:constraint-violated")).toBe(true);
    });
  });

  it("负控制：没有侧车时 references / rename 只碰源码文件", async () => {
    await withLspServer(
      { "lib.js": LIB_JS },
      async ({ req, uri }) => {
        const pos = { textDocument: { uri: uri("lib.js") }, position: { line: 0, character: 16 } };
        const refs = asLocations(
          req("textDocument/references")({ ...pos, context: { includeDeclaration: true } }),
        );
        expect(refs.map(keyOf).sort()).toEqual(["lib.js:0:16", "lib.js:4:9"]);

        const rename = req("textDocument/rename")({ ...pos, newName: "plus" }) as {
          changes?: Record<string, unknown>;
        };
        expect(Object.keys(rename?.changes ?? {}).map(fileOf)).toEqual(["lib.js"]);
      },
      "nudo-lsp-105-neg-",
    );
  });
});
